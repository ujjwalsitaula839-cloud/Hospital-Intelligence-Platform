"""Candidate bed selector for intelligent triage and allocation.

Performs sub-10ms deterministic candidate slicing directly from PostgreSQL,
eliminating multi-turn ReAct race conditions (TOCTOU).
"""

from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import models


async def fetch_candidate_bed_pool(
    db: AsyncSession,
    acuity_level: Optional[str] = "ESI_3",
    requires_isolation: bool = False,
    requires_bariatric: bool = False,
    preferred_department: Optional[str] = None,
    limit: int = 12
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Deterministically retrieve feasible candidate beds for a given acuity and patient condition.
    Returns (candidate_beds, metadata_flags).
    Guarantees that even if all specialized beds are occupied, contingency beds are provided
    with appropriate clinical warnings.
    """
    acuity = (acuity_level or "ESI_3").upper()
    flags = {
        "isolation_contingency": False,
        "bariatric_contingency": False,
    }

    # Determine clinical target departments based on Emergency Severity Index (ESI)
    if preferred_department:
        target_departments = [preferred_department.upper()]
    elif acuity in ("ESI_1", "ESI_2"):
        target_departments = ["ICU", "EMERGENCY"]
    elif acuity == "ESI_3":
        target_departments = ["EMERGENCY", "STEP_DOWN", "GENERAL_WARD"]
    else:  # ESI_4, ESI_5
        target_departments = ["GENERAL_WARD", "STEP_DOWN", "SURGERY"]

    # 1. Primary Query: Try strict match on department + bed_type
    query = select(models.Bed).where(
        models.Bed.status.in_(["AVAILABLE", "DIRTY"]),
        models.Bed.department.in_(target_departments)
    )

    if requires_isolation:
        query = query.where(models.Bed.bed_type == "ISOLATION")
    elif requires_bariatric:
        query = query.where(models.Bed.bed_type == "BARIATRIC")

    query = query.order_by(
        case((models.Bed.status == "AVAILABLE", 0), else_=1),
        models.Bed.bed_code.asc()
    ).limit(limit)

    result = await db.execute(query)
    beds = result.scalars().all()

    # 2. If specialized search returned 0 beds, check if specialized beds exist hospital-wide
    if not beds and (requires_isolation or requires_bariatric):
        hospital_wide_query = select(models.Bed).where(
            models.Bed.status.in_(["AVAILABLE", "DIRTY"])
        )
        if requires_isolation:
            hospital_wide_query = hospital_wide_query.where(models.Bed.bed_type == "ISOLATION")
        elif requires_bariatric:
            hospital_wide_query = hospital_wide_query.where(models.Bed.bed_type == "BARIATRIC")

        hospital_wide_query = hospital_wide_query.order_by(
            case((models.Bed.status == "AVAILABLE", 0), else_=1),
            models.Bed.bed_code.asc()
        ).limit(limit)

        h_result = await db.execute(hospital_wide_query)
        beds = h_result.scalars().all()

    # 3. Contingency fallback: If all specialized beds in the hospital are occupied,
    # retrieve standard beds in the target departments with contingency warning
    if not beds and (requires_isolation or requires_bariatric):
        if requires_isolation:
            flags["isolation_contingency"] = True
        if requires_bariatric:
            flags["bariatric_contingency"] = True

        contingency_query = select(models.Bed).where(
            models.Bed.status.in_(["AVAILABLE", "DIRTY"]),
            models.Bed.department.in_(target_departments)
        ).order_by(
            case((models.Bed.status == "AVAILABLE", 0), else_=1),
            models.Bed.bed_code.asc()
        ).limit(limit)

        c_result = await db.execute(contingency_query)
        beds = c_result.scalars().all()

    # 4. If still under 3 beds and no preferred department was locked, expand to any department
    if len(beds) < 3 and not preferred_department:
        general_query = select(models.Bed).where(
            models.Bed.status.in_(["AVAILABLE", "DIRTY"])
        ).order_by(
            case((models.Bed.status == "AVAILABLE", 0), else_=1),
            models.Bed.bed_code.asc()
        ).limit(limit)

        g_result = await db.execute(general_query)
        beds = g_result.scalars().all()

    candidates = [
        {
            "bed_id": b.bed_id,
            "bed_code": b.bed_code,
            "department": b.department,
            "room_number": b.room_number,
            "bed_type": b.bed_type,
            "status": b.status,
            "version": b.version,
        }
        for b in beds
    ]

    return candidates, flags


async def fetch_available_equipment_pool(
    db: AsyncSession,
    department: Optional[str] = None,
    limit: int = 15
) -> List[Dict[str, Any]]:
    """
    Fetch currently available equipment items that can be pre-staged.
    Filters out hallway-only crash carts and limits to 1 physical device per equipment type
    to prevent greedy multi-unit over-allocation.
    """
    query = (
        select(models.Equipment)
        .options(selectinload(models.Equipment.equipment_type))
        .where(models.Equipment.status == "AVAILABLE")
    )
    if department:
        query = query.where(models.Equipment.department == department.upper())

    query = query.order_by(models.Equipment.equipment_type_id.asc(), models.Equipment.serial_number.asc())
    result = await db.execute(query)
    equipment_list = result.scalars().all()

    # Clinical Staging Rules:
    # 1. Crash Carts remain in hallway (never pre-staged in patient room)
    # 2. Never assign more than ONE (1) unit of any primary equipment type
    seen_types = set()
    filtered_equipment: List[Dict[str, Any]] = []

    for e in equipment_list:
        type_name = (e.equipment_type.name if e.equipment_type else e.equipment_name)
        type_key = type_name.strip().lower()

        # Rule 2: Never place Crash Cart in individual patient rooms
        if "crash cart" in type_key or "crash cart" in (e.equipment_name or "").lower():
            continue

        # Rule 1: Max 1 unit per equipment type
        if type_key in seen_types:
            continue

        seen_types.add(type_key)
        filtered_equipment.append({
            "equipment_id": e.equipment_id,
            "equipment_name": e.equipment_name,
            "equipment_type": type_name,
            "serial_number": e.serial_number,
            "department": e.department,
            "status": e.status,
            "version": e.version,
        })
        if len(filtered_equipment) >= limit:
            break

    return filtered_equipment
