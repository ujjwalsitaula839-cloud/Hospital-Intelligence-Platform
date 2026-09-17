from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import logging
import os
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, status
import jwt
import redis.asyncio as aioredis
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, init_db
import models
import schemas
import security

logger = logging.getLogger("hip.auth")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REDIS_URL = os.getenv("REDIS_URL", "redis://hip-redis:6379")


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    now_ts = datetime.now(timezone.utc).timestamp()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"iat": now_ts, "exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="Hospital Intelligence Platform - Personnel Auth Service",
    version="2.0.0",
    lifespan=lifespan
)


@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(select(models.Personnel).limit(1))
        return {"status": "healthy", "database": "connected", "service": "auth-service"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database connection failed: {str(e)}"
        )


@app.post("/register", response_model=schemas.PersonnelResponse, status_code=status.HTTP_201_CREATED)
async def register_personnel(personnel_in: schemas.PersonnelCreate, db: AsyncSession = Depends(get_db)):
    user_exists = await db.execute(select(models.Personnel).where(models.Personnel.username == personnel_in.username))
    if user_exists.scalars().first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")

    email_exists = await db.execute(select(models.Personnel).where(models.Personnel.email == personnel_in.email))
    if email_exists.scalars().first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    new_personnel = models.Personnel(
        username=personnel_in.username,
        email=personnel_in.email,
        hashed_password=security.hashed_password(personnel_in.password),
        full_name=personnel_in.full_name,
        role=personnel_in.role.upper(),
        department=personnel_in.department.upper()
    )

    db.add(new_personnel)
    await db.commit()
    await db.refresh(new_personnel)
    return new_personnel


@app.post("/login", response_model=schemas.TokenResponse, status_code=status.HTTP_200_OK)
async def login_personnel(credentials: schemas.LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Personnel).where(models.Personnel.email == credentials.email))
    personnel = result.scalars().first()

    if not personnel or not security.verify_password(credentials.password, personnel.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not personnel.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive. Contact system administrator.")

    token_data = {
        "sub": str(personnel.personnel_id),
        "username": personnel.username,
        "role": personnel.role,
        "department": personnel.department,
        "full_name": personnel.full_name
    }

    return schemas.TokenResponse(
        access_token=create_access_token(token_data),
        token_type="bearer",
        personnel_id=personnel.personnel_id,
        username=personnel.username,
        full_name=personnel.full_name,
        role=personnel.role,
        department=personnel.department
    )


@app.post("/logout")
async def logout(x_user_id: str = Header(None), db: AsyncSession = Depends(get_db)):
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Gateway authentication context missing.")

    current_ts = datetime.now(timezone.utc).timestamp()

    await db.execute(
        update(models.Personnel)
        .where(models.Personnel.personnel_id == int(x_user_id))
        .values(last_logout_datetime=func.now())
    )
    await db.commit()

    try:
        redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        await redis.set(f"last_logout:{x_user_id}", str(current_ts), ex=3600)
        await redis.aclose()
    except Exception as e:
        logger.error("Failed to record logout in Redis: %s", e)

    return {"status": "SUCCESS", "message": "Logged out successfully. Token invalidated."}


@app.get("/me", response_model=schemas.PersonnelResponse)
async def get_current_personnel(x_user_id: str = Header(None), db: AsyncSession = Depends(get_db)):
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Gateway authentication context missing.")

    result = await db.execute(select(models.Personnel).where(models.Personnel.personnel_id == int(x_user_id)))
    personnel = result.scalars().first()
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel record not found.")
    return personnel


@app.get("/personnel/nurses", response_model=List[schemas.PersonnelResponse])
async def get_active_nurses(x_user_id: str = Header(None), db: AsyncSession = Depends(get_db)):
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
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """List personnel with optional role filter."""
    stmt = select(models.Personnel)
    if role:
        stmt = stmt.where(models.Personnel.role == role.upper())
    stmt = stmt.order_by(models.Personnel.role, models.Personnel.full_name)
    result = await db.execute(stmt)
    return result.scalars().all()


@app.put("/personnel/{personnel_id}/deactivate")
async def deactivate_personnel(
    personnel_id: int,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """Soft-deactivate a personnel account without deleting historical records."""
    personnel = await db.get(models.Personnel, personnel_id)
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel not found.")

    personnel.is_active = False
    await db.commit()
    return {"status": "SUCCESS", "message": f"Personnel {personnel.username} deactivated (is_active=False). History preserved."}