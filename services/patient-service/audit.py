"""Audit logging module for patient-service. HIPAA compliance requirement."""
import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import AsyncSession

from database import Base

logger = logging.getLogger("hip.patient.audit")


class AuditLog(Base):
    __tablename__ = "patient_audit_log"

    log_id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    action = Column(String(50), nullable=False, index=True)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(Integer, nullable=True)
    ip_address = Column(String(45), nullable=True)
    details = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="SUCCESS")


async def log_audit(
    db: AsyncSession,
    action: str,
    user_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    details: Optional[dict] = None,
    audit_status: str = "SUCCESS"
):
    """Write an audit log entry to the database."""
    try:
        entry = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=ip_address,
            details=json.dumps(details) if details else None,
            status=audit_status
        )
        db.add(entry)
        await db.flush()
    except Exception as e:
        logger.error("Failed to write audit log: %s", e)
