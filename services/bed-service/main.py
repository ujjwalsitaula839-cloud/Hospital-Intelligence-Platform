from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
import httpx
from pydantic import BaseModel, Field
import redis.asyncio as aioredis
from sqlalchemy import and_, func, select, update
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
    async with redis_lifespan(app):
        yield


app = FastAPI(
    title="Hospital Intelligence Platform - Bed & Resource Management Service",
    version="2.3.0",
    lifespan=combined_lifespan
)


def sanitize_text(value: str | None, max_len: int = 500) -> str | None:
    """Strip HTML tags and control characters from user input."""
    if value is None:
        return None
    cleaned = re.sub(r'<[^>]+>', '', value)
    cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', cleaned)
    return cleaned[:max_len].strip()


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


@app.get("/grid")
async def get_bed_grid(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.CLEANING_CREW)),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    cached_beds = await redis.get(BEDS_GRID_CACHE_KEY)
    if cached_beds:
        return json.loads(cached_beds)

    await ensure_seed_data(db)

    beds_stmt = select(models.Bed).order_by(models.Bed.department, models.Bed.bed_code)
    beds = (await db.execute(beds_stmt)).scalars().all()

    alloc_stmt = select(models.BedAllocation).where(
        and_(
            models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
            models.BedAllocation.end_datetime.is_(None)
        )
    )
    active_allocs = (await db.execute(alloc_stmt)).scalars().all()
    active_bed_alloc_map: Dict[int, models.BedAllocation] = {a.bed_id: a for a in active_allocs}

    eq_alloc_stmt = (
        select(models.EquipmentAllocation)
        .options(selectinload(models.EquipmentAllocation.equipment))
        .where(
            and_(
                models.EquipmentAllocation.status == "ACTIVE",
                models.EquipmentAllocation.end_datetime.is_(None)
            )
        )
    )
    active_eq_allocs = (await db.execute(eq_alloc_stmt)).scalars().all()

    admission_eq_map: Dict[int, List[str]] = {}
    for eq_alloc in active_eq_allocs:
        if eq_alloc.equipment:
            admission_eq_map.setdefault(eq_alloc.admission_id, []).append(eq_alloc.equipment.equipment_name)

    bed_list = []
    for b in beds:
        active_alloc = active_bed_alloc_map.get(b.bed_id)
        active_adm_id = active_alloc.admission_id if active_alloc else None
        eq_list = admission_eq_map.get(active_adm_id, []) if active_adm_id else []

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
            "patient_id": None,
            "equipment": eq_list,
            "update_datetime": b.update_datetime.isoformat() if b.update_datetime else None,
            "updated_at": b.update_datetime.isoformat() if b.update_datetime else None
        })

    response_data = {"beds": bed_list}
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

    return {"status": "SUCCESS", "message": f"Bed {new_bed.bed_code} created successfully.", "bed_id": new_bed.bed_id}


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

    if not admission_id and req.patient_id:
        async with httpx.AsyncClient() as client:
            try:
                active_res = await client.get(
                    f"{PATIENT_SERVICE_URL}/admissions/active/{req.patient_id}",
                    headers=internal_headers
                )
                if active_res.status_code == 200 and active_res.json():
                    active_data = active_res.json()
                    admission_id = active_data.get("admission_id") or active_data.get("encounter_id")
                else:
                    create_res = await client.post(
                        f"{PATIENT_SERVICE_URL}/admissions/create",
                        json={
                            "patient_id": req.patient_id,
                            "primary_diagnosis": req.get_diagnosis(),
                            "acuity_level": req.acuity_level or "ESI_3",
                            "notes": req.notes
                        },
                        headers=internal_headers
                    )
                    if create_res.status_code in (200, 201):
                        adm_data = create_res.json()
                        admission_id = adm_data.get("admission_id") or adm_data.get("encounter_id")
                    else:
                        raise HTTPException(status_code=400, detail="Failed to initialize patient admission.")
            except httpx.RequestError:
                raise HTTPException(status_code=503, detail="Unable to reach Patient & Admission service.")

    if not admission_id:
        raise HTTPException(status_code=400, detail="Either admission_id, encounter_id, or patient_id is required for bed reservation.")

    async with httpx.AsyncClient() as client:
        try:
            adm_res = await client.get(
                f"{PATIENT_SERVICE_URL}/admissions/verify/{admission_id}",
                headers=internal_headers
            )
            if adm_res.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Admission #{admission_id} not found.")
            if adm_res.status_code != 200:
                raise HTTPException(status_code=502, detail="Patient verification microservice error.")

            adm_data = adm_res.json()
            is_active = adm_data.get("is_active", True)
            if not is_active and adm_data.get("admission_status") != "ACTIVE" and adm_data.get("encounter_status") != "ACTIVE":
                raise HTTPException(status_code=400, detail=f"Admission #{admission_id} is completed (must be ACTIVE).")
        except httpx.RequestError:
            raise HTTPException(status_code=503, detail="Unable to reach Patient & Admission service.")

    alloc_check = await db.execute(
        select(models.BedAllocation).where(
            and_(
                models.BedAllocation.admission_id == admission_id,
                models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
                models.BedAllocation.end_datetime.is_(None)
            )
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

    # Invariant: Conditional version increment enforces optimistic locking against race conditions
    current_version = req.expected_version if req.expected_version is not None else bed.version
    assigned_by = current_user["user_id"]

    stmt = (
        update(models.Bed)
        .where(
            and_(
                models.Bed.bed_id == bed.bed_id,
                models.Bed.status == "AVAILABLE",
                models.Bed.version == current_version
            )
        )
        .values(
            status="RESERVED",
            version=current_version + 1,
            update_datetime=func.now()
        )
    )
    res = await db.execute(stmt)
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="State conflict detected: bed was modified concurrently by another user."
        )

    new_alloc = models.BedAllocation(
        bed_id=bed.bed_id,
        admission_id=admission_id,
        assigned_by_personnel_id=assigned_by,
        status="RESERVED",
        start_datetime=func.now()
    )
    db.add(new_alloc)

    try:
        await db.commit()
        await db.refresh(new_alloc)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Database constraint violation: This bed or admission already has an active reservation."
        )

    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_RESERVED", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "allocation_id": new_alloc.allocation_id,
        "admission_id": admission_id,
        "encounter_id": admission_id,
        "status": "RESERVED"
    }, actor=str(current_user["user_id"]))

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
        "status": "OCCUPIED"
    }, actor=str(current_user["user_id"]))

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

    clean_task = models.CleaningTask(
        bed_id=from_bed.bed_id,
        allocation_id=from_alloc.allocation_id,
        status="PENDING",
        disinfection_notes=f"Auto-generated on patient transfer of admission #{admission_id} to {to_bed.bed_code}"
    )
    db.add(clean_task)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Database constraint violation during bed transfer.")

    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_TRANSFER", {
        "from_bed": req.from_bed_code.upper(),
        "to_bed": req.to_bed_code.upper(),
        "admission_id": admission_id,
        "encounter_id": admission_id
    }, actor=str(current_user["user_id"]))

    return {
        "status": "SUCCESS",
        "message": f"Patient successfully transferred from {req.from_bed_code} to {req.to_bed_code}.",
        "target_bed_id": to_bed.bed_id,
        "target_allocation_id": new_to_alloc.allocation_id
    }


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
        eq_alloc_stmt = select(models.EquipmentAllocation).where(
            and_(
                models.EquipmentAllocation.admission_id == discharged_admission_id,
                models.EquipmentAllocation.status == "ACTIVE"
            )
        )
        eq_allocs = (await db.execute(eq_alloc_stmt)).scalars().all()
        for ea in eq_allocs:
            ea.status = "RELEASED"
            ea.end_datetime = func.now()
            eq_item = await db.get(models.Equipment, ea.equipment_id)
            if eq_item and eq_item.status == "ALLOCATED":
                eq_item.status = "AVAILABLE"
                eq_item.version += 1

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

    new_cleaning_task = models.CleaningTask(
        bed_id=bed.bed_id,
        allocation_id=active_alloc.allocation_id if active_alloc else None,
        status="PENDING",
        disinfection_notes=f"Auto-generated on discharge of admission #{discharged_admission_id or 'N/A'}"
    )
    db.add(new_cleaning_task)
    await db.commit()

    if discharged_admission_id:
        internal_headers = {
            "X-User-Id": str(current_user["user_id"]),
            "X-User-Role": current_user["role"],
            "X-Internal-Token": INTERNAL_SERVICE_SECRET,
        }
        async with httpx.AsyncClient() as client:
            try:
                await client.put(
                    f"{PATIENT_SERVICE_URL}/admissions/discharge/{discharged_admission_id}",
                    headers=internal_headers
                )
            except httpx.RequestError as e:
                logger.warning("Could not notify patient service during discharge: %s", e)

    await invalidate_grid_cache(redis)
    await publish_event(redis, "BED_DIRTY", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "discharged_admission_id": discharged_admission_id,
        "discharged_encounter_id": discharged_admission_id,
        "cleaning_id": new_cleaning_task.cleaning_id,
        "status": "DIRTY"
    }, actor=str(current_user["user_id"]))

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
    released_equipment_ids = []

    # 1. Multi-Equipment Asset Release (handles multiple active devices for this admission)
    eq_alloc_stmt = select(models.EquipmentAllocation).where(
        and_(
            models.EquipmentAllocation.admission_id == admission_id,
            models.EquipmentAllocation.status == "ACTIVE"
        )
    )
    eq_allocs = (await db.execute(eq_alloc_stmt)).scalars().all()
    for ea in eq_allocs:
        ea.status = "RELEASED"
        ea.end_datetime = func.now()
        eq_item = await db.get(models.Equipment, ea.equipment_id)
        if eq_item and eq_item.status == "ALLOCATED":
            eq_item.status = "AVAILABLE"
            eq_item.version += 1
            released_equipment_ids.append(eq_item.equipment_id)

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

            new_cleaning_task = models.CleaningTask(
                bed_id=bed.bed_id,
                allocation_id=active_alloc.allocation_id,
                status="PENDING",
                disinfection_notes=f"Auto-generated on clinical discharge of admission #{admission_id}"
            )
            db.add(new_cleaning_task)
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
            "status": "DIRTY"
        }, actor=str(current_user.get("user_id", "system")))

    return {
        "status": "SUCCESS",
        "admission_id": admission_id,
        "bed_released": bed_released,
        "bed_code": released_bed_code,
        "cleaning_task_id": cleaning_task_id,
        "released_equipment_count": len(released_equipment_ids)
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
    tasks = result.scalars().all()

    return {
        "tasks": [
            {
                "cleaning_id": t.cleaning_id,
                "bed_id": t.bed_id,
                "allocation_id": t.allocation_id,
                "bed_code": t.bed.bed_code if t.bed else "UNKNOWN",
                "department": t.bed.department if t.bed else "UNKNOWN",
                "room_number": t.bed.room_number if t.bed else "UNKNOWN",
                "status": t.status,
                "personnel_id": t.personnel_id,
                "requested_datetime": t.requested_datetime.isoformat() if t.requested_datetime else None,
                "started_datetime": t.started_datetime.isoformat() if t.started_datetime else None,
                "completed_datetime": t.completed_datetime.isoformat() if t.completed_datetime else None,
                "requested_at": t.requested_datetime.isoformat() if t.requested_datetime else None,
                "started_at": t.started_datetime.isoformat() if t.started_datetime else None,
                "completed_at": t.completed_datetime.isoformat() if t.completed_datetime else None,
                "disinfection_notes": t.disinfection_notes
            } for t in tasks
        ]
    }


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
        "status": "CLEANING_IN_PROGRESS"
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
        "status": "AVAILABLE"
    }, actor=str(current_user["user_id"]))

    return {"status": "SUCCESS", "message": f"Cleaning task #{cleaning_id} completed. Bed {task.bed.bed_code if task.bed else ''} is now AVAILABLE!"}


@app.get("/equipment/types")
async def get_equipment_types(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    await ensure_seed_data(db)
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


@app.get("/equipment/list")
async def get_equipment_list(
    current_user: Dict[str, Any] = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    await ensure_seed_data(db)
    stmt = (
        select(models.Equipment)
        .options(
            selectinload(models.Equipment.equipment_type),
            selectinload(models.Equipment.allocations)
        )
        .order_by(models.Equipment.serial_number)
    )
    result = await db.execute(stmt)
    items = result.scalars().all()

    response = []
    for eq in items:
        active_alloc = next((a for a in eq.allocations if a.status == "ACTIVE" and a.end_datetime is None), None)
        response.append({
            "equipment_id": eq.equipment_id,
            "serial_number": eq.serial_number,
            "equipment_name": eq.equipment_name,
            "equipment_type_id": eq.equipment_type_id,
            "equipment_type": eq.equipment_type.name if eq.equipment_type else "UNKNOWN",
            "department": eq.department,
            "status": "ALLOCATED" if active_alloc else eq.status,
            "version": eq.version,
            "allocation_id": active_alloc.equipment_allocation_id if active_alloc else None,
            "admission_id": active_alloc.admission_id if active_alloc else None,
            "active_admission_id": active_alloc.admission_id if active_alloc else None,
            "encounter_id": active_alloc.admission_id if active_alloc else None,
            "active_encounter_id": active_alloc.admission_id if active_alloc else None
        })

    return {"equipment": response}


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
    if not admission_id and req.bed_code:
        bed_res = await db.execute(select(models.Bed).where(models.Bed.bed_code == req.bed_code.upper()))
        target_bed = bed_res.scalars().first()
        if target_bed and target_bed.status in ("RESERVED", "OCCUPIED"):
            alloc_res = await db.execute(
                select(models.BedAllocation).where(
                    and_(
                        models.BedAllocation.bed_id == target_bed.bed_id,
                        models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
                        models.BedAllocation.end_datetime.is_(None)
                    )
                )
            )
            target_alloc = alloc_res.scalars().first()
            if target_alloc:
                admission_id = target_alloc.admission_id

    if not admission_id:
        raise HTTPException(status_code=400, detail="Cannot allocate equipment without an active admission.")

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