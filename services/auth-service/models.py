from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from database import Base


class Personnel(Base):
    __tablename__ = "personnel"

    personnel_id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False, default="Staff Member")
    role = Column(String(30), nullable=False, default="NURSE")  # DOCTOR, NURSE, CLEANING_CREW, PHARMACY, ADMIN
    department = Column(String(50), nullable=False, default="EMERGENCY")
    is_active = Column(Boolean, default=True)
    must_change_password = Column(Boolean, default=True, nullable=False)
    create_datetime = Column(DateTime(timezone=True), server_default=func.now())
    last_login_datetime = Column(DateTime(timezone=True), nullable=True)
    last_logout_datetime = Column(DateTime(timezone=True), nullable=True)


class PasswordHistory(Base):
    __tablename__ = "password_history"

    history_id = Column(Integer, primary_key=True, index=True)
    personnel_id = Column(Integer, ForeignKey("personnel.personnel_id", ondelete="CASCADE"), nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RefreshToken(Base):
    __tablename__ = "refresh_token"

    token_id = Column(Integer, primary_key=True, index=True)
    personnel_id = Column(Integer, ForeignKey("personnel.personnel_id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    replaced_by_token_id = Column(Integer, ForeignKey("refresh_token.token_id", ondelete="SET NULL"), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"

    log_id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    action = Column(String(50), nullable=False, index=True)  # LOGIN, LOGOUT, REGISTER, DEACTIVATE, LOGIN_FAILED, TOKEN_REFRESH
    resource_type = Column(String(50), nullable=True)  # PERSONNEL, PATIENT, BED, EQUIPMENT
    resource_id = Column(Integer, nullable=True)
    ip_address = Column(String(45), nullable=True)
    details = Column(Text, nullable=True)  # JSON string with additional context
    status = Column(String(20), nullable=False, default="SUCCESS")  # SUCCESS, FAILURE