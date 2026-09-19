from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime


VALID_ROLES = {'DOCTOR', 'NURSE', 'CLEANING_CREW', 'PHARMACY', 'ADMIN'}
VALID_DEPARTMENTS = {
    'EMERGENCY', 'ICU', 'SURGERY', 'PEDIATRICS', 'RADIOLOGY',
    'PHARMACY', 'LABORATORY', 'ADMINISTRATION', 'GENERAL',
    'FACILITIES', 'ENVIRONMENTAL_SERVICES'
}


def _validate_password_strength(v: str) -> str:
    """Shared password strength rules for all password-accepting schemas."""
    if not any(c.isupper() for c in v):
        raise ValueError('Password must contain at least one uppercase letter.')
    if not any(c.islower() for c in v):
        raise ValueError('Password must contain at least one lowercase letter.')
    if not any(c.isdigit() for c in v):
        raise ValueError('Password must contain at least one number.')
    if not any(c in '@$!%*?&#' for c in v):
        raise ValueError('Password must contain at least one special character (@$!%*?&#).')
    return v


# ---------------------------------------------------------------------------
# Admin provisioning (replaces public registration)
# ---------------------------------------------------------------------------

class AdminProvisionRequest(BaseModel):
    """Admin creates a new staff member. Temporary password is auto-generated."""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(default="NURSE", description="DOCTOR, NURSE, CLEANING_CREW, PHARMACY, ADMIN")
    department: str = Field(default="EMERGENCY")

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str) -> str:
        normalized = v.upper()
        if normalized not in VALID_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(sorted(VALID_ROLES))}")
        return normalized

    @field_validator('department')
    @classmethod
    def validate_department(cls, v: str) -> str:
        normalized = v.upper()
        if normalized not in VALID_DEPARTMENTS:
            raise ValueError(f"Department must be one of: {', '.join(sorted(VALID_DEPARTMENTS))}")
        return normalized


class ProvisionResponse(BaseModel):
    """Returned once after provisioning — includes the auto-generated temporary password."""
    personnel_id: int
    username: str
    email: EmailStr
    full_name: str
    role: str
    department: str
    must_change_password: bool
    temporary_password: str  # shown once, never stored in plaintext


# ---------------------------------------------------------------------------
# Password reset / change
# ---------------------------------------------------------------------------

class ForceResetRequest(BaseModel):
    """First-login forced password reset."""
    new_password: str = Field(..., min_length=8, max_length=100)
    confirm_password: str

    @field_validator('new_password')
    @classmethod
    def validate_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class ChangePasswordRequest(BaseModel):
    """Self-service password change for fully authenticated users."""
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=100)
    confirm_password: str

    @field_validator('new_password')
    @classmethod
    def validate_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


# ---------------------------------------------------------------------------
# Auth flow
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------

class PersonnelResponse(BaseModel):
    personnel_id: int
    username: str
    email: EmailStr
    full_name: str
    role: str
    department: str
    is_active: bool
    must_change_password: bool

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None  # None when must_change_password=True (no long-lived token)
    token_type: str = "bearer"
    expires_in: int  # seconds until access token expires
    personnel_id: int
    username: str
    full_name: str
    role: str
    department: str
    must_change_password: bool = False