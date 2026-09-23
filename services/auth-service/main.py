from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import os
import secrets
from typing import Dict, Any, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
import jwt
import redis.asyncio as aioredis
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, init_db
import models
import schemas
import security
from security import UserRole, require_roles, get_current_user

logger = logging.getLogger("hip.auth")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
REDIS_URL = os.getenv("REDIS_URL", "redis://hip-redis:6379")

# Rate limiting constants
LOGIN_RATE_LIMIT = 5           # max attempts
LOGIN_RATE_WINDOW = 900        # 15 minutes in seconds
PASSWORD_CHANGE_RATE_LIMIT = 3
PASSWORD_CHANGE_RATE_WINDOW = 900

# Password history depth
PASSWORD_HISTORY_DEPTH = 5


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    now_ts = datetime.now(timezone.utc).timestamp()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"iat": now_ts, "exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token() -> str:
    """Generate a cryptographically secure random refresh token."""
    return secrets.token_urlsafe(64)


def hash_token(token: str) -> str:
    """Hash a refresh token for secure storage."""
    return hashlib.sha256(token.encode()).hexdigest()


async def get_redis_client() -> aioredis.Redis:
    return aioredis.from_url(REDIS_URL, decode_responses=True)


async def check_rate_limit(redis: aioredis.Redis, key: str, max_attempts: int, window: int) -> None:
    """Check and enforce rate limiting. Raises 429 if limit exceeded."""
    current = await redis.get(key)
    if current and int(current) >= max_attempts:
        ttl = await redis.ttl(key)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in {ttl} seconds.",
            headers={"Retry-After": str(ttl)}
        )


async def increment_rate_limit(redis: aioredis.Redis, key: str, window: int) -> None:
    """Increment the rate limit counter."""
    pipe = redis.pipeline()
    pipe.incr(key)
    pipe.expire(key, window)
    await pipe.execute()


async def log_audit(
    db: AsyncSession,
    action: str,
    user_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    details: Optional[dict] = None,
    audit_status: str = "SUCCESS"
):
    """Write an audit log entry to the database."""
    try:
        entry = models.AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=ip_address,
            details=json.dumps(details) if details else None,
            status=audit_status
        )
        db.add(entry)
        await db.flush()
    except Exception as e:
        logger.error("Failed to write audit log: %s", e)


def get_client_ip(request: Request) -> str:
    """Extract client IP from request, checking X-Forwarded-For."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def check_password_history(db: AsyncSession, personnel_id: int, new_password: str) -> bool:
    """Check if new_password matches any of the last N passwords. Returns True if reused."""
    result = await db.execute(
        select(models.PasswordHistory.password_hash)
        .where(models.PasswordHistory.personnel_id == personnel_id)
        .order_by(models.PasswordHistory.created_at.desc())
        .limit(PASSWORD_HISTORY_DEPTH)
    )
    history_hashes = result.scalars().all()

    for h in history_hashes:
        # Run bcrypt verification in threadpool to avoid blocking the async event loop
        is_match = await run_in_threadpool(security.verify_password, new_password, h)
        if is_match:
            return True
    return False


async def prune_password_history(db: AsyncSession, personnel_id: int) -> None:
    """Remove password history entries beyond the last N for a given user."""
    await db.execute(
        text("""
            DELETE FROM password_history
            WHERE history_id IN (
                SELECT history_id FROM password_history
                WHERE personnel_id = :pid
                ORDER BY created_at DESC
                OFFSET :keep
            )
        """),
        {"pid": personnel_id, "keep": PASSWORD_HISTORY_DEPTH}
    )


async def revoke_all_user_tokens(db: AsyncSession, personnel_id: int) -> None:
    """Revoke all active refresh tokens for a user and set Redis logout timestamp."""
    await db.execute(
        update(models.RefreshToken)
        .where(
            models.RefreshToken.personnel_id == personnel_id,
            models.RefreshToken.revoked == False  # noqa: E712
        )
        .values(revoked=True)
    )
    current_ts = datetime.now(timezone.utc).timestamp()
    try:
        redis = await get_redis_client()
        await redis.set(f"last_logout:{personnel_id}", str(current_ts), ex=ACCESS_TOKEN_EXPIRE_MINUTES * 60)
        await redis.aclose()
    except Exception as e:
        logger.error("Failed to record token revocation in Redis: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Seed default administrator if none exists
    from database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            admin_check = await db.execute(select(models.Personnel).where(models.Personnel.role == "ADMIN"))
            if not admin_check.scalars().first():
                admin_initial_pw = os.getenv("INITIAL_ADMIN_PASSWORD")
                must_change = False
                if not admin_initial_pw:
                    admin_initial_pw = os.getenv("TEST_USER_PASSWORD", "AdminPassword123!")
                    must_change = True  # Enforce mandatory change on first login if using fallback

                seed_admin = models.Personnel(
                    username="admin",
                    email="admin@hospital.org",
                    hashed_password=security.hashed_password(admin_initial_pw),
                    full_name="Hospital Administrator",
                    role="ADMIN",
                    department="ADMINISTRATION",
                    is_active=True,
                    must_change_password=must_change
                )
                db.add(seed_admin)
                await db.commit()
                logger.info("Default administrator seeded: admin@hospital.org (must_change_password=%s)", must_change)
    except Exception as e:
        logger.warning("Could not check/seed default administrator: %s", e)
    yield


app = FastAPI(
    title="Hospital Intelligence Platform - Personnel Auth Service",
    version="4.0.0",
    lifespan=lifespan
)


# ===========================================================================
# HEALTH CHECK
# ===========================================================================

@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(select(models.Personnel).limit(1))
        return {"status": "healthy", "database": "connected", "service": "auth-service"}
    except Exception as e:
        logger.error("Health check failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Service health check failed."
        )


# ===========================================================================
# ADMIN PROVISIONING — replaces public /register
# ===========================================================================

@app.post("/admin/provision-staff", response_model=schemas.ProvisionResponse, status_code=status.HTTP_201_CREATED)
async def provision_staff(
    provision_in: schemas.AdminProvisionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN))
):
    """Admin-only: create a new staff member with an auto-generated temporary password."""
    client_ip = get_client_ip(request)

    # Check username uniqueness
    user_exists = await db.execute(select(models.Personnel).where(models.Personnel.username == provision_in.username))
    if user_exists.scalars().first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists.")

    # Check email uniqueness
    email_exists = await db.execute(select(models.Personnel).where(models.Personnel.email == provision_in.email))
    if email_exists.scalars().first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered.")

    # Auto-generate high-entropy temporary password (base64url + complexity suffix)
    temp_password = secrets.token_urlsafe(12) + "A1!"
    hashed_pw = await run_in_threadpool(security.hashed_password, temp_password)

    new_personnel = models.Personnel(
        username=provision_in.username,
        email=provision_in.email,
        hashed_password=hashed_pw,
        full_name=provision_in.full_name,
        role=provision_in.role,
        department=provision_in.department,
        is_active=True,
        must_change_password=True
    )
    db.add(new_personnel)
    await db.commit()
    await db.refresh(new_personnel)

    # Seed initial password into history
    db.add(models.PasswordHistory(
        personnel_id=new_personnel.personnel_id,
        password_hash=hashed_pw
    ))
    await db.commit()

    await log_audit(
        db, "PROVISION_STAFF", user_id=current_user["user_id"],
        resource_type="PERSONNEL", resource_id=new_personnel.personnel_id,
        ip_address=client_ip,
        details={
            "provisioned_username": new_personnel.username,
            "role": new_personnel.role,
            "department": new_personnel.department,
            "provisioned_by": current_user["username"]
        }
    )
    await db.commit()

    return schemas.ProvisionResponse(
        personnel_id=new_personnel.personnel_id,
        username=new_personnel.username,
        email=new_personnel.email,
        full_name=new_personnel.full_name,
        role=new_personnel.role,
        department=new_personnel.department,
        must_change_password=True,
        temporary_password=temp_password
    )


# ===========================================================================
# LOGIN — restricted token when must_change_password=True
# ===========================================================================

@app.post("/login", response_model=schemas.TokenResponse, status_code=status.HTTP_200_OK)
async def login_personnel(
    credentials: schemas.LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    redis = await get_redis_client()
    try:
        client_ip = get_client_ip(request)
        rate_key = f"rate:login:{credentials.email}"
        await check_rate_limit(redis, rate_key, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW)

        result = await db.execute(select(models.Personnel).where(models.Personnel.email == credentials.email))
        personnel = result.scalars().first()

        if not personnel or not security.verify_password(credentials.password, personnel.hashed_password):
            await increment_rate_limit(redis, rate_key, LOGIN_RATE_WINDOW)
            await log_audit(
                db, "LOGIN_FAILED", ip_address=client_ip,
                resource_type="PERSONNEL",
                details={"email": credentials.email, "reason": "Invalid credentials"},
                audit_status="FAILURE"
            )
            await db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

        if not personnel.is_active:
            await log_audit(
                db, "LOGIN_BLOCKED", user_id=personnel.personnel_id,
                resource_type="PERSONNEL", resource_id=personnel.personnel_id,
                ip_address=client_ip,
                details={"reason": "Account inactive"},
                audit_status="FAILURE"
            )
            await db.commit()
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive. Contact system administrator.")

        # Update last login
        personnel.last_login_datetime = func.now()

        if personnel.must_change_password:
            # ── RESTRICTED TOKEN: no role, no refresh token, tight expiry ──
            token_data = {
                "sub": str(personnel.personnel_id),
                "role": "RESTRICTED",
                "scope": "temporary:first_login_reset",
                "must_change_password": True,
            }
            access_token = create_access_token(token_data)
            await db.commit()

            await log_audit(
                db, "LOGIN_TEMP", user_id=personnel.personnel_id,
                resource_type="PERSONNEL", resource_id=personnel.personnel_id,
                ip_address=client_ip,
                details={"username": personnel.username, "must_change_password": True}
            )
            await db.commit()

            return schemas.TokenResponse(
                access_token=access_token,
                refresh_token=None,
                token_type="bearer",
                expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                personnel_id=personnel.personnel_id,
                username=personnel.username,
                full_name=personnel.full_name,
                role=personnel.role,
                department=personnel.department,
                must_change_password=True
            )

        # ── FULL TOKEN: normal login flow ──
        token_data = {
            "sub": str(personnel.personnel_id),
            "role": personnel.role,
        }
        access_token = create_access_token(token_data)

        raw_refresh_token = create_refresh_token()
        refresh_token_record = models.RefreshToken(
            personnel_id=personnel.personnel_id,
            token_hash=hash_token(raw_refresh_token),
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        )
        db.add(refresh_token_record)
        await db.commit()

        await log_audit(
            db, "LOGIN", user_id=personnel.personnel_id,
            resource_type="PERSONNEL", resource_id=personnel.personnel_id,
            ip_address=client_ip,
            details={"username": personnel.username}
        )
        await db.commit()

        return schemas.TokenResponse(
            access_token=access_token,
            refresh_token=raw_refresh_token,
            token_type="bearer",
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            personnel_id=personnel.personnel_id,
            username=personnel.username,
            full_name=personnel.full_name,
            role=personnel.role,
            department=personnel.department,
            must_change_password=False
        )
    finally:
        await redis.aclose()


# ===========================================================================
# FORCE RESET PASSWORD — first-login mandatory reset
# ===========================================================================

@app.post("/force-reset-password", response_model=schemas.TokenResponse)
async def force_reset_password(
    body: schemas.ForceResetRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Mandatory password reset for users with temporary credentials."""
    client_ip = get_client_ip(request)
    user_id = current_user["user_id"]

    # Rate limit
    redis = await get_redis_client()
    try:
        rate_key = f"rate:force_reset:{user_id}"
        await check_rate_limit(redis, rate_key, PASSWORD_CHANGE_RATE_LIMIT, PASSWORD_CHANGE_RATE_WINDOW)

        personnel = await db.get(models.Personnel, user_id)
        if not personnel:
            raise HTTPException(status_code=404, detail="Personnel record not found.")

        if not personnel.must_change_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password reset not required. Use /change-password instead."
            )

        # Check password history (bcrypt in threadpool)
        is_reused = await check_password_history(db, user_id, body.new_password)
        if is_reused:
            await increment_rate_limit(redis, rate_key, PASSWORD_CHANGE_RATE_WINDOW)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reuse any of your last {PASSWORD_HISTORY_DEPTH} passwords."
            )

        # Hash and persist new password
        new_hash = await run_in_threadpool(security.hashed_password, body.new_password)
        personnel.hashed_password = new_hash
        personnel.must_change_password = False

        # Record in password history and prune
        db.add(models.PasswordHistory(personnel_id=user_id, password_hash=new_hash))
        await db.flush()
        await prune_password_history(db, user_id)

        # Revoke all old tokens
        await revoke_all_user_tokens(db, user_id)

        # Issue fresh full tokens
        token_data = {"sub": str(user_id), "role": personnel.role}
        access_token = create_access_token(token_data)
        raw_refresh = create_refresh_token()
        db.add(models.RefreshToken(
            personnel_id=user_id,
            token_hash=hash_token(raw_refresh),
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        ))
        await db.commit()

        await log_audit(
            db, "FORCE_RESET_PASSWORD", user_id=user_id,
            resource_type="PERSONNEL", resource_id=user_id,
            ip_address=client_ip,
            details={"username": personnel.username}
        )
        await db.commit()

        return schemas.TokenResponse(
            access_token=access_token,
            refresh_token=raw_refresh,
            token_type="bearer",
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            personnel_id=personnel.personnel_id,
            username=personnel.username,
            full_name=personnel.full_name,
            role=personnel.role,
            department=personnel.department,
            must_change_password=False
        )
    finally:
        await redis.aclose()


# ===========================================================================
# CHANGE PASSWORD — self-service for fully authenticated users
# ===========================================================================

@app.post("/change-password")
async def change_password(
    body: schemas.ChangePasswordRequest,
    request: Request,
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Self-service password change for users who have already completed forced reset."""
    client_ip = get_client_ip(request)
    user_id = current_user["user_id"]

    redis = await get_redis_client()
    try:
        rate_key = f"rate:change_pw:{user_id}"
        await check_rate_limit(redis, rate_key, PASSWORD_CHANGE_RATE_LIMIT, PASSWORD_CHANGE_RATE_WINDOW)

        personnel = await db.get(models.Personnel, user_id)
        if not personnel:
            raise HTTPException(status_code=404, detail="Personnel record not found.")

        if personnel.must_change_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You must complete the forced password reset first via /force-reset-password."
            )

        # Verify current password
        if not await run_in_threadpool(security.verify_password, body.current_password, personnel.hashed_password):
            await increment_rate_limit(redis, rate_key, PASSWORD_CHANGE_RATE_WINDOW)
            await log_audit(
                db, "CHANGE_PASSWORD_FAILED", user_id=user_id,
                resource_type="PERSONNEL", resource_id=user_id,
                ip_address=client_ip,
                details={"reason": "Invalid current password"},
                audit_status="FAILURE"
            )
            await db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect.")

        # Check password history
        is_reused = await check_password_history(db, user_id, body.new_password)
        if is_reused:
            await increment_rate_limit(redis, rate_key, PASSWORD_CHANGE_RATE_WINDOW)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reuse any of your last {PASSWORD_HISTORY_DEPTH} passwords."
            )

        # Update password
        new_hash = await run_in_threadpool(security.hashed_password, body.new_password)
        personnel.hashed_password = new_hash

        # Record in history and prune
        db.add(models.PasswordHistory(personnel_id=user_id, password_hash=new_hash))
        await db.flush()
        await prune_password_history(db, user_id)

        # Revoke all tokens — user must re-authenticate with new password
        await revoke_all_user_tokens(db, user_id)
        await db.commit()

        await log_audit(
            db, "CHANGE_PASSWORD", user_id=user_id,
            resource_type="PERSONNEL", resource_id=user_id,
            ip_address=client_ip,
            details={"username": personnel.username}
        )
        await db.commit()

        return {"status": "SUCCESS", "message": "Password changed successfully. All sessions revoked — please log in again."}
    finally:
        await redis.aclose()


# ===========================================================================
# TOKEN REFRESH — CRIT-4 FIX: Refresh token rotation
# ===========================================================================

@app.post("/refresh", response_model=schemas.TokenResponse)
async def refresh_token(
    body: schemas.RefreshRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Exchange a valid refresh token for a new access + refresh token pair."""
    token_hash = hash_token(body.refresh_token)

    result = await db.execute(
        select(models.RefreshToken).where(models.RefreshToken.token_hash == token_hash)
    )
    stored_token = result.scalars().first()

    if not stored_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token.")

    if stored_token.revoked:
        # Potential token reuse attack — revoke ALL tokens for this user
        await db.execute(
            update(models.RefreshToken)
            .where(models.RefreshToken.personnel_id == stored_token.personnel_id)
            .values(revoked=True)
        )
        await db.commit()
        logger.warning("Refresh token reuse detected for personnel_id=%d. All tokens revoked.", stored_token.personnel_id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token reuse detected. All sessions revoked.")

    if stored_token.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired.")

    # Fetch the personnel
    personnel = await db.get(models.Personnel, stored_token.personnel_id)
    if not personnel or not personnel.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found or inactive.")

    # Revoke the old refresh token
    stored_token.revoked = True

    # Issue new tokens
    token_data = {
        "sub": str(personnel.personnel_id),
        "role": personnel.role,
    }
    new_access_token = create_access_token(token_data)
    new_raw_refresh = create_refresh_token()

    new_refresh_record = models.RefreshToken(
        personnel_id=personnel.personnel_id,
        token_hash=hash_token(new_raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(new_refresh_record)
    await db.commit()

    # Link old token to new one for audit trail
    stored_token.replaced_by_token_id = new_refresh_record.token_id
    await db.commit()

    client_ip = get_client_ip(request)
    await log_audit(
        db, "TOKEN_REFRESH", user_id=personnel.personnel_id,
        resource_type="PERSONNEL", resource_id=personnel.personnel_id,
        ip_address=client_ip
    )
    await db.commit()

    return schemas.TokenResponse(
        access_token=new_access_token,
        refresh_token=new_raw_refresh,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        personnel_id=personnel.personnel_id,
        username=personnel.username,
        full_name=personnel.full_name,
        role=personnel.role,
        department=personnel.department,
        must_change_password=False
    )


# ===========================================================================
# LOGOUT — requires authentication
# ===========================================================================

@app.post("/logout")
async def logout(
    request: Request,
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = current_user["user_id"]

    await db.execute(
        update(models.Personnel)
        .where(models.Personnel.personnel_id == user_id)
        .values(last_logout_datetime=func.now())
    )
    await revoke_all_user_tokens(db, user_id)
    await db.commit()

    client_ip = get_client_ip(request)
    await log_audit(
        db, "LOGOUT", user_id=user_id,
        resource_type="PERSONNEL", resource_id=user_id,
        ip_address=client_ip
    )
    await db.commit()

    return {"status": "SUCCESS", "message": "Logged out successfully. All tokens revoked."}


# ===========================================================================
# REVOKE ALL TOKENS (Admin only)
# ===========================================================================

@app.post("/revoke-all/{personnel_id}")
async def revoke_all_tokens(
    personnel_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db)
):
    """Admin-only: revoke all refresh tokens for a specific user."""
    await revoke_all_user_tokens(db, personnel_id)
    await db.commit()

    client_ip = get_client_ip(request)
    await log_audit(
        db, "REVOKE_ALL_TOKENS", user_id=current_user["user_id"],
        resource_type="PERSONNEL", resource_id=personnel_id,
        ip_address=client_ip,
        details={"target_personnel_id": personnel_id}
    )
    await db.commit()

    return {"status": "SUCCESS", "message": f"All tokens revoked for personnel #{personnel_id}."}


# ===========================================================================
# PROFILE — requires any authenticated user
# ===========================================================================

@app.get("/me", response_model=schemas.PersonnelResponse)
async def get_current_personnel(
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(models.Personnel).where(models.Personnel.personnel_id == current_user["user_id"]))
    personnel = result.scalars().first()
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel record not found.")
    return personnel


# ===========================================================================
# STAFF LISTINGS — role-protected
# ===========================================================================

@app.get("/personnel/nurses", response_model=List[schemas.PersonnelResponse])
async def get_active_nurses(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """List active nurses for shift assignment."""
    result = await db.execute(
        select(models.Personnel).where(
            models.Personnel.role == "NURSE",
            models.Personnel.is_active.is_(True)
        ).order_by(models.Personnel.full_name)
    )
    return result.scalars().all()


@app.get("/personnel/staff", response_model=List[schemas.PersonnelResponse])
async def get_all_staff(
    role: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db)
):
    """List personnel with optional role filter. Admin only."""
    stmt = select(models.Personnel)
    if role:
        stmt = stmt.where(models.Personnel.role == role.upper())
    stmt = stmt.order_by(models.Personnel.role, models.Personnel.full_name)
    result = await db.execute(stmt)
    return result.scalars().all()


# ===========================================================================
# DEACTIVATE — Admin only
# ===========================================================================

@app.put("/personnel/{personnel_id}/deactivate")
async def deactivate_personnel(
    personnel_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db)
):
    """Soft-deactivate a personnel account without deleting historical records."""
    if personnel_id == current_user["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own administrator account."
        )

    personnel = await db.get(models.Personnel, personnel_id)
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel not found.")

    personnel.is_active = False
    await revoke_all_user_tokens(db, personnel_id)
    await db.commit()

    client_ip = get_client_ip(request)
    await log_audit(
        db, "DEACTIVATE", user_id=current_user["user_id"],
        resource_type="PERSONNEL", resource_id=personnel_id,
        ip_address=client_ip,
        details={"target_username": personnel.username, "deactivated_by": current_user["username"]}
    )
    await db.commit()

    return {"status": "SUCCESS", "message": f"Personnel {personnel.username} deactivated (is_active=False). All tokens revoked. History preserved."}


# ===========================================================================
# ACTIVATE — Admin only
# ===========================================================================

@app.put("/personnel/{personnel_id}/activate")
async def activate_personnel(
    personnel_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db)
):
    """Reactivate a previously deactivated personnel account."""
    personnel = await db.get(models.Personnel, personnel_id)
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel not found.")

    personnel.is_active = True
    await db.commit()

    client_ip = get_client_ip(request)
    await log_audit(
        db, "ACTIVATE", user_id=current_user["user_id"],
        resource_type="PERSONNEL", resource_id=personnel_id,
        ip_address=client_ip,
        details={"target_username": personnel.username, "activated_by": current_user["username"]}
    )
    await db.commit()

    return {"status": "SUCCESS", "message": f"Personnel {personnel.username} reactivated (is_active=True)."}


@app.delete("/personnel/{personnel_id}")
async def reject_delete_personnel(personnel_id: int):
    """Explicitly reject hard deletion of personnel records under HIPAA retention rules."""
    return JSONResponse(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        headers={"Allow": "GET, POST, PUT"},
        content={
            "detail": "Hard deletion of personnel records is strictly prohibited under HIPAA compliance. Use PUT /personnel/{id}/deactivate."
        }
    )