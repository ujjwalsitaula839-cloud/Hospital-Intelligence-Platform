from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
import httpx
from pydantic import BaseModel, Field
import redis.asyncio as aioredis
from sqlalchemy import and_, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db, init_db
import models
from redis_client import get_redis, lifespan as redis_lifespan
from security import UserRole, require_roles, require_roles_or_internal

logger = logging.getLogger("hip.bed")

BEDS_GRID_CACHE_KEY = "beds:grid:all"
CACHE_TTL_SECONDS = 300
BED_EVENTS_CHANNEL = "bed:events"
PATIENT_SERVICE_URL = os.getenv("PATIENT_SERVICE_URL", "http://hip-patient-service:8002")
INTERNAL_SERVICE_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")


@asynccontextmanager
async def combined_lifespan(app: FastAPI):
    await init_db()
    from database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            await ensure_seed_data(db)
    except Exception as e:
        logger.warning("Could not execute bed/equipment seed data on startup: %s", e)
    async with redis_lifespan(app):
        yield


app = FastAPI(
    title="Hospital Intelligence Platform - Bed & Resource Management Service",
    version="2.3.0",
    lifespan=combined_lifespan
)


class BedCreate(BaseModel):
    bed_code: str = Field(..., min_length=2, max_length=30)
    department: str = Field(default="EMERGENCY")
    room_number: str = Field(default="101")
    bed_type: str = Field(default="STANDARD")


class ReserveBedRequest(BaseModel):
    admission_id: Optional[int] = None
    encounter_id: Optional[int] = None
    patient_id: Optional[int] = None
    expected_version: Optional[int] = None
    acuity_level: Optional[str] = "ESI_3"
    primary_diagnosis: Optional[str] = Field(None, max_length=500)
    diagnosis: Optional[str] = Field("Observation", max_length=500)
    notes: Optional[str] = Field(None, max_length=1000)

    def get_admission_id(self) -> Optional[int]:
        return self.admission_id or self.encounter_id

    def get_diagnosis(self) -> str:
        return self.primary_diagnosis or self.diagnosis or "Observation"


class BedTransferRequest(BaseModel):
    from_bed_code: str
    to_bed_code: str


class AdminBedStatusRequest(BaseModel):
    status: str
    expected_version: Optional[int] = None
    reason: Optional[str] = None


class EquipmentTypeCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class EquipmentCreate(BaseModel):
    serial_number: str
    equipment_name: str
    equipment_type_id: Optional[int] = None
    equipment_type: Optional[str] = None
    department: str = "EMERGENCY"


class EquipmentAllocateRequest(BaseModel):
    equipment_id: int
    admission_id: Optional[int] = None
    encounter_id: Optional[int] = None
    bed_code: Optional[str] = None
    expected_version: Optional[int] = None

    def get_admission_id(self) -> Optional[int]:
        return self.admission_id or self.encounter_id


async def invalidate_grid_cache(redis: Optional[aioredis.Redis]):
    """Safely invalidate the bed grid cache with non-blocking error suppression."""
    if not redis:
        return
    try:
        await redis.delete(BEDS_GRID_CACHE_KEY)
    except Exception as e:
        logger.warning("Failed to invalidate bed grid cache: %s", e)


async def publish_event(redis: Optional[aioredis.Redis], event_type: str, data: dict, actor: Optional[str] = None):
    """Safely publish an event to Redis Pub/Sub with non-blocking error capture."""
    if not redis:
        logger.warning("Redis client unavailable, skipping event %s", event_type)
        return
    payload = {
        "event_type": event_type,
        "actor": actor or "system",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **data
    }
    try:
        await redis.publish(BED_EVENTS_CHANNEL, json.dumps(payload))
        logger.info("Published event %s to '%s'", event_type, BED_EVENTS_CHANNEL)
    except Exception as e:
        logger.critical("Dual-write degraded: Failed to publish event %s to Redis: %s", event_type, e)


async def ensure_seed_data(db: AsyncSession):
    """Initializes beds, equipment types, and equipment inventory if tables are empty."""
    bed_check = await db.execute(select(models.Bed).limit(1))
    if not bed_check.scalars().first():
        seed_beds = [
            models.Bed(bed_code="ER-101", department="EMERGENCY", room_number="ER-1", bed_type="STANDARD", status="AVAILABLE", version=1),
            models.Bed(bed_code="ER-102", department="EMERGENCY", room_number="ER-2", bed_type="STANDARD", status="AVAILABLE", version=1),
            models.Bed(bed_code="ICU-201", department="ICU", room_number="ICU-1", bed_type="ICU", status="AVAILABLE", version=1),
            models.Bed(bed_code="ICU-202", department="ICU", room_number="ICU-2", bed_type="ISOLATION", status="AVAILABLE", version=1),
            models.Bed(bed_code="SD-301", department="STEP_DOWN", room_number="SD-1", bed_type="STANDARD", status="AVAILABLE", version=1),
            models.Bed(bed_code="GW-401", department="GENERAL_WARD", room_number="GW-1", bed_type="STANDARD", status="AVAILABLE", version=1),
        ]
        for b in seed_beds:
            db.add(b)
        await db.commit()

    type_check = await db.execute(select(models.EquipmentType).limit(1))
    if not type_check.scalars().first():
        seed_types = [
            models.EquipmentType(name="Ventilator", description="Mechanical ventilation device"),
            models.EquipmentType(name="Cardiac Monitor", description="Multiparameter cardiac telemetry"),
            models.EquipmentType(name="Infusion Pump", description="Precision intravenous delivery pump"),
            models.EquipmentType(name="Crash Cart", description="Emergency defibrillator & resuscitation unit"),
            models.EquipmentType(name="Defibrillator", description="Automated external / biphasic defibrillator"),
            models.EquipmentType(name="Negative Pressure Unit", description="Isolation room air filtration unit"),
        ]
        for t in seed_types:
            db.add(t)
        await db.commit()

    eq_check = await db.execute(select(models.Equipment).limit(1))
    if not eq_check.scalars().first():
        types_res = await db.execute(select(models.EquipmentType))
        type_map = {t.name.upper(): t.equipment_type_id for t in types_res.scalars().all()}

        seed_eq = [
            models.Equipment(serial_number="VENT-01", equipment_name="Hamilton C6 Ventilator", equipment_type_id=type_map.get("VENTILATOR", 1), department="ICU", version=1),
            models.Equipment(serial_number="VENT-02", equipment_name="Drager Evita V800", equipment_type_id=type_map.get("VENTILATOR", 1), department="EMERGENCY", version=1),
            models.Equipment(serial_number="CARD-01", equipment_name="Philips IntelliVue Monitor", equipment_type_id=type_map.get("CARDIAC MONITOR", 2), department="EMERGENCY", version=1),
            models.Equipment(serial_number="CARD-02", equipment_name="GE Carescape B650", equipment_type_id=type_map.get("CARDIAC MONITOR", 2), department="ICU", version=1),
            models.Equipment(serial_number="PUMP-01", equipment_name="Alaris MedSystem III Pump", equipment_type_id=type_map.get("INFUSION PUMP", 3), department="EMERGENCY", version=1),
            models.Equipment(serial_number="CART-01", equipment_name="Zoll R Series Crash Cart", equipment_type_id=type_map.get("CRASH CART", 4), department="EMERGENCY", version=1),
        ]
        for eq in seed_eq:
            db.add(eq)
        await db.commit()


@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(select(models.Bed).limit(1))
        return {"status": "healthy", "database": "connected", "service": "bed-service"}
    except Exception as e:
        logger.error("Health check failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Service health check failed."
        )


async def _build_bed_grid(db: AsyncSession) -> dict:
    """Queries DB for beds, active allocations, and equipment to build bed grid payload."""
    beds_stmt = select(models.Bed).order_by(models.Bed.department, models.Bed.bed_code)
    beds = (await db.execute(beds_stmt)).scalars().all()

    alloc_stmt = select(models.BedAllocation).where(
        models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
        models.BedAllocation.end_datetime.is_(None)
    )
    active_allocs = (await db.execute(alloc_stmt)).scalars().all()
    active_bed_alloc_map: Dict[int, models.BedAllocation] = {a.bed_id: a for a in active_allocs}

    eq_alloc_stmt = (
        select(models.EquipmentAllocation)
        .options(selectinload(models.EquipmentAllocation.equipment))
        .where(
            models.EquipmentAllocation.status == "ACTIVE",
            models.EquipmentAllocation.end_datetime.is_(None)
        )
    )
    active_eq_allocs = (await db.execute(eq_alloc_stmt)).scalars().all()

    admission_eq_map: Dict[int, List[str]] = {}
    for eq_alloc in active_eq_allocs:
        if eq_alloc.equipment:
            admission_eq_map.setdefault(eq_alloc.admission_id, []).append(eq_alloc.equipment.equipment_name)

    active_admission_ids = [a.admission_id for a in active_allocs if a.admission_id and a.admission_id > 0]
    patient_admission_map = {}
    if active_admission_ids:
        try:
            raw_rows = (await db.execute(text("""
                SELECT a.admission_id, a.patient_id, a.acuity_level, a.primary_diagnosis,
                       p.first_name, p.last_name, p.gender, p.date_of_birth
                FROM admission a
                JOIN patient p ON a.patient_id = p.patient_id
                WHERE a.admission_id = ANY(:adm_ids)
            """), {"adm_ids": active_admission_ids})).mappings().all()
            for r in raw_rows:
                patient_admission_map[r["admission_id"]] = dict(r)
        except Exception as e:
            logger.warning("Could not resolve patient details for bed grid: %s", e)

    bed_list = []
    for b in beds:
        active_alloc = active_bed_alloc_map.get(b.bed_id)
        active_adm_id = active_alloc.admission_id if active_alloc else None
        eq_list = (admission_eq_map.get(active_adm_id, []) if active_adm_id else []) + admission_eq_map.get(-b.bed_id, [])
        updated_ts = b.update_datetime.isoformat() if b.update_datetime else None

        adm_info = patient_admission_map.get(active_adm_id) if active_adm_id else None
        patient_name = f"{adm_info['first_name']} {adm_info['last_name']}" if adm_info else None
        patient_id = adm_info["patient_id"] if adm_info else None
        acuity = adm_info["acuity_level"] if adm_info else None
        diagnosis = adm_info["primary_diagnosis"] if adm_info else None

        bed_list.append({
            "bed_id": b.bed_id,
            "allocation_id": active_alloc.allocation_id if active_alloc else None,
            "bed_code": b.bed_code,
            "department": b.department,
            "room_number": b.room_number,
            "bed_type": b.bed_type,
            "status": b.status,
            "version": b.version,
            "admission_id": active_adm_id,
            "encounter_id": active_adm_id,
            "patient_id": patient_id,
            "patient_name": patient_name,
            "acuity_level": acuity,
            "primary_diagnosis": diagnosis,
            "equipment": eq_list,
            "update_datetime": updated_ts,
            "updated_at": updated_ts
        })

    return {"beds": bed_list}


@app.get("/grid")
async def get_bed_grid(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.CLEANING_CREW)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    cached_beds = await redis.get(BEDS_GRID_CACHE_KEY)
    if cached_beds:
        return json.loads(cached_beds)

    response_data = await _build_bed_grid(db)
    await redis.set(BEDS_GRID_CACHE_KEY, json.dumps(response_data), ex=CACHE_TTL_SECONDS)
    return response_data


@app.post("/create")
async def create_bed(
    bed_data: BedCreate,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    result = await db.execute(select(models.Bed).where(models.Bed.bed_code == bed_data.bed_code.upper()))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="A bed with this code already exists.")

    new_bed = models.Bed(
        bed_code=bed_data.bed_code.upper(),
        department=bed_data.department.upper(),
        room_number=bed_data.room_number,
        bed_type=bed_data.bed_type.upper(),
        status="AVAILABLE",
        version=1
    )
    db.add(new_bed)
    await db.commit()
    await db.refresh(new_bed)

    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_CREATED", {
        "bed_id": new_bed.bed_id,
        "bed_code": new_bed.bed_code,
        "department": new_bed.department,
        "status": new_bed.status
    }, actor=str(current_user["user_id"]))

async def _create_or_update_cleaning_task(
    db: AsyncSession,
    bed_id: int,
    allocation_id: Optional[int] = None,
    notes: Optional[str] = None
) -> models.CleaningTask:
    """
    Idempotently creates or updates an active cleaning task for a physical bed.
    Guarantees at most one active (PENDING or IN_PROGRESS) cleaning task per bed.
    """
    stmt = (
        select(models.CleaningTask)
        .where(
            models.CleaningTask.bed_id == bed_id,
            models.CleaningTask.status.in_(["PENDING", "IN_PROGRESS"])
        )
    )
    existing = (await db.execute(stmt)).scalars().first()
    if existing:
        if allocation_id is not None:
            existing.allocation_id = allocation_id
        if notes:
            existing.disinfection_notes = notes
        existing.requested_datetime = func.now()
        return existing

    new_task = models.CleaningTask(
        bed_id=bed_id,
        allocation_id=allocation_id,
        status="PENDING",
        disinfection_notes=notes
    )
    db.add(new_task)
    return new_task


async def _resolve_active_cleaning_tasks(
    db: AsyncSession,
    bed_id: int,
    personnel_id: Optional[int],
    resolution_note: str
) -> int:
    """Completes any uncompleted cleaning tasks when a bed is set to AVAILABLE or MAINTENANCE."""
    stmt = select(models.CleaningTask).where(
        models.CleaningTask.bed_id == bed_id,
        models.CleaningTask.status.in_(["PENDING", "IN_PROGRESS"])
    )
    tasks = (await db.execute(stmt)).scalars().all()
    for task in tasks:
        task.status = "COMPLETED"
        if personnel_id:
            task.personnel_id = personnel_id
        task.completed_datetime = func.now()
        task.disinfection_notes = (
            (task.disinfection_notes or "") + f" [{resolution_note}]"
        ).strip()
    return len(tasks)


@app.put("/admin/status/{bed_code}")
async def admin_update_bed_status(
    bed_code: str,
    req: AdminBedStatusRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """
    Administrative state override for physical bed assets (AVAILABLE, DIRTY, CLEANING_IN_PROGRESS, MAINTENANCE).
    Safely releases any orphaned allocations, manages cleaning tasks, and broadcasts real-time WebSocket events.
    """
    target_status = req.status.upper()
    valid_statuses = {"AVAILABLE", "DIRTY", "CLEANING_IN_PROGRESS", "MAINTENANCE"}
    if target_status in ("RESERVED", "OCCUPIED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Bed cannot be directly set to {target_status} from Bed Registry. Please use Clinical Admissions to admit a patient to this bed."
        )
    if target_status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status '{target_status}'. Allowed administrative statuses are: {', '.join(sorted(valid_statuses))}."
        )

    bed_result = await db.execute(select(models.Bed).where(models.Bed.bed_code == bed_code.upper()))
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")

    if req.expected_version is not None and bed.version != req.expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="State conflict: Bed state was modified concurrently by another user. Refresh to see latest."
        )

    # If deallocating/overriding a bed with an active stay, gracefully complete the stay allocation
    alloc_res = await db.execute(
        select(models.BedAllocation).where(
            and_(
                models.BedAllocation.bed_id == bed.bed_id,
                models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
                models.BedAllocation.end_datetime.is_(None)
            )
        )
    )
    active_allocs = alloc_res.scalars().all()
    for alloc in active_allocs:
        alloc.status = "COMPLETED"
        alloc.end_datetime = func.now()
        alloc.update_datetime = func.now()

    # If target is AVAILABLE or MAINTENANCE, auto-resolve any uncompleted cleaning task
    if target_status in ("AVAILABLE", "MAINTENANCE"):
        await _resolve_active_cleaning_tasks(
            db, bed.bed_id, current_user["user_id"], f"Auto-resolved: Admin status override to {target_status}"
        )
    elif target_status == "DIRTY":
        await _create_or_update_cleaning_task(
            db, bed.bed_id, None, req.reason or "Admin designated DIRTY status."
        )

    new_version = bed.version + 1
    bed.status = target_status
    bed.version = new_version
    bed.update_datetime = func.now()

    await db.commit()
    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_STATUS_CHANGED", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "status": target_status,
        "version": new_version,
        "message": f"Bed {bed_code} status updated to {target_status} by Admin."
    }, actor=current_user.get("full_name") or current_user.get("username") or "Administrator")

    return {
        "status": "SUCCESS",
        "message": f"Bed {bed_code} status updated to {target_status}.",
        "version": new_version
    }


async def _resolve_or_create_admission(
    client: httpx.AsyncClient, req: ReserveBedRequest, headers: dict
) -> int:
    """Finds active admission for patient_id or creates one if none exists."""
    active_res = await client.get(
        f"{PATIENT_SERVICE_URL}/admissions/active/{req.patient_id}",
        headers=headers
    )
    if active_res.status_code == 200 and active_res.json():
        data = active_res.json()
        return data.get("admission_id") or data["encounter_id"]

    create_res = await client.post(
        f"{PATIENT_SERVICE_URL}/admissions/create",
        json={
            "patient_id": req.patient_id,
            "primary_diagnosis": req.get_diagnosis(),
            "acuity_level": req.acuity_level or "ESI_3",
            "notes": req.notes
        },
        headers=headers
    )
    if create_res.status_code in (200, 201):
        data = create_res.json()
        return data.get("admission_id") or data["encounter_id"]
    raise HTTPException(status_code=400, detail="Failed to initialize patient admission.")


async def _verify_admission_active(
    client: httpx.AsyncClient, admission_id: int, headers: dict
) -> None:
    """Confirms admission exists and is currently in an active state."""
    adm_res = await client.get(
        f"{PATIENT_SERVICE_URL}/admissions/verify/{admission_id}",
        headers=headers
    )
    if adm_res.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Admission #{admission_id} not found.")
    if adm_res.status_code != 200:
        raise HTTPException(status_code=502, detail="Patient verification microservice error.")

    adm_data = adm_res.json()
    is_active = adm_data.get("is_active", True)
    if not is_active and adm_data.get("admission_status") != "ACTIVE" and adm_data.get("encounter_status") != "ACTIVE":
        raise HTTPException(status_code=400, detail=f"Admission #{admission_id} is completed (must be ACTIVE).")


async def _execute_bed_reservation(
    db: AsyncSession, bed: models.Bed, admission_id: int, user_id: int, expected_version: Optional[int]
) -> models.BedAllocation:
    """Executes optimistic-locked Bed state update and inserts BedAllocation record."""
    current_version = expected_version if expected_version is not None else bed.version
    stmt = (
        update(models.Bed)
        .where(
            models.Bed.bed_id == bed.bed_id,
            models.Bed.status == "AVAILABLE",
            models.Bed.version == current_version
        )
        .values(status="RESERVED", version=current_version + 1, update_datetime=func.now())
    )
    res = await db.execute(stmt)
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="State conflict detected: bed was modified concurrently by another user."
        )

    bed.status = "RESERVED"
    bed.version = current_version + 1
    new_alloc = models.BedAllocation(
        bed_id=bed.bed_id,
        admission_id=admission_id,
        assigned_by_personnel_id=user_id,
        status="RESERVED",
        start_datetime=func.now()
    )
    db.add(new_alloc)

    # Auto-resolve any leftover active cleaning tasks for this newly reserved bed
    await _resolve_active_cleaning_tasks(
        db, bed.bed_id, user_id, f"Auto-resolved: Bed reserved for admission #{admission_id}"
    )

    try:
        await db.commit()
        await db.refresh(new_alloc)
        return new_alloc
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Database constraint violation: This bed or admission already has an active reservation."
        )


@app.put("/reserve/{bed_code}")
async def reserve_bed(
    bed_code: str,
    req: ReserveBedRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """Reserves bed for an admission with optimistic locking on Bed and unique index protection on BedAllocation."""
    admission_id = req.get_admission_id()

    internal_headers = {
        "X-User-Id": str(current_user["user_id"]),
        "X-User-Role": current_user["role"],
        "X-Internal-Token": INTERNAL_SERVICE_SECRET,
    }

    async with httpx.AsyncClient() as client:
        try:
            if not admission_id and req.patient_id:
                admission_id = await _resolve_or_create_admission(client, req, internal_headers)
            if not admission_id:
                raise HTTPException(status_code=400, detail="Either admission_id, encounter_id, or patient_id is required for bed reservation.")
            await _verify_admission_active(client, admission_id, internal_headers)
        except httpx.RequestError:
            raise HTTPException(status_code=503, detail="Unable to reach Patient & Admission service.")

    alloc_check = await db.execute(
        select(models.BedAllocation).where(
            models.BedAllocation.admission_id == admission_id,
            models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
            models.BedAllocation.end_datetime.is_(None)
        )
    )
    if alloc_check.scalars().first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Admission #{admission_id} already has an active bed reservation or stay.")

    bed_result = await db.execute(select(models.Bed).where(models.Bed.bed_code == bed_code.upper()))
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")

    if bed.status != "AVAILABLE":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Bed {bed_code} is currently {bed.status} (must be AVAILABLE).")

    new_alloc = await _execute_bed_reservation(db, bed, admission_id, current_user["user_id"], req.expected_version)

    if bed.department.upper() == "ICU":
        avail_icu_eq = (await db.execute(
            select(models.Equipment)
            .where(models.Equipment.department == "ICU", models.Equipment.status == "AVAILABLE")
        )).scalars().all()
        for eq_item in avail_icu_eq:
            eq_item.status = "ALLOCATED"
            eq_item.version += 1
            auto_alloc = models.EquipmentAllocation(
                equipment_id=eq_item.equipment_id,
                admission_id=admission_id,
                allocated_by_personnel_id=current_user["user_id"],
                status="ACTIVE",
                start_datetime=func.now()
            )
            db.add(auto_alloc)
        if avail_icu_eq:
            await db.commit()

    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_RESERVED", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "allocation_id": new_alloc.allocation_id,
        "admission_id": admission_id,
        "encounter_id": admission_id,
        "status": "RESERVED",
        "version": bed.version,
        "message": f"Bed {bed_code} reserved for Admission #{admission_id}."
    }, actor=current_user.get("full_name") or current_user.get("username") or f"Staff #{current_user['user_id']}")

    return {
        "status": "SUCCESS",
        "message": f"Bed {bed_code} successfully reserved for admission #{admission_id}.",
        "bed_id": bed.bed_id,
        "allocation_id": new_alloc.allocation_id
    }


@app.put("/admit/{bed_code}")
async def confirm_admission(
    bed_code: str,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """Transitions reserved bed asset and stay ledger to OCCUPIED."""
    bed_result = await db.execute(select(models.Bed).where(models.Bed.bed_code == bed_code.upper()))
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")

    if bed.status != "RESERVED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Bed {bed_code} must be in RESERVED state to confirm arrival (current: {bed.status}).")

    alloc_result = await db.execute(
        select(models.BedAllocation).where(
            and_(
                models.BedAllocation.bed_id == bed.bed_id,
                models.BedAllocation.status == "RESERVED",
                models.BedAllocation.end_datetime.is_(None)
            )
        )
    )
    active_alloc = alloc_result.scalars().first()

    current_version = bed.version
    stmt = (
        update(models.Bed)
        .where(
            and_(
                models.Bed.bed_id == bed.bed_id,
                models.Bed.status == "RESERVED",
                models.Bed.version == current_version
            )
        )
        .values(status="OCCUPIED", version=current_version + 1, update_datetime=func.now())
    )
    res = await db.execute(stmt)
    if res.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="State conflict: Bed state changed concurrently.")

    if active_alloc:
        active_alloc.status = "OCCUPIED"
        active_alloc.update_datetime = func.now()

    await db.commit()
    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_OCCUPIED", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "allocation_id": active_alloc.allocation_id if active_alloc else None,
        "admission_id": active_alloc.admission_id if active_alloc else None,
        "status": "OCCUPIED",
        "version": current_version + 1,
        "message": f"Patient arrival confirmed at Bed {bed_code} (OCCUPIED)."
    }, actor=current_user.get("full_name") or current_user.get("username") or f"Staff #{current_user['user_id']}")

    return {"status": "SUCCESS", "message": f"Patient arrival confirmed. Bed {bed_code} is now OCCUPIED."}


@app.post("/transfer")
async def transfer_patient_bed(
    req: BedTransferRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """Transfers patient from source bed to target bed, marking source DIRTY and generating cleaning task."""
    from_result = await db.execute(select(models.Bed).where(models.Bed.bed_code == req.from_bed_code.upper()))
    from_bed = from_result.scalars().first()
    if not from_bed:
        raise HTTPException(status_code=404, detail=f"Source bed {req.from_bed_code} not found.")

    from_alloc_res = await db.execute(
        select(models.BedAllocation).where(
            and_(
                models.BedAllocation.bed_id == from_bed.bed_id,
                models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
                models.BedAllocation.end_datetime.is_(None)
            )
        )
    )
    from_alloc = from_alloc_res.scalars().first()
    if not from_alloc:
        raise HTTPException(status_code=400, detail=f"Bed {req.from_bed_code} does not have an active patient allocation.")

    to_result = await db.execute(select(models.Bed).where(models.Bed.bed_code == req.to_bed_code.upper()))
    to_bed = to_result.scalars().first()
    if not to_bed:
        raise HTTPException(status_code=404, detail=f"Target bed {req.to_bed_code} not found.")

    if to_bed.status != "AVAILABLE":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Target bed {req.to_bed_code} is {to_bed.status} (must be AVAILABLE).")

    personnel_id = current_user["user_id"]
    admission_id = from_alloc.admission_id

    to_version = to_bed.version
    stmt_to = (
        update(models.Bed)
        .where(
            and_(
                models.Bed.bed_id == to_bed.bed_id,
                models.Bed.status == "AVAILABLE",
                models.Bed.version == to_version
            )
        )
        .values(status="OCCUPIED", version=to_version + 1, update_datetime=func.now())
    )
    res_to = await db.execute(stmt_to)
    if res_to.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Target bed {req.to_bed_code} was modified concurrently.")

    from_version = from_bed.version
    stmt_from = (
        update(models.Bed)
        .where(
            and_(
                models.Bed.bed_id == from_bed.bed_id,
                models.Bed.version == from_version
            )
        )
        .values(status="DIRTY", version=from_version + 1, update_datetime=func.now())
    )
    await db.execute(stmt_from)

    from_alloc.status = "TRANSFERRED"
    from_alloc.end_datetime = func.now()

    new_to_alloc = models.BedAllocation(
        bed_id=to_bed.bed_id,
        admission_id=admission_id,
        assigned_by_personnel_id=personnel_id,
        status="OCCUPIED",
        start_datetime=func.now()
    )
    db.add(new_to_alloc)

    await _create_or_update_cleaning_task(
        db,
        bed_id=from_bed.bed_id,
        allocation_id=from_alloc.allocation_id,
        notes=f"Auto-generated on patient transfer of admission #{admission_id} to {to_bed.bed_code}"
    )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Database constraint violation during bed transfer.")

    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_TRANSFER", {
        "from_bed": req.from_bed_code.upper(),
        "to_bed": req.to_bed_code.upper(),
        "bed_code": req.to_bed_code.upper(),
        "admission_id": admission_id,
        "encounter_id": admission_id,
        "status": "OCCUPIED",
        "message": f"Patient transferred from {req.from_bed_code} to {req.to_bed_code}."
    }, actor=current_user.get("full_name") or current_user.get("username") or f"Staff #{current_user['user_id']}")

    return {
        "status": "SUCCESS",
        "message": f"Patient successfully transferred from {req.from_bed_code} to {req.to_bed_code}.",
        "target_bed_id": to_bed.bed_id,
        "target_allocation_id": new_to_alloc.allocation_id
    }


async def _release_admission_equipment(db: AsyncSession, admission_id: int) -> List[int]:
    """Releases all active equipment allocations for an admission."""
    eq_alloc_stmt = select(models.EquipmentAllocation).where(
        and_(
            models.EquipmentAllocation.admission_id == admission_id,
            models.EquipmentAllocation.status == "ACTIVE"
        )
    )
    eq_allocs = (await db.execute(eq_alloc_stmt)).scalars().all()
    released_ids = []
    for ea in eq_allocs:
        ea.status = "RELEASED"
        ea.end_datetime = func.now()
        eq_item = await db.get(models.Equipment, ea.equipment_id)
        if eq_item and eq_item.status == "ALLOCATED":
            eq_item.status = "AVAILABLE"
            eq_item.version += 1
            released_ids.append(eq_item.equipment_id)
    return released_ids


async def _notify_patient_discharge(admission_id: int, user_id: Any, role: Any) -> None:
    """Best-effort notification to patient service on bed discharge."""
    headers = {
        "X-User-Id": str(user_id),
        "X-User-Role": str(role),
        "X-Internal-Token": INTERNAL_SERVICE_SECRET,
    }
    async with httpx.AsyncClient() as client:
        try:
            await client.put(
                f"{PATIENT_SERVICE_URL}/admissions/discharge/{admission_id}",
                headers=headers
            )
        except httpx.RequestError as e:
            logger.warning("Could not notify patient service during discharge: %s", e)


@app.put("/discharge/{bed_code}")
async def discharge_bed(
    bed_code: str,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """Discharges bed stay, releases equipment, marks bed DIRTY, and creates a PENDING cleaning task."""
    bed_result = await db.execute(select(models.Bed).where(models.Bed.bed_code == bed_code.upper()))
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")

    if bed.status not in ("RESERVED", "OCCUPIED"):
        return {"status": "SUCCESS", "message": f"Bed is already {bed.status}."}

    alloc_res = await db.execute(
        select(models.BedAllocation).where(
            and_(
                models.BedAllocation.bed_id == bed.bed_id,
                models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
                models.BedAllocation.end_datetime.is_(None)
            )
        )
    )
    active_alloc = alloc_res.scalars().first()
    discharged_admission_id = active_alloc.admission_id if active_alloc else None

    if active_alloc:
        active_alloc.status = "COMPLETED"
        active_alloc.end_datetime = func.now()

    if discharged_admission_id:
        await _release_admission_equipment(db, discharged_admission_id)

    stmt = (
        update(models.Bed)
        .where(models.Bed.bed_id == bed.bed_id, models.Bed.version == bed.version)
        .values(status="DIRTY", version=bed.version + 1, update_datetime=func.now())
    )
    await db.execute(stmt)

    new_cleaning_task = await _create_or_update_cleaning_task(
        db,
        bed_id=bed.bed_id,
        allocation_id=active_alloc.allocation_id if active_alloc else None,
        notes=f"Auto-generated on discharge of admission #{discharged_admission_id or 'N/A'}"
    )
    await db.commit()

    if discharged_admission_id:
        await _notify_patient_discharge(discharged_admission_id, current_user["user_id"], current_user["role"])

    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_DIRTY", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "discharged_admission_id": discharged_admission_id,
        "discharged_encounter_id": discharged_admission_id,
        "cleaning_id": new_cleaning_task.cleaning_id,
        "status": "DIRTY",
        "version": bed.version + 1,
        "message": f"Bed {bed_code} discharged and queued for terminal cleaning."
    }, actor=current_user.get("full_name") or current_user.get("username") or f"Staff #{current_user['user_id']}")

    return {
        "status": "SUCCESS",
        "message": f"Patient discharged from {bed_code}. Bed transitioned to DIRTY. Cleaning task #{new_cleaning_task.cleaning_id} created."
    }


@app.post("/internal/admissions/{admission_id}/release")
async def release_admission_assets(
    admission_id: int,
    current_user: Dict[str, Any] = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """
    Internal endpoint called authoritatively by patient-service during clinical discharge.
    Releases all active equipment and bed allocations tied to the admission.
    Safely handles ambulatory/triage patients who never had a physical bed assigned.
    """
    # 1. Multi-Equipment Asset Release (handles multiple active devices for this admission)
    released_equipment_ids = await _release_admission_equipment(db, admission_id)

    # 2. Bed Allocation Release (handles patients without a physical bed safely)
    alloc_res = await db.execute(
        select(models.BedAllocation).where(
            and_(
                models.BedAllocation.admission_id == admission_id,
                models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
                models.BedAllocation.end_datetime.is_(None)
            )
        )
    )
    active_alloc = alloc_res.scalars().first()

    bed_released = False
    released_bed_code = None
    cleaning_task_id = None

    if active_alloc:
        active_alloc.status = "COMPLETED"
        active_alloc.end_datetime = func.now()

        bed = await db.get(models.Bed, active_alloc.bed_id)
        if bed:
            current_version = bed.version
            stmt = (
                update(models.Bed)
                .where(
                    and_(
                        models.Bed.bed_id == bed.bed_id,
                        models.Bed.version == current_version
                    )
                )
                .values(status="DIRTY", version=current_version + 1, update_datetime=func.now())
            )
            await db.execute(stmt)

            new_cleaning_task = await _create_or_update_cleaning_task(
                db,
                bed_id=bed.bed_id,
                allocation_id=active_alloc.allocation_id,
                notes=f"Auto-generated on clinical discharge of admission #{admission_id}"
            )
            await db.flush()
            cleaning_task_id = new_cleaning_task.cleaning_id
            released_bed_code = bed.bed_code
            bed_released = True

    # 3. MVCC SEQUENCE: Commit PostgreSQL transaction BEFORE Redis operations
    await db.commit()

    # 4. Redis cache invalidation and Pub/Sub ONLY after DB commit
    if bed_released and released_bed_code:
        await invalidate_grid_cache(redis)
        await publish_event(redis, "BED_DIRTY", {
            "bed_code": released_bed_code,
            "discharged_admission_id": admission_id,
            "cleaning_id": cleaning_task_id,
            "status": "DIRTY",
            "version": current_version + 1,
            "message": f"Bed {released_bed_code} discharged from admission #{admission_id}."
        }, actor=current_user.get("full_name") or current_user.get("username") or "Clinical Staff")

    return {
        "status": "SUCCESS",
        "admission_id": admission_id,
        "bed_released": bed_released,
        "bed_code": released_bed_code,
        "cleaning_task_id": cleaning_task_id,
        "released_equipment_count": len(released_equipment_ids)
    }


def _format_cleaning_task(t: models.CleaningTask) -> dict:
    bed = t.bed
    req_at = t.requested_datetime.isoformat() if t.requested_datetime else None
    start_at = t.started_datetime.isoformat() if t.started_datetime else None
    comp_at = t.completed_datetime.isoformat() if t.completed_datetime else None
    return {
        "cleaning_id": t.cleaning_id,
        "bed_id": t.bed_id,
        "allocation_id": t.allocation_id,
        "bed_code": bed.bed_code if bed else "UNKNOWN",
        "department": bed.department if bed else "UNKNOWN",
        "room_number": bed.room_number if bed else "UNKNOWN",
        "status": t.status,
        "personnel_id": t.personnel_id,
        "requested_datetime": req_at,
        "started_datetime": start_at,
        "completed_datetime": comp_at,
        "requested_at": req_at,
        "started_at": start_at,
        "completed_at": comp_at,
        "disinfection_notes": t.disinfection_notes
    }


@app.get("/cleaning/tasks")
async def get_cleaning_tasks(
    status_filter: Optional[str] = Query(None, description="PENDING, IN_PROGRESS, COMPLETED"),
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.CLEANING_CREW, UserRole.NURSE)),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(models.CleaningTask)
        .options(selectinload(models.CleaningTask.bed))
        .order_by(models.CleaningTask.requested_datetime.desc())
    )
    if status_filter:
        stmt = stmt.where(models.CleaningTask.status == status_filter.upper())

    result = await db.execute(stmt)
    return {"tasks": [_format_cleaning_task(t) for t in result.scalars().all()]}


@app.put("/cleaning/start/{cleaning_id}")
async def start_cleaning(
    cleaning_id: int,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.CLEANING_CREW)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    stmt = select(models.CleaningTask).options(selectinload(models.CleaningTask.bed)).where(models.CleaningTask.cleaning_id == cleaning_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Cleaning task not found.")

    task.status = "IN_PROGRESS"
    task.started_datetime = func.now()
    task.personnel_id = current_user["user_id"]

    if task.bed:
        task.bed.status = "CLEANING_IN_PROGRESS"
        task.bed.version += 1
        task.bed.update_datetime = func.now()

    await db.commit()
    await invalidate_grid_cache(redis)
    await publish_event(redis, "CLEANING_STARTED", {
        "cleaning_id": cleaning_id,
        "bed_id": task.bed_id,
        "bed_code": task.bed.bed_code if task.bed else None,
        "status": "CLEANING_IN_PROGRESS",
        "version": task.bed.version if task.bed else None
    }, actor=str(current_user["user_id"]))

    return {"status": "SUCCESS", "message": f"Cleaning task #{cleaning_id} started. Bed is now CLEANING_IN_PROGRESS."}


@app.put("/cleaning/complete/{cleaning_id}")
async def complete_cleaning(
    cleaning_id: int,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.CLEANING_CREW)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    stmt = select(models.CleaningTask).options(selectinload(models.CleaningTask.bed)).where(models.CleaningTask.cleaning_id == cleaning_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Cleaning task not found.")

    task.status = "COMPLETED"
    task.completed_datetime = func.now()
    if not task.personnel_id:
        task.personnel_id = current_user["user_id"]

    if task.bed:
        task.bed.status = "AVAILABLE"
        task.bed.version += 1
        task.bed.update_datetime = func.now()

    await db.commit()
    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_AVAILABLE", {
        "cleaning_id": cleaning_id,
        "bed_id": task.bed_id,
        "bed_code": task.bed.bed_code if task.bed else None,
        "status": "AVAILABLE",
        "version": task.bed.version if task.bed else None,
        "message": f"Bed {task.bed.bed_code if task.bed else ''} sanitized and is now AVAILABLE."
    }, actor=current_user.get("full_name") or current_user.get("username") or f"Housekeeping #{current_user['user_id']}")

    return {"status": "SUCCESS", "message": f"Cleaning task #{cleaning_id} completed. Bed {task.bed.bed_code if task.bed else ''} is now AVAILABLE!"}


@app.get("/equipment/types")
async def get_equipment_types(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(models.EquipmentType).order_by(models.EquipmentType.name)
    result = await db.execute(stmt)
    types = result.scalars().all()
    return {"types": [{"equipment_type_id": t.equipment_type_id, "name": t.name, "description": t.description} for t in types]}


@app.post("/equipment/types")
async def create_equipment_type(
    req: EquipmentTypeCreate,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db)
):
    existing = (await db.execute(select(models.EquipmentType).where(func.lower(models.EquipmentType.name) == req.name.strip().lower()))).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail="Equipment type already exists.")

    new_type = models.EquipmentType(name=req.name.strip(), description=req.description)
    db.add(new_type)
    await db.commit()
    await db.refresh(new_type)
    return {"status": "SUCCESS", "equipment_type_id": new_type.equipment_type_id, "name": new_type.name}


def _format_equipment_item(eq: models.Equipment) -> dict:
    active_alloc = next((a for a in eq.allocations if a.status == "ACTIVE" and a.end_datetime is None), None)
    adm_id = active_alloc.admission_id if active_alloc else None
    alloc_id = active_alloc.equipment_allocation_id if active_alloc else None
    type_name = eq.equipment_type.name if eq.equipment_type else "UNKNOWN"
    return {
        "equipment_id": eq.equipment_id,
        "serial_number": eq.serial_number,
        "equipment_name": eq.equipment_name,
        "equipment_type_id": eq.equipment_type_id,
        "equipment_type": type_name,
        "department": eq.department,
        "status": "ALLOCATED" if active_alloc else eq.status,
        "version": eq.version,
        "allocation_id": alloc_id,
        "admission_id": adm_id,
        "active_admission_id": adm_id,
        "encounter_id": adm_id,
        "active_encounter_id": adm_id,
        "allocations": [{"equipment_allocation_id": alloc_id, "admission_id": adm_id, "status": "ACTIVE"}] if alloc_id else []
    }


@app.get("/equipment/list")
async def get_equipment_list(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(models.Equipment)
        .options(
            selectinload(models.Equipment.equipment_type),
            selectinload(models.Equipment.allocations)
        )
        .order_by(models.Equipment.serial_number)
    )
    result = await db.execute(stmt)
    return {"equipment": [_format_equipment_item(eq) for eq in result.scalars().all()]}


@app.post("/equipment/create")
async def create_equipment(
    req: EquipmentCreate,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db)
):
    exists = (await db.execute(select(models.Equipment).where(models.Equipment.serial_number == req.serial_number.upper()))).scalars().first()
    if exists:
        raise HTTPException(status_code=400, detail=f"Serial number {req.serial_number} already registered.")

    type_id = req.equipment_type_id
    if not type_id and req.equipment_type:
        type_obj = (await db.execute(select(models.EquipmentType).where(func.lower(models.EquipmentType.name) == req.equipment_type.strip().lower()))).scalars().first()
        if type_obj:
            type_id = type_obj.equipment_type_id
        else:
            new_t = models.EquipmentType(name=req.equipment_type.strip().title())
            db.add(new_t)
            await db.commit()
            await db.refresh(new_t)
            type_id = new_t.equipment_type_id

    if not type_id:
        type_id = 1

    new_eq = models.Equipment(
        serial_number=req.serial_number.upper(),
        equipment_name=req.equipment_name,
        equipment_type_id=type_id,
        department=req.department.upper(),
        status="AVAILABLE",
        version=1
    )
    db.add(new_eq)
    await db.commit()
    await db.refresh(new_eq)
    return {"status": "SUCCESS", "equipment_id": new_eq.equipment_id}


async def _get_bed_admission_id(db: AsyncSession, bed_code: str) -> Optional[int]:
    """Finds active admission ID currently occupying or reserved at a bed."""
    stmt = (
        select(models.BedAllocation.admission_id)
        .join(models.Bed, models.Bed.bed_id == models.BedAllocation.bed_id)
        .where(
            models.Bed.bed_code == bed_code.upper(),
            models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
            models.BedAllocation.end_datetime.is_(None)
        )
    )
    result = await db.execute(stmt)
    return result.scalars().first()


@app.post("/equipment/allocate")
async def allocate_equipment(
    req: EquipmentAllocateRequest,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """Allocates equipment with optimistic locking on Equipment and partial unique index on EquipmentAllocation."""
    eq = await db.get(models.Equipment, req.equipment_id)
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found.")

    if eq.status != "AVAILABLE":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Equipment is currently {eq.status} (must be AVAILABLE).")

    admission_id = req.get_admission_id()
    target_bed_obj = None
    if req.bed_code:
        target_bed_obj = (await db.execute(select(models.Bed).where(models.Bed.bed_code == req.bed_code.upper()))).scalars().first()
        if not target_bed_obj:
            raise HTTPException(status_code=404, detail=f"Bed {req.bed_code} not found.")

    if not admission_id and req.bed_code:
        admission_id = await _get_bed_admission_id(db, req.bed_code)

    if not target_bed_obj and admission_id and admission_id > 0:
        alloc_bed_res = await db.execute(
            select(models.Bed)
            .join(models.BedAllocation, models.BedAllocation.bed_id == models.Bed.bed_id)
            .where(
                models.BedAllocation.admission_id == admission_id,
                models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
                models.BedAllocation.end_datetime.is_(None)
            )
        )
        target_bed_obj = alloc_bed_res.scalars().first()

    # Clinical & Hygiene Invariant: Medical equipment cannot be assigned to dirty or unsanitized beds
    if target_bed_obj and target_bed_obj.status in ("DIRTY", "CLEANING_IN_PROGRESS", "MAINTENANCE"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot allocate equipment to bed {target_bed_obj.bed_code}: bed is currently {target_bed_obj.status} and must be cleaned before medical equipment can be assigned."
        )

    if not admission_id:
        if target_bed_obj:
            admission_id = -target_bed_obj.bed_id
        else:
            raise HTTPException(status_code=400, detail="Cannot allocate equipment: valid bed code or active admission required.")

    personnel_id = current_user["user_id"]

    # Invariant: Conditional update on version enforces optimistic locking on equipment asset
    current_version = req.expected_version if req.expected_version is not None else eq.version
    stmt = (
        update(models.Equipment)
        .where(
            and_(
                models.Equipment.equipment_id == eq.equipment_id,
                models.Equipment.status == "AVAILABLE",
                models.Equipment.version == current_version
            )
        )
        .values(
            status="ALLOCATED",
            version=current_version + 1
        )
    )
    res = await db.execute(stmt)
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="State conflict detected: equipment was modified or allocated concurrently."
        )

    alloc = models.EquipmentAllocation(
        equipment_id=eq.equipment_id,
        admission_id=admission_id,
        allocated_by_personnel_id=personnel_id,
        status="ACTIVE",
        start_datetime=func.now()
    )
    db.add(alloc)

    try:
        await db.commit()
        await db.refresh(alloc)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Database constraint violation: This equipment item already has an active allocation."
        )

    await invalidate_grid_cache(redis)
    await publish_event(redis, "EQUIPMENT_ALLOCATED", {
        "equipment_id": eq.equipment_id,
        "equipment_name": eq.equipment_name,
        "equipment_allocation_id": alloc.equipment_allocation_id,
        "admission_id": admission_id,
        "encounter_id": admission_id
    }, actor=str(current_user["user_id"]))

    return {
        "status": "SUCCESS",
        "message": f"{eq.equipment_name} allocated to admission #{admission_id}.",
        "equipment_allocation_id": alloc.equipment_allocation_id
    }


@app.put("/equipment/release/{equipment_allocation_id}")
async def release_equipment(
    equipment_allocation_id: int,
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.CLEANING_CREW)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    alloc = await db.get(models.EquipmentAllocation, equipment_allocation_id)
    if not alloc:
        raise HTTPException(status_code=404, detail="Equipment allocation not found.")

    alloc.status = "RELEASED"
    alloc.end_datetime = func.now()

    eq = await db.get(models.Equipment, alloc.equipment_id)
    if eq:
        eq.status = "AVAILABLE"
        eq.version += 1

    await db.commit()
    await invalidate_grid_cache(redis)

    return {"status": "SUCCESS", "message": f"Equipment allocation #{equipment_allocation_id} released."}