from enum import Enum
import hmac
import os
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException, status
from passlib.context import CryptContext


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_gateway_secret(x_gateway_secret: Optional[str]) -> None:
    """Require trusted X-Gateway-Secret whenever INTERNAL_SERVICE_SECRET is configured."""
    expected = os.getenv("INTERNAL_SERVICE_SECRET", "")
    if not expected:
        return
    if not x_gateway_secret or not hmac.compare_digest(x_gateway_secret, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Untrusted caller: valid gateway verification required."
        )


def hashed_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    DOCTOR = "DOCTOR"
    NURSE = "NURSE"
    CLEANING_CREW = "CLEANING_CREW"
    PHARMACY = "PHARMACY"


def _validate_user_headers(
    x_user_id: Optional[str],
    x_user_role: Optional[str],
    x_user_username: Optional[str],
    x_user_department: Optional[str],
    x_user_fullname: Optional[str],
    allowed_values: Optional[set[str]] = None,
) -> Dict[str, Any]:
    if not x_user_id or not x_user_role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required: missing verified identity headers."
        )

    if not x_user_id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user identity."
        )

    if allowed_values is not None and x_user_role.upper() not in allowed_values:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: role '{x_user_role}' does not have required permissions."
        )

    return {
        "user_id": int(x_user_id),
        "role": x_user_role.upper(),
        "username": x_user_username,
        "department": x_user_department,
        "full_name": x_user_fullname,
    }


def require_roles(*allowed_roles: UserRole):
    """FastAPI dependency enforcing role permissions with universal ADMIN override."""
    allowed_values = {r.value if isinstance(r, UserRole) else str(r).upper() for r in allowed_roles}
    allowed_values.add(UserRole.ADMIN.value)

    def role_checker(
        x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
        x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
        x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
        x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
        x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
        x_gateway_secret: Optional[str] = Header(None, alias="X-Gateway-Secret"),
    ) -> Dict[str, Any]:
        verify_gateway_secret(x_gateway_secret)
        return _validate_user_headers(
            x_user_id, x_user_role, x_user_username, x_user_department, x_user_fullname, allowed_values
        )

    return role_checker


def get_current_user(
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
    x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
    x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
    x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
    x_gateway_secret: Optional[str] = Header(None, alias="X-Gateway-Secret"),
) -> Dict[str, Any]:
    """Dependency that extracts any authenticated user (no role restriction)."""
    verify_gateway_secret(x_gateway_secret)
    return _validate_user_headers(
        x_user_id, x_user_role, x_user_username, x_user_department, x_user_fullname
    )