"""
Role-Based Access Control (RBAC) Security Dependencies for Patient & Admission Service.

Provides:
- UserRole enum (synced with auth-service accepted values)
- require_roles() FastAPI dependency factory for endpoint authorization
- require_roles_or_internal() FastAPI dependency factory for endpoints that accept
  either authenticated end-user roles OR verified inter-service calls from the mesh
"""

import os
import hmac
from enum import Enum
from typing import Dict, Any, Optional
from fastapi import Header, HTTPException, status


INTERNAL_SERVICE_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")


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
    
    ADMIN role is always authorized regardless of the allowed_roles set.
    """

    def role_checker(
        x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
        x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
        x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
        x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
        x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
    ) -> Dict[str, Any]:
        # 1. Verify authentication
        if not x_user_id or not x_user_role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required: missing verified identity headers."
            )

        # 2. Build allowed values set with universal ADMIN override
        allowed_values = {r.value if isinstance(r, UserRole) else str(r).upper() for r in allowed_roles}
        allowed_values.add(UserRole.ADMIN.value)

        # 3. Authorize role
        if x_user_role.upper() not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: role '{x_user_role}' does not have the required permissions for this action."
            )

        # 4. Return verified user context
        return {
            "user_id": int(x_user_id),
            "role": x_user_role.upper(),
            "username": x_user_username,
            "department": x_user_department,
            "full_name": x_user_fullname,
        }

    return role_checker


def require_roles_or_internal(*allowed_roles: UserRole):
    """
    FastAPI dependency factory for endpoints that accept EITHER:
    1. Authenticated end-user roles (via Gateway-injected X-User-* headers), OR
    2. Verified inter-service calls carrying a valid INTERNAL_SERVICE_SECRET token.
    
    Used for inter-service endpoints like /admissions/verify/{id} and
    /admissions/discharge/{id} that bed-service calls internally.
    
    Uses hmac.compare_digest for timing-attack resistant secret comparison.
    """

    def dual_checker(
        x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
        x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
        x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
        x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
        x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
        x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
    ) -> Dict[str, Any]:

        # Path 1: Trusted internal mesh call (timing-attack resistant comparison)
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

        # Path 2: Standard end-user role check
        if not x_user_id or not x_user_role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required: missing verified identity headers or valid internal service token."
            )

        # Build allowed values set with universal ADMIN override
        allowed_values = {r.value if isinstance(r, UserRole) else str(r).upper() for r in allowed_roles}
        allowed_values.add(UserRole.ADMIN.value)

        if x_user_role.upper() not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: role '{x_user_role}' does not have the required permissions for this action."
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
