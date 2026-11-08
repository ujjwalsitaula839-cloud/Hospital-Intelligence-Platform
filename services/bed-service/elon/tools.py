"""
Operational Query Tools for ELON with Two-Tiered RBAC Enforcement
"""
import logging
from typing import Optional, List, Dict, Any
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

import models
from elon.schemas import UserContext

logger = logging.getLogger("hip.bed.elon.tools")


async def get_bed_status_overview(
    db: AsyncSession,
    department: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50
) -> Dict[str, Any]:
    """
    Returns high-level bed status overview (total matching, breakdown by dept/type, and sample beds).
    Accessible by all roles (CLEANING_CREW, NURSE, DOCTOR, ADMIN).
    """
    # 1. Total matching count
    count_query = select(func.count(models.Bed.bed_id))
    if department:
        count_query = count_query.where(func.upper(models.Bed.department) == department.upper())
    if status:
        count_query = count_query.where(func.upper(models.Bed.status) == status.upper())
    total_matching = (await db.execute(count_query)).scalar() or 0

    # 2. Breakdown by department
    dept_counts: Dict[str, int] = {}
    dc_query = select(models.Bed.department, func.count(models.Bed.bed_id))
    if department:
        dc_query = dc_query.where(func.upper(models.Bed.department) == department.upper())
    if status:
        dc_query = dc_query.where(func.upper(models.Bed.status) == status.upper())
    dc_query = dc_query.group_by(models.Bed.department)
    dc_res = await db.execute(dc_query)
    for d_name, d_cnt in dc_res.fetchall():
        dept_counts[d_name] = d_cnt

    # 3. Breakdown by bed_type
    type_counts: Dict[str, int] = {}
    tc_query = select(models.Bed.bed_type, func.count(models.Bed.bed_id))
    if department:
        tc_query = tc_query.where(func.upper(models.Bed.department) == department.upper())
    if status:
        tc_query = tc_query.where(func.upper(models.Bed.status) == status.upper())
    tc_query = tc_query.group_by(models.Bed.bed_type)
    tc_res = await db.execute(tc_query)
    for t_name, t_cnt in tc_res.fetchall():
        type_counts[t_name] = t_cnt

    # 4. Detailed sample beds
    query = select(
        models.Bed.bed_code,
        models.Bed.department,
        models.Bed.room_number,
        models.Bed.bed_type,
        models.Bed.status
    )
    if department:
        query = query.where(func.upper(models.Bed.department) == department.upper())
    if status:
        query = query.where(func.upper(models.Bed.status) == status.upper())

    query = query.order_by(models.Bed.bed_code.asc()).limit(limit)
    res = await db.execute(query)
    rows = res.fetchall()

    beds_list = [
        {
            "bed_code": r[0],
            "department": r[1],
            "room_number": r[2],
            "bed_type": r[3],
            "status": r[4],
        }
        for r in rows
    ]

    return {
        "department_filter": department,
        "status_filter": status,
        "total_matching": total_matching,
        "department_counts": dept_counts,
        "type_counts": type_counts,
        "beds_sample": beds_list,
        "beds": beds_list,
    }


async def get_cleaning_tasks_queue(
    db: AsyncSession,
    department: Optional[str] = None,
    limit: int = 20
) -> List[Dict[str, Any]]:
    """
    Returns beds needing turnover or currently in cleaning progress.
    Accessible by all roles, primary tool for CLEANING_CREW / EVS.
    """
    query = (
        select(
            models.Bed.bed_code,
            models.Bed.department,
            models.Bed.room_number,
            models.Bed.status.label("bed_status"),
            models.CleaningTask.status.label("cleaning_status"),
            models.CleaningTask.requested_datetime,
        )
        .outerjoin(
            models.CleaningTask,
            (models.Bed.bed_id == models.CleaningTask.bed_id) &
            (models.CleaningTask.status.in_(["PENDING", "IN_PROGRESS"]))
        )
        .where(models.Bed.status.in_(["DIRTY", "CLEANING_IN_PROGRESS"]))
    )
    if department:
        query = query.where(func.upper(models.Bed.department) == department.upper())

    query = query.order_by(models.Bed.bed_code.asc()).limit(limit)
    res = await db.execute(query)
    rows = res.fetchall()

    return [
        {
            "bed_code": r[0],
            "department": r[1],
            "room_number": r[2],
            "bed_status": r[3],
            "cleaning_status": r[4] or "QUEUED",
            "requested_at": r[5].strftime("%H:%M") if r[5] else "Recent",
        }
        for r in rows
    ]


async def get_bed_clinical_hold_details(
    db: AsyncSession,
    bed_code: str,
    user_context: UserContext
) -> Dict[str, Any]:
    """
    Retrieves clinical admission rationale, acuity, diagnosis, and staged equipment for a bed hold.
    HARD RBAC BOUNDARY: Strictly barred from CLEANING_CREW / EVS.
    """
    # 1. Enforce hard role boundary at the tool level
    if user_context.role.upper() == "CLEANING_CREW":
        return {
            "error": "ACCESS_DENIED",
            "message": (
                "Access Denied: Environmental Services personnel are restricted to bed status and turnover tasks. "
                "Patient clinical records and medical history are inaccessible."
            )
        }

    # 2. Query bed and allocation details
    clean_code = bed_code.strip().upper()
    bed_query = select(models.Bed).where(models.Bed.bed_code == clean_code)
    bed_res = await db.execute(bed_query)
    bed = bed_res.scalar_one_or_none()

    if not bed:
        return {"error": "NOT_FOUND", "message": f"Bed {clean_code} was not found in the hospital inventory."}

    # 3. Query active allocation
    alloc_query = (
        select(models.BedAllocation)
        .where(
            (models.BedAllocation.bed_id == bed.bed_id) &
            (models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"])) &
            (models.BedAllocation.end_datetime.is_(None))
        )
    )
    alloc_res = await db.execute(alloc_query)
    alloc = alloc_res.scalar_one_or_none()

    if not alloc:
        return {
            "bed_code": bed.bed_code,
            "department": bed.department,
            "status": bed.status,
            "message": f"Bed {bed.bed_code} is currently {bed.status} with no active clinical allocation hold."
        }

    # 4. Fetch admission diagnosis & staged equipment
    adm_info = {}
    try:
        raw_adm = await db.execute(
            text("SELECT acuity_level, primary_diagnosis FROM admission WHERE admission_id = :aid"),
            {"aid": alloc.admission_id}
        )
        adm_row = raw_adm.fetchone()
        if adm_row:
            adm_info["acuity_level"] = adm_row[0]
            adm_info["primary_diagnosis"] = adm_row[1]
    except Exception as e:
        logger.warning("Could not fetch admission info: %s", e)

    # 5. Fetch staged equipment
    equipment_names = []
    try:
        raw_eq = await db.execute(
            text("""
                SELECT e.equipment_name 
                FROM equipment_allocation ea
                JOIN equipment e ON ea.equipment_id = e.equipment_id
                WHERE ea.admission_id = :aid
            """),
            {"aid": alloc.admission_id}
        )
        for eq_row in raw_eq.fetchall():
            equipment_names.append(eq_row[0])
    except Exception as e:
        logger.warning("Could not fetch equipment info: %s", e)

    return {
        "bed_code": bed.bed_code,
        "department": bed.department,
        "status": alloc.status,
        "acuity_level": adm_info.get("acuity_level", "ESI_2"),
        "primary_diagnosis": adm_info.get("primary_diagnosis", "Under Clinical Evaluation"),
        "staged_equipment": equipment_names,
    }


async def get_hospital_capacity_metrics(
    db: AsyncSession,
    department: Optional[str] = None
) -> Dict[str, Any]:
    """
    Returns aggregate hospital census and capacity metrics.
    If department is provided, returns unit-specific metrics.
    Also returns a breakdown across all hospital departments.
    Accessible by all roles.
    """
    # 1. Status counts for the requested department (or entire hospital)
    query = select(models.Bed.status, func.count(models.Bed.bed_id))
    if department:
        query = query.where(func.upper(models.Bed.department) == department.upper())
    query = query.group_by(models.Bed.status)
    res = await db.execute(query)
    counts = dict(res.fetchall())

    total = sum(counts.values())
    available = counts.get("AVAILABLE", 0)
    occupied = counts.get("OCCUPIED", 0)
    reserved = counts.get("RESERVED", 0)
    dirty = counts.get("DIRTY", 0) + counts.get("CLEANING_IN_PROGRESS", 0)

    occupancy_pct = round(((occupied + reserved) / total * 100), 1) if total > 0 else 0.0

    # 2. Overall hospital department breakdown
    dept_breakdown: Dict[str, Dict[str, int]] = {}
    try:
        dept_query = select(
            models.Bed.department,
            models.Bed.status,
            func.count(models.Bed.bed_id)
        ).group_by(models.Bed.department, models.Bed.status)
        dept_res = await db.execute(dept_query)
        for dept_name, b_status, cnt in dept_res.fetchall():
            if dept_name not in dept_breakdown:
                dept_breakdown[dept_name] = {"total": 0, "AVAILABLE": 0, "OCCUPIED": 0, "RESERVED": 0, "DIRTY": 0}
            dept_breakdown[dept_name]["total"] += cnt
            if b_status in dept_breakdown[dept_name]:
                dept_breakdown[dept_name][b_status] += cnt
            elif b_status == "CLEANING_IN_PROGRESS":
                dept_breakdown[dept_name]["DIRTY"] += cnt
    except Exception as e:
        logger.debug("Department breakdown query skipped or mocked: %s", e)

    return {
        "scope": f"Department: {department}" if department else "Hospital-wide",
        "department": department,
        "total_beds": total,
        "available_beds": available,
        "occupied_beds": occupied,
        "reserved_holds": reserved,
        "dirty_beds": dirty,
        "occupancy_rate_pct": occupancy_pct,
        "department_breakdown": dept_breakdown,
    }

