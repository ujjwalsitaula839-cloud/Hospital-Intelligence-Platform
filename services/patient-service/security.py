from enum import Enum
import hmac
import os
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException, status

INTERNAL_SERVICE_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    DOCTOR = "DOCTOR"
    NURSE = "NURSE"
    CLEANING_CREW = "CLEANING_CREW"
    PHARMACY = "PHARMACY"


def require_roles(*allowed_roles: UserRole):
    """FastAPI dependency enforcing role permissions with universal ADMIN override."""
    # Invariant: ADMIN is always authorized across all guarded routes
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


def require_roles_or_internal(*allowed_roles: UserRole):
    """Authorizes either end-user roles or verified inter-service mesh calls."""
    allowed_values = {r.value if isinstance(r, UserRole) else str(r).upper() for r in allowed_roles}
    allowed_values.add(UserRole.ADMIN.value)

    def dual_checker(
        x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
        x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
        x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
        x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
        x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
        x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
    ) -> Dict[str, Any]:
        # Invariant: hmac.compare_digest prevents timing attacks when validating mesh secrets
        if x_internal_token and INTERNAL_SERVICE_SECRET:
            if hmac.compare_digest(x_internal_token, INTERNAL_SERVICE_SECRET):
                return {
                    "user_id": int(x_user_id) if x_user_id and x_user_id.isdigit() else 0,
                    "role": x_user_role.upper() if x_user_role else "SYSTEM",
                    "username": x_user_username,
                    "department": x_user_department,
                    "full_name": x_user_fullname,
                    "internal": True,
                }

        if not x_user_id or not x_user_role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required: missing verified identity headers or internal service token."
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
            "internal": False,
        }

    return dual_checker
