from enum import Enum
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException, status
from passlib.context import CryptContext


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


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

        if x_user_role.upper() not in allowed_values:
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

    return role_checker


def get_current_user(
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
    x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
    x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
    x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
) -> Dict[str, Any]:
    """Dependency that extracts any authenticated user (no role restriction)."""
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

    return {
        "user_id": int(x_user_id),
        "role": x_user_role.upper(),
        "username": x_user_username,
        "department": x_user_department,
        "full_name": x_user_fullname,
    }


def get_optional_user(
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
    x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
    x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
    x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
) -> Optional[Dict[str, Any]]:
    """Dependency that extracts user if present, returns None if not authenticated."""
    if not x_user_id or not x_user_role or not x_user_id.isdigit():
        return None

    return {
        "user_id": int(x_user_id),
        "role": x_user_role.upper(),
        "username": x_user_username,
        "department": x_user_department,
        "full_name": x_user_fullname,
    }