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


def _verify_gateway_secret(x_gateway_secret: Optional[str]) -> None:
    """Require trusted X-Gateway-Secret whenever INTERNAL_SERVICE_SECRET is configured."""
    expected = os.getenv("INTERNAL_SERVICE_SECRET", "")
    if not expected:
        return
    if not x_gateway_secret or not hmac.compare_digest(x_gateway_secret, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Untrusted caller: valid gateway verification required."
        )


def _validate_user_headers(
    allowed_values: set[str],
    x_user_id: Optional[str],
    x_user_role: Optional[str],
    x_user_username: Optional[str],
    x_user_department: Optional[str],
    x_user_fullname: Optional[str],
    missing_detail: str,
    include_internal: bool = False,
) -> Dict[str, Any]:
    if not x_user_id or not x_user_role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=missing_detail,
        )

    # MED-2 FIX: Safe integer parsing
    if not x_user_id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user identity.",
        )

    if x_user_role.upper() not in allowed_values:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: role '{x_user_role}' does not have required permissions.",
        )

    ctx: Dict[str, Any] = {
        "user_id": int(x_user_id),
        "role": x_user_role.upper(),
        "username": x_user_username,
        "department": x_user_department,
        "full_name": x_user_fullname,
    }
    if include_internal:
        ctx["internal"] = False
    return ctx


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
        x_gateway_secret: Optional[str] = Header(None, alias="X-Gateway-Secret"),
    ) -> Dict[str, Any]:
        _verify_gateway_secret(x_gateway_secret)
        return _validate_user_headers(
            allowed_values,
            x_user_id,
            x_user_role,
            x_user_username,
            x_user_department,
            x_user_fullname,
            missing_detail="Authentication required: missing verified identity headers.",
        )

    return role_checker


def require_roles_or_internal(*allowed_roles: UserRole):
    """Authorizes either verified gateway-proxied user roles or verified inter-service mesh calls."""
    allowed_values = {r.value if isinstance(r, UserRole) else str(r).upper() for r in allowed_roles}
    allowed_values.add(UserRole.ADMIN.value)

    def dual_checker(
        x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
        x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
        x_user_username: Optional[str] = Header(None, alias="X-User-Username"),
        x_user_department: Optional[str] = Header(None, alias="X-User-Department"),
        x_user_fullname: Optional[str] = Header(None, alias="X-User-Fullname"),
        x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token"),
        x_gateway_secret: Optional[str] = Header(None, alias="X-Gateway-Secret"),
    ) -> Dict[str, Any]:
        expected = os.getenv("INTERNAL_SERVICE_SECRET", "")
        # Invariant: hmac.compare_digest prevents timing attacks when validating mesh secrets
        if x_internal_token and expected and hmac.compare_digest(x_internal_token, expected):
            return {
                "user_id": int(x_user_id) if x_user_id and x_user_id.isdigit() else 0,
                "role": x_user_role.upper() if x_user_role else "SYSTEM",
                "username": x_user_username,
                "department": x_user_department,
                "full_name": x_user_fullname,
                "internal": True,
            }

        _verify_gateway_secret(x_gateway_secret)
        return _validate_user_headers(
            allowed_values,
            x_user_id,
            x_user_role,
            x_user_username,
            x_user_department,
            x_user_fullname,
            missing_detail="Authentication required: missing verified identity headers or internal service token.",
            include_internal=True,
        )

    return dual_checker
