"""Centralized object-level authorization (BOLA) & HIPAA read-audit helpers for patient-service."""
import logging
import os
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from audit import log_audit
import models

logger = logging.getLogger("hip.patient.authz")

VALID_BOLA_MODES = {"off", "audit_only", "enforce"}


def get_bola_policy_mode() -> str:
    """Return configured BOLA care-team policy mode (off, audit_only, enforce)."""
    mode = os.getenv("BOLA_POLICY_MODE", "audit_only").strip().lower()
    return mode if mode in VALID_BOLA_MODES else "audit_only"


async def authorize_nurse_assignment_completion(
    db: AsyncSession,
    assignment_id: int,
    current_user: Dict[str, Any],
) -> models.PatientNurseAssignment:
    """Ensure only the assigned nurse (or a DOCTOR/ADMIN) can complete an ACTIVE assignment."""
    assignment = await db.get(models.PatientNurseAssignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Nurse assignment not found.")

    actor_id = current_user.get("user_id")
    role = (current_user.get("role") or "").upper()

    if role == "NURSE" and assignment.nurse_id != actor_id:
        logger.warning(
            "BOLA denied: nurse_id=%s tried to complete assignment_id=%s owned by nurse_id=%s",
            actor_id,
            assignment_id,
            assignment.nurse_id,
        )
        await log_audit(
            db,
            action="BOLA_DENIED",
            user_id=actor_id,
            resource_type="patient_nurse_assignment",
            resource_id=assignment_id,
            details={"reason": "not_assigned_nurse", "assigned_nurse_id": assignment.nurse_id},
            audit_status="DENIED",
        )
        await db.commit()
        raise HTTPException(
            status_code=403,
            detail="Access denied: nurses may only complete their own patient assignments.",
        )

    complete_stmt = (
        update(models.PatientNurseAssignment)
        .where(
            models.PatientNurseAssignment.assignment_id == assignment_id,
            models.PatientNurseAssignment.status == "ACTIVE",
        )
        .values(status="COMPLETED", end_datetime=func.now())
    )
    complete_res = await db.execute(complete_stmt)
    if not getattr(complete_res, "rowcount", 0):
        raise HTTPException(
            status_code=409,
            detail=f"Nurse assignment #{assignment_id} is already {assignment.status}.",
        )

    await db.refresh(assignment)
    return assignment


async def verify_admission_care_scope(
    db: AsyncSession,
    admission_id: int,
    current_user: Dict[str, Any],
) -> None:
    """Enforce or shadow-audit whether a NURSE holds an ACTIVE assignment for an admission."""
    mode = get_bola_policy_mode()
    if mode == "off":
        return

    role = (current_user.get("role") or "").upper()
    if role != "NURSE":
        return

    actor_id = current_user.get("user_id")
    stmt = select(models.PatientNurseAssignment.assignment_id).where(
        models.PatientNurseAssignment.admission_id == admission_id,
        models.PatientNurseAssignment.nurse_id == actor_id,
        models.PatientNurseAssignment.status == "ACTIVE",
    )
    res = await db.execute(stmt)
    has_active_assignment = res.scalars().first() is not None
    if has_active_assignment:
        return

    if mode == "enforce":
        logger.warning(
            "BOLA enforce denied: unassigned nurse_id=%s accessed admission_id=%s",
            actor_id,
            admission_id,
        )
        await log_audit(
            db,
            action="BOLA_DENIED",
            user_id=actor_id,
            resource_type="admission",
            resource_id=admission_id,
            details={"reason": "nurse_not_assigned_to_admission", "policy_mode": mode},
            audit_status="DENIED",
        )
        await db.commit()
        raise HTTPException(
            status_code=403,
            detail="Access denied: nurse is not actively assigned to this admission.",
        )

    logger.info(
        "BOLA audit_only shadow signal: nurse_id=%s accessed admission_id=%s without active assignment",
        actor_id,
        admission_id,
    )


async def audit_phi_read(
    db: AsyncSession,
    current_user: Dict[str, Any],
    action: str,
    resource_type: str,
    resource_id: int,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    """Persist a HIPAA READ audit entry unless BOLA/audit mode is explicitly off."""
    if get_bola_policy_mode() == "off":
        return
    await log_audit(
        db,
        action=action,
        user_id=current_user.get("user_id"),
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
    )
    await db.commit()

