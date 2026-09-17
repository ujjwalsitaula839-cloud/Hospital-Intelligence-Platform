from enum import Enum
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException, status


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
