"""
Role-Based Access Control (RBAC) Security Dependencies for Bed & Resource Management Service.

Provides:
- UserRole enum (synced with auth-service accepted values)
- require_roles() FastAPI dependency factory for endpoint authorization
"""

from enum import Enum
from typing import Dict, Any, Optional
from fastapi import Header, HTTPException, status


class UserRole(str, Enum):
    """Typed role constants synchronized with auth-service/schemas.py validate_role()."""
    ADMIN = "ADMIN"
    DOCTOR = "DOCTOR"
    NURSE = "NURSE"
    CLEANING_CREW = "CLEANING_CREW"
    PHARMACY = "PHARMACY"


def require_roles(*allowed_roles: UserRole):
    """
    FastAPI dependency factory that enforces role-based access control.
    
    Reads X-User-Id and X-User-Role headers injected by the API Gateway
    (after JWT verification). Returns authenticated user context dict.
    
    ADMIN role is always authorized regardless of the allowed_roles set,
    preventing accidental lockout from misconfigured endpoint guards.
    
    Args:
        *allowed_roles: One or more UserRole enum values that are permitted.
    
    Returns:
        A FastAPI dependency function that returns:
        {"user_id": int, "role": str, "username": str|None, "department": str|None, "full_name": str|None}
    
    Raises:
        HTTPException 401: If X-User-Id or X-User-Role headers are missing (unauthenticated).
        HTTPException 403: If the user's role is not in the allowed set.
    """

    def role_checker(
        x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
        x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
        x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
        x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
        x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
    ) -> Dict[str, Any]:
        # 1. Verify authentication (headers injected by gateway from verified JWT)
        if not x_user_id or not x_user_role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required: missing verified identity headers."
            )

        # 2. Build allowed values set with universal ADMIN override
        allowed_values = {r.value if isinstance(r, UserRole) else str(r).upper() for r in allowed_roles}
        allowed_values.add(UserRole.ADMIN.value)  # Guarantees ADMIN is always authorized

        # 3. Authorize role
        if x_user_role.upper() not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: role '{x_user_role}' does not have the required permissions for this action."
            )

        # 4. Return verified user context for route handlers
        return {
            "user_id": int(x_user_id),
            "role": x_user_role.upper(),
            "username": x_user_username,
            "department": x_user_department,
            "full_name": x_user_fullname,
        }

    return role_checker
