from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime

class PersonnelCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=100)
    full_name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(default="NURSE", description="DOCTOR, NURSE, CLEANING_CREW, PHARMACY, ADMIN")
    department: str = Field(default="EMERGENCY")

    @field_validator('password')
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not any(char.isupper() for char in v):
            raise ValueError('Password must contain at least one uppercase letter.')
        if not any(char.islower() for char in v):
            raise ValueError('Password must contain at least one lowercase letter.')
        if not any(char.isdigit() for char in v):
            raise ValueError('Password must contain at least one number.')
        if not any(char in '@$!%*?&#' for char in v):
            raise ValueError('Password must contain at least one special character (@$!%*?&#).')
        return v

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str) -> str:
        allowed = {'DOCTOR', 'NURSE', 'CLEANING_CREW', 'PHARMACY', 'ADMIN'}
        normalized = v.upper()
        if normalized not in allowed:
            raise ValueError(f"Role must be one of: {', '.join(allowed)}")
        return normalized

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class PersonnelResponse(BaseModel):
    personnel_id: int
    username: str
    email: EmailStr
    full_name: str
    role: str
    department: str
    is_active: bool

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    personnel_id: int
    username: str
    full_name: str
    role: str
    department: str