import json
import os
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import httpx
from fastapi import FastAPI, Header, HTTPException, status, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import func
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field
import models
from database import get_db, init_db
import redis.asyncio as aioredis
from redis_client import lifespan as redis_lifespan, get_redis
from contextlib import asynccontextmanager

# --- CACHE & PUB/SUB CONSTANTS ---
BEDS_GRID_CACHE_KEY = "beds:grid:all"
CACHE_TTL_SECONDS = 300  # 5 minutes
BED_EVENTS_CHANNEL = "bed:events"
PATIENT_SERVICE_URL = os.getenv("PATIENT_SERVICE_URL", "http://hip-patient-service:8002")

@asynccontextmanager
async def combined_lifespan(app: FastAPI):
    # 1. Initialize database tables
    await init_db()
    # 2. Initialize Redis pool
    async with redis_lifespan(app):
        yield

app = FastAPI(
    title="Hospital Intelligence Platform - Bed & Resource Management Service",
    version="2.3.0",
    lifespan=combined_lifespan
)

# --- PYDANTIC SCHEMAS ---

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
    primary_diagnosis: Optional[str] = None
    diagnosis: Optional[str] = "Observation"
    notes: Optional[str] = None

    def get_admission_id(self) -> Optional[int]:
        return self.admission_id or self.encounter_id

    def get_diagnosis(self) -> str:
        return self.primary_diagnosis or self.diagnosis or "Observation"


class BedTransferRequest(BaseModel):
    from_bed_code: str
    to_bed_code: str


class EquipmentTypeCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: Optional[str] = None


class EquipmentCreate(BaseModel):
    serial_number: str
    equipment_name: str
    equipment_type_id: Optional[int] = None
    equipment_type: Optional[str] = None  # Fallback: type name (e.g. "VENTILATOR")
    department: str = "EMERGENCY"


class EquipmentAllocateRequest(BaseModel):
    equipment_id: int
    admission_id: Optional[int] = None
    encounter_id: Optional[int] = None
    bed_code: Optional[str] = None  # Resolves active admission on bed
    expected_version: Optional[int] = None

    def get_admission_id(self) -> Optional[int]:
        return self.admission_id or self.encounter_id


# Helper to publish events to Redis Pub/Sub
async def publish_event(redis: aioredis.Redis, event_type: str, data: dict, actor: Optional[str] = None):
    payload = {
        "event_type": event_type,
        "actor": actor or "system",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **data
    }
    try:
        await redis.publish(BED_EVENTS_CHANNEL, json.dumps(payload))
        print(f"[PUB/SUB EVENT] Published {event_type} to '{BED_EVENTS_CHANNEL}'")
    except Exception as e:
        print(f"[PUB/SUB WARNING] Failed to publish event {event_type}: {e}")


async def ensure_seed_data(db: AsyncSession):
    """Seed initial beds, equipment types, and equipment if tables are empty."""
    # 1. Seed Beds in bed table
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

    # 2. Seed Equipment Types
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

    # 3. Seed Equipment
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


# --- 1. HEALTH & BED MATRIX TELEMETRY ---

@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(select(models.Bed).limit(1))
        return {"status": "healthy", "database": "connected", "service": "bed-service"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database connection failed: {str(e)}"
        )


@app.get("/grid")
async def get_bed_grid(
    x_user_id: str = Header(None), 
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    # Try Redis Cache first
    cached_beds = await redis.get(BEDS_GRID_CACHE_KEY)
    if cached_beds:
        return json.loads(cached_beds)

    # Ensure seed data exists
    await ensure_seed_data(db)

    # Query all physical bed assets
    stmt = (
        select(models.Bed)
        .order_by(models.Bed.department, models.Bed.bed_code)
    )
    result = await db.execute(stmt)
    beds = result.scalars().all()

    # Query all active bed allocations (stays)
    alloc_stmt = (
        select(models.BedAllocation)
        .where(
            and_(
                models.BedAllocation.status.in_(["RESERVED", "OCCUPIED"]),
                models.BedAllocation.end_datetime.is_(None)
            )
        )
    )
    alloc_res = await db.execute(alloc_stmt)
    active_allocs = alloc_res.scalars().all()
    active_bed_alloc_map: Dict[int, models.BedAllocation] = {a.bed_id: a for a in active_allocs}

    # Query all active equipment allocations
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
    eq_alloc_res = await db.execute(eq_alloc_stmt)
    active_eq_allocs = eq_alloc_res.scalars().all()
    
    # Map admission_id -> list of equipment names
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
    x_user_id: str = Header(None), 
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

    await redis.delete(BEDS_GRID_CACHE_KEY)
    await publish_event(redis, "BED_CREATED", {
        "bed_id": new_bed.bed_id,
        "bed_code": new_bed.bed_code,
        "department": new_bed.department,
        "status": new_bed.status
    }, actor=x_user_id)

    return {"status": "SUCCESS", "message": f"Bed {new_bed.bed_code} created successfully.", "bed_id": new_bed.bed_id}


# --- 2. BED RESERVATION, ADMISSION, TRANSFER & DISCHARGE ---

@app.put("/reserve/{bed_code}")
async def reserve_bed(
    bed_code: str,
    req: ReserveBedRequest,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """
    Reserve bed for an Admission with two-tier concurrency protection:
    1. Dynamic Optimistic Locking on Bed asset (atomic conditional version check).
    2. Insertion into BedAllocation with PostgreSQL partial unique index protection.
    """
    admission_id = req.get_admission_id()

    # If admission_id is not directly supplied but patient_id is, resolve or create active admission
    if not admission_id and req.patient_id:
        async with httpx.AsyncClient() as client:
            try:
                active_res = await client.get(
                    f"{PATIENT_SERVICE_URL}/admissions/active/{req.patient_id}",
                    headers={"x-user-id": str(x_user_id or 1)}
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
                        headers={"x-user-id": str(x_user_id or 1)}
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

    # 1. Verify Admission is valid & active via Patient Service
    async with httpx.AsyncClient() as client:
        try:
            adm_res = await client.get(
                f"{PATIENT_SERVICE_URL}/admissions/verify/{admission_id}",
                headers={"x-user-id": str(x_user_id or 1)}
            )
            if adm_res.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Admission #{admission_id} not found.")
            elif adm_res.status_code != 200:
                raise HTTPException(status_code=502, detail="Patient verification microservice error.")
            
            adm_data = adm_res.json()
            is_active = adm_data.get("is_active", True)
            if not is_active and adm_data.get("admission_status") != "ACTIVE" and adm_data.get("encounter_status") != "ACTIVE":
                raise HTTPException(status_code=400, detail=f"Admission #{admission_id} is completed (must be ACTIVE).")
        except httpx.RequestError:
            raise HTTPException(status_code=503, detail="Unable to reach Patient & Admission service.")

    # 2. Check if admission already has an active bed reservation or admission
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

    # 3. Locate target Bed asset
    bed_result = await db.execute(select(models.Bed).where(models.Bed.bed_code == bed_code.upper()))
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")

    if bed.status != "AVAILABLE":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bed {bed_code} is currently {bed.status} (must be AVAILABLE)."
        )

    # 4. Tier 1: Dynamic Optimistic Locking Update on Bed Asset
    current_version = req.expected_version if req.expected_version is not None else bed.version
    assigned_by = int(x_user_id) if x_user_id and x_user_id.isdigit() else None
    
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

    # 5. Tier 2: Create stay ledger entry in BedAllocation protected by PostgreSQL Partial Unique Index
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

    # 6. Invalidate Cache & Broadcast
    await redis.delete(BEDS_GRID_CACHE_KEY)
    await publish_event(redis, "BED_RESERVED", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "allocation_id": new_alloc.allocation_id,
        "admission_id": admission_id,
        "encounter_id": admission_id,
        "status": "RESERVED"
    }, actor=x_user_id)

    return {
        "status": "SUCCESS",
        "message": f"Bed {bed_code} successfully reserved for admission #{admission_id}.",
        "bed_id": bed.bed_id,
        "allocation_id": new_alloc.allocation_id
    }


@app.put("/admit/{bed_code}")
async def confirm_admission(
    bed_code: str,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """Patient arrives at bed: switches bed asset and stay ledger from RESERVED -> OCCUPIED."""
    bed_result = await db.execute(
        select(models.Bed).where(models.Bed.bed_code == bed_code.upper())
    )
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")

    if bed.status != "RESERVED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Bed {bed_code} must be in RESERVED state to confirm arrival (current: {bed.status}).")

    # Locate active BedAllocation
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

    # Optimistic locking conditional update on Bed asset
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

    await redis.delete(BEDS_GRID_CACHE_KEY)
    await publish_event(redis, "BED_OCCUPIED", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "allocation_id": active_alloc.allocation_id if active_alloc else None,
        "admission_id": active_alloc.admission_id if active_alloc else None,
        "status": "OCCUPIED"
    }, actor=x_user_id)

    return {"status": "SUCCESS", "message": f"Patient arrival confirmed. Bed {bed_code} is now OCCUPIED."}


@app.post("/transfer")
async def transfer_patient_bed(
    req: BedTransferRequest,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """
    Patient moves from Bed A to Bed B:
    1. Source Bed A transitions -> DIRTY with a PENDING cleaning_task.
    2. Source BedAllocation completed with status=TRANSFERRED, end_datetime=now().
    3. Target Bed B transitions -> OCCUPIED.
    4. Target BedAllocation created with status=OCCUPIED.
    All history is preserved!
    """
    # 1. Locate Source Bed and its active stay
    from_result = await db.execute(
        select(models.Bed).where(models.Bed.bed_code == req.from_bed_code.upper())
    )
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

    # 2. Locate Target Bed
    to_result = await db.execute(select(models.Bed).where(models.Bed.bed_code == req.to_bed_code.upper()))
    to_bed = to_result.scalars().first()
    if not to_bed:
        raise HTTPException(status_code=404, detail=f"Target bed {req.to_bed_code} not found.")

    if to_bed.status != "AVAILABLE":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Target bed {req.to_bed_code} is {to_bed.status} (must be AVAILABLE).")

    personnel_id = int(x_user_id) if x_user_id and x_user_id.isdigit() else None
    admission_id = from_alloc.admission_id

    # 3. Atomic conditional update on target bed
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

    # 4. Atomic update on source bed -> DIRTY
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

    # 5. Close Source Stay Ledger
    from_alloc.status = "TRANSFERRED"
    from_alloc.end_datetime = func.now()

    # 6. Create Target Stay Ledger
    new_to_alloc = models.BedAllocation(
        bed_id=to_bed.bed_id,
        admission_id=admission_id,
        assigned_by_personnel_id=personnel_id,
        status="OCCUPIED",
        start_datetime=func.now()
    )
    db.add(new_to_alloc)

    # 7. Auto-generate Cleaning Task for Source Bed
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

    # 8. Invalidate Cache & Broadcast
    await redis.delete(BEDS_GRID_CACHE_KEY)
    await publish_event(redis, "BED_TRANSFER", {
        "from_bed": req.from_bed_code.upper(),
        "to_bed": req.to_bed_code.upper(),
        "admission_id": admission_id,
        "encounter_id": admission_id
    }, actor=x_user_id)

    return {
        "status": "SUCCESS",
        "message": f"Patient successfully transferred from {req.from_bed_code} to {req.to_bed_code}.",
        "target_bed_id": to_bed.bed_id,
        "target_allocation_id": new_to_alloc.allocation_id
    }


@app.put("/discharge/{bed_code}")
async def discharge_bed(
    bed_code: str,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """
    Patient Discharge:
    1. Completes active stay ledger in BedAllocation (status=COMPLETED, end_datetime=now()).
    2. Releases attached equipment allocations for this admission.
    3. Transitions Bed -> DIRTY with version increment.
    4. Auto-creates PENDING cleaning_task for EVS.
    5. Discharges ADMISSION in Patient Service.
    """
    bed_result = await db.execute(
        select(models.Bed).where(models.Bed.bed_code == bed_code.upper())
    )
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")

    if bed.status not in ("RESERVED", "OCCUPIED"):
        return {"status": "SUCCESS", "message": f"Bed is already {bed.status}."}

    # Locate active BedAllocation
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

    # 1. Close Active Stay in BedAllocation
    if active_alloc:
        active_alloc.status = "COMPLETED"
        active_alloc.end_datetime = func.now()

    # 2. Release Equipment Allocations for this admission
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

    # 3. Transition Bed to DIRTY with atomic update
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

    # 4. Auto-generate Cleaning Task for EVS
    new_cleaning_task = models.CleaningTask(
        bed_id=bed.bed_id,
        allocation_id=active_alloc.allocation_id if active_alloc else None,
        status="PENDING",
        disinfection_notes=f"Auto-generated on discharge of admission #{discharged_admission_id or 'N/A'}"
    )
    db.add(new_cleaning_task)
    await db.commit()

    # 5. Complete Admission in Patient Service
    if discharged_admission_id:
        async with httpx.AsyncClient() as client:
            try:
                await client.put(
                    f"{PATIENT_SERVICE_URL}/admissions/discharge/{discharged_admission_id}",
                    headers={"x-user-id": str(x_user_id or 1)}
                )
            except httpx.RequestError as e:
                print(f"[DISCHARGE WARNING] Could not notify patient service: {e}")

    # 6. Invalidate Cache & Broadcast
    await redis.delete(BEDS_GRID_CACHE_KEY)
    await publish_event(redis, "BED_DIRTY", {
        "bed_id": bed.bed_id,
        "bed_code": bed_code.upper(),
        "discharged_admission_id": discharged_admission_id,
        "discharged_encounter_id": discharged_admission_id,
        "cleaning_id": new_cleaning_task.cleaning_id,
        "status": "DIRTY"
    }, actor=x_user_id)

    return {
        "status": "SUCCESS",
        "message": f"Patient discharged from {bed_code}. Bed transitioned to DIRTY. Cleaning task #{new_cleaning_task.cleaning_id} created."
    }


# --- 3. CLEANING CREW TERMINAL ENDPOINTS ---

@app.get("/cleaning/tasks")
async def get_cleaning_tasks(
    status_filter: Optional[str] = Query(None, description="PENDING, IN_PROGRESS, COMPLETED"),
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
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    stmt = select(models.CleaningTask).options(selectinload(models.CleaningTask.bed)).where(models.CleaningTask.cleaning_id == cleaning_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Cleaning task not found.")

    personnel_id = int(x_user_id) if x_user_id and x_user_id.isdigit() else None
    task.status = "IN_PROGRESS"
    task.started_datetime = func.now()
    task.personnel_id = personnel_id

    if task.bed:
        task.bed.status = "CLEANING_IN_PROGRESS"
        task.bed.version += 1
        task.bed.update_datetime = func.now()

    await db.commit()

    await redis.delete(BEDS_GRID_CACHE_KEY)
    await publish_event(redis, "CLEANING_STARTED", {
        "cleaning_id": cleaning_id,
        "bed_id": task.bed_id,
        "bed_code": task.bed.bed_code if task.bed else None,
        "status": "CLEANING_IN_PROGRESS"
    }, actor=x_user_id)

    return {"status": "SUCCESS", "message": f"Cleaning task #{cleaning_id} started. Bed is now CLEANING_IN_PROGRESS."}


@app.put("/cleaning/complete/{cleaning_id}")
async def complete_cleaning(
    cleaning_id: int,
    x_user_id: str = Header(None),
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

    await redis.delete(BEDS_GRID_CACHE_KEY)
    await publish_event(redis, "BED_AVAILABLE", {
        "cleaning_id": cleaning_id,
        "bed_id": task.bed_id,
        "bed_code": task.bed.bed_code if task.bed else None,
        "status": "AVAILABLE"
    }, actor=x_user_id)

    return {"status": "SUCCESS", "message": f"Cleaning task #{cleaning_id} completed. Bed {task.bed.bed_code if task.bed else ''} is now AVAILABLE!"}


# --- 4. MEDICAL EQUIPMENT & EQUIPMENT TYPE MANAGEMENT ---

@app.get("/equipment/types")
async def get_equipment_types(db: AsyncSession = Depends(get_db)):
    await ensure_seed_data(db)
    stmt = select(models.EquipmentType).order_by(models.EquipmentType.name)
    result = await db.execute(stmt)
    types = result.scalars().all()
    return {"types": [{"equipment_type_id": t.equipment_type_id, "name": t.name, "description": t.description} for t in types]}


@app.post("/equipment/types")
async def create_equipment_type(req: EquipmentTypeCreate, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(models.EquipmentType).where(func.lower(models.EquipmentType.name) == req.name.strip().lower()))).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail="Equipment type already exists.")

    new_type = models.EquipmentType(name=req.name.strip(), description=req.description)
    db.add(new_type)
    await db.commit()
    await db.refresh(new_type)
    return {"status": "SUCCESS", "equipment_type_id": new_type.equipment_type_id, "name": new_type.name}


@app.get("/equipment/list")
async def get_equipment_list(db: AsyncSession = Depends(get_db)):
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
async def create_equipment(req: EquipmentCreate, db: AsyncSession = Depends(get_db)):
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
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """
    Assign Equipment to an Admission with dynamic optimistic locking & PostgreSQL partial unique index protection.
    """
    eq = await db.get(models.Equipment, req.equipment_id)
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found.")

    if eq.status != "AVAILABLE":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Equipment is currently {eq.status} (must be AVAILABLE).")

    admission_id = req.get_admission_id()

    # If bed_code supplied instead of admission_id, resolve active admission on that bed
    if not admission_id and req.bed_code:
        bed_res = await db.execute(
            select(models.Bed).where(models.Bed.bed_code == req.bed_code.upper())
        )
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

    personnel_id = int(x_user_id) if x_user_id and x_user_id.isdigit() else None

    # Tier 1: Dynamic Optimistic Locking Update on Equipment Asset
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

    # Tier 2: Create EquipmentAllocation ledger entry protected by PostgreSQL Partial Unique Index
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

    await redis.delete(BEDS_GRID_CACHE_KEY)
    await publish_event(redis, "EQUIPMENT_ALLOCATED", {
        "equipment_id": eq.equipment_id,
        "equipment_name": eq.equipment_name,
        "equipment_allocation_id": alloc.equipment_allocation_id,
        "admission_id": admission_id,
        "encounter_id": admission_id
    }, actor=x_user_id)

    return {
        "status": "SUCCESS",
        "message": f"{eq.equipment_name} allocated to admission #{admission_id}.",
        "equipment_allocation_id": alloc.equipment_allocation_id
    }


@app.put("/equipment/release/{equipment_allocation_id}")
async def release_equipment(
    equipment_allocation_id: int,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """Releases an equipment allocation, setting status=RELEASED and returning equipment to AVAILABLE."""
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
    await redis.delete(BEDS_GRID_CACHE_KEY)

    return {"status": "SUCCESS", "message": f"Equipment allocation #{equipment_allocation_id} released."}