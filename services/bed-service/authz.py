"""Centralized object-level authorization (BOLA) helpers for bed-service."""
import logging
import os
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from audit import log_audit
import models

logger = logging.getLogger("hip.bed.authz")

VALID_BOLA_MODES = {"off", "audit_only", "enforce"}


def get_bola_policy_mode() -> str:
    """Return configured BOLA unit-scope policy mode (off, audit_only, enforce)."""
    mode = os.getenv("BOLA_POLICY_MODE", "audit_only").strip().lower()
    return mode if mode in VALID_BOLA_MODES else "audit_only"


async def claim_cleaning_task(
    db: AsyncSession,
    cleaning_id: int,
    current_user: Dict[str, Any],
) -> models.CleaningTask:
    """Atomically claim a PENDING cleaning task for the authenticated cleaner."""
    actor_id = current_user.get("user_id")
    claim_stmt = (
        update(models.CleaningTask)
        .where(
            models.CleaningTask.cleaning_id == cleaning_id,
            models.CleaningTask.status == "PENDING",
        )
        .values(
            status="IN_PROGRESS",
            started_datetime=func.now(),
            personnel_id=actor_id,
        )
    )
    claim_res = await db.execute(claim_stmt)

    task_stmt = (
        select(models.CleaningTask)
        .options(selectinload(models.CleaningTask.bed))
        .where(models.CleaningTask.cleaning_id == cleaning_id)
        .execution_options(populate_existing=True)
    )
    task_res = await db.execute(task_stmt)
    task = task_res.scalars().first()

    if not task:
        raise HTTPException(status_code=404, detail="Cleaning task not found.")

    if not getattr(claim_res, "rowcount", 0):
        logger.warning(
            "BOLA/conflict claim denied: user=%s tried to start cleaning_id=%s in status=%s (owner=%s)",
            actor_id,
            cleaning_id,
            task.status,
            task.personnel_id,
        )
        await log_audit(
            db,
            action="CLEANING_CLAIM_DENIED",
            user_id=actor_id,
            resource_type="cleaning_task",
            resource_id=cleaning_id,
            details={"current_status": task.status, "assigned_personnel_id": task.personnel_id},
            audit_status="DENIED",
        )
        await db.commit()
        raise HTTPException(
            status_code=409,
            detail=f"Cleaning task #{cleaning_id} is already {task.status} and cannot be started.",
        )

    return task


async def authorize_cleaning_release(
    db: AsyncSession,
    cleaning_id: int,
    current_user: Dict[str, Any],
    disinfection_notes: Optional[str] = None,
) -> models.CleaningTask:
    """Release an IN_PROGRESS cleaning task back to PENDING (task owner or ADMIN only)."""
    stmt = (
        select(models.CleaningTask)
        .options(selectinload(models.CleaningTask.bed))
        .where(models.CleaningTask.cleaning_id == cleaning_id)
        .execution_options(populate_existing=True)
    )
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Cleaning task not found.")

    actor_id = current_user.get("user_id")
    role = (current_user.get("role") or "").upper()

    if task.status != "IN_PROGRESS":
        raise HTTPException(
            status_code=409,
            detail=f"Cleaning task #{cleaning_id} cannot be released from status {task.status} (must be IN_PROGRESS).",
        )

    if role != "ADMIN" and task.personnel_id != actor_id:
        logger.warning(
            "BOLA release denied: user=%s role=%s tried to release cleaning_id=%s owned by personnel_id=%s",
            actor_id,
            role,
            cleaning_id,
            task.personnel_id,
        )
        await log_audit(
            db,
            action="BOLA_DENIED",
            user_id=actor_id,
            resource_type="cleaning_task",
            resource_id=cleaning_id,
            details={"reason": "not_task_owner_release", "owner_id": task.personnel_id},
            audit_status="DENIED",
        )
        await db.commit()
        raise HTTPException(
            status_code=403,
            detail="Access denied: only the assigned cleaner or an ADMIN can release this task back to the queue.",
        )

    task.status = "PENDING"
    task.personnel_id = None
    task.started_datetime = None
    if disinfection_notes:
        task.disinfection_notes = disinfection_notes

    if task.bed:
        task.bed.status = "NEEDS_CLEANING"
        task.bed.version += 1
        task.bed.update_datetime = func.now()

    await log_audit(
        db,
        action="CLEANING_RELEASED",
        user_id=actor_id,
        resource_type="cleaning_task",
        resource_id=cleaning_id,
        details={"handover_notes": disinfection_notes},
        audit_status="SUCCESS",
    )
    return task


async def authorize_cleaning_completion(
    db: AsyncSession,
    cleaning_id: int,
    current_user: Dict[str, Any],
) -> models.CleaningTask:
    """Verify state (IN_PROGRESS) and owner (or ADMIN) before completing cleaning."""
    stmt = (
        select(models.CleaningTask)
        .options(selectinload(models.CleaningTask.bed))
        .where(models.CleaningTask.cleaning_id == cleaning_id)
    )
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Cleaning task not found.")

    actor_id = current_user.get("user_id")
    role = (current_user.get("role") or "").upper()

    if task.status != "IN_PROGRESS":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cleaning task #{cleaning_id} cannot be completed from status "
                f"{task.status}; start cleaning first."
            ),
        )

    if role != "ADMIN" and task.personnel_id != actor_id:
        logger.warning(
            "BOLA denied: user=%s role=%s tried to complete cleaning_id=%s owned by personnel_id=%s",
            actor_id,
            role,
            cleaning_id,
            task.personnel_id,
        )
        await log_audit(
            db,
            action="BOLA_DENIED",
            user_id=actor_id,
            resource_type="cleaning_task",
            resource_id=cleaning_id,
            details={"reason": "not_task_owner", "owner_id": task.personnel_id},
            audit_status="DENIED",
        )
        await db.commit()
        raise HTTPException(
            status_code=403,
            detail="Access denied: only the personnel member who started this cleaning task or an ADMIN can complete it.",
        )

    return task


async def authorize_and_release_equipment(
    db: AsyncSession,
    equipment_allocation_id: int,
    current_user: Dict[str, Any],
) -> models.EquipmentAllocation:
    """Atomically transition an ACTIVE equipment allocation to RELEASED (clinical roles only)."""
    alloc = await db.get(models.EquipmentAllocation, equipment_allocation_id)
    if not alloc:
        raise HTTPException(status_code=404, detail="Equipment allocation not found.")

    actor_id = current_user.get("user_id")
    role = (current_user.get("role") or "").upper()
    if role not in {"NURSE", "DOCTOR", "ADMIN"}:
        await log_audit(
            db,
            action="BOLA_DENIED",
            user_id=actor_id,
            resource_type="equipment_allocation",
            resource_id=equipment_allocation_id,
            details={"role": role, "reason": "non_clinical_role"},
            audit_status="DENIED",
        )
        await db.commit()
        raise HTTPException(status_code=403, detail="Access denied: clinical role required to release equipment.")

    release_stmt = (
        update(models.EquipmentAllocation)
        .where(
            models.EquipmentAllocation.equipment_allocation_id == equipment_allocation_id,
            models.EquipmentAllocation.status == "ACTIVE",
        )
        .values(status="RELEASED", end_datetime=func.now())
    )
    release_res = await db.execute(release_stmt)
    if not getattr(release_res, "rowcount", 0):
        raise HTTPException(
            status_code=409,
            detail=f"Equipment allocation #{equipment_allocation_id} is already {alloc.status}.",
        )

    await db.refresh(alloc)
    return alloc
