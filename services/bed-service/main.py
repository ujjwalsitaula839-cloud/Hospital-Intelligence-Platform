import json
import os
import httpx
from datetime import datetime, timezone
from fastapi import FastAPI, Header, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.sql import func  
from pydantic import BaseModel
from database import get_db
import models
import redis.asyncio as aioredis
from redis_client import lifespan, get_redis

app = FastAPI(title="Bed Service", lifespan=lifespan)

# --- CACHE & PUB/SUB CONSTANTS ---
BEDS_GRID_CACHE_KEY = "beds:grid:all"
CACHE_TTL_SECONDS = 300  # 5 minutes
BED_EVENTS_CHANNEL = "bed:events"  # Pub/Sub channel for real-time WebSocket distribution

@app.get("/redis-test") 
async def redis_test(redis: aioredis.Redis = Depends(get_redis)):
    await redis.set("test_key", "Hello from Bed Service!", ex=60)
    value = await redis.get("test_key")
    return {
        "status": "success",
        "redis_response": value,
        "message": "Redis connection pool is working perfectly!"
    }

PATIENT_SERVICE_URL = os.getenv("PATIENT_SERVICE_URL", "http://hip-patient-service:8002")

class BedCreate(BaseModel):
    bed_code: str
    department: str


@app.get("/grid")
async def get_bed_grid(
    x_user_id: str = Header(None), 
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Direct internal access forbidden. Use the API Gateway.")

    cached_beds = await redis.get(BEDS_GRID_CACHE_KEY)
    if cached_beds:
        print("[CACHE HIT] Returning bed grid from Redis")
        return json.loads(cached_beds)

    print("[CACHE MISS] Querying PostgreSQL database")
    result = await db.execute(select(models.BedRegistry))
    beds = result.scalars().all()
    
    response_data = {
        "beds": [
            {
                "bed_code": b.bed_code,
                "department": b.department,
                "status": b.status,
                "assigned_patient_id": b.assigned_patient_id,
                "reserved_by": b.reserved_by,
                "reserved_at": b.reserved_at.isoformat() if b.reserved_at else None,
                "released_by": b.released_by,
                "released_at": b.released_at.isoformat() if b.released_at else None
            } for b in beds
        ]
    }

    await redis.set(
        BEDS_GRID_CACHE_KEY, 
        json.dumps(response_data), 
        ex=CACHE_TTL_SECONDS
    )

    return response_data


@app.post("/create")
async def create_bed(
    bed_data: BedCreate, 
    x_user_id: str = Header(None), 
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Gateway verification failed.")

    result = await db.execute(select(models.BedRegistry).where(models.BedRegistry.bed_code == bed_data.bed_code))
    existing_bed = result.scalars().first()
    if existing_bed:
        raise HTTPException(status_code=400, detail="A bed with this code already exists.")

    new_bed = models.BedRegistry(
        bed_code=bed_data.bed_code,
        department=bed_data.department,
        status="AVAILABLE",
        version=1
    )
    db.add(new_bed)
    await db.commit()
    await db.refresh(new_bed)

    # 1. Cache Invalidation
    await redis.delete(BEDS_GRID_CACHE_KEY)
    print(f"[CACHE EVICTED] Invalidated key '{BEDS_GRID_CACHE_KEY}' due to new bed creation")

    # 2. Pub/Sub Event Broadcast 
    event_payload = {
        "event_type": "BED_CREATED",
        "bed_code": new_bed.bed_code,
        "department": new_bed.department,
        "status": "AVAILABLE",
        "actor": x_user_id,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await redis.publish(BED_EVENTS_CHANNEL, json.dumps(event_payload))
    print(f"[PUB/SUB EVENT] Published BED_CREATED for {new_bed.bed_code} to '{BED_EVENTS_CHANNEL}'")

    return {"status": "SUCCESS", "message": f"Bed {new_bed.bed_code} created successfully."}


@app.put("/reserve/{bed_code}")
async def reserve_bed(
    bed_code: str,
    patient_id: str,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Gateway verification failed.")

    assigned_result = await db.execute(
        select(models.BedRegistry).where(models.BedRegistry.assigned_patient_id == patient_id)
    )
    already_assigned = assigned_result.scalars().first()
    
    if already_assigned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Business Rule Violation: Patient '{patient_id}' is already active in bed '{already_assigned.bed_code}'."
        )

    async with httpx.AsyncClient() as client:
        try:
            patient_response = await client.get(
                f"{PATIENT_SERVICE_URL}/verify/{patient_id}", 
                headers={"x-user-id": x_user_id}
            )
            if patient_response.status_code == 404:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Data Integrity Violation: Patient ID '{patient_id}' does not exist."
                )
            elif patient_response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Dependency Failure: Patient verification service is unhealthy."
                )
        except httpx.RequestError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="System Fault: Unable to reach the Patient microservice."
            )

    bed_result = await db.execute(
        select(models.BedRegistry).where(models.BedRegistry.bed_code == bed_code)
    )
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")
    
    if bed.status != "AVAILABLE" or bed.assigned_patient_id is not None:
        raise HTTPException(status_code=400, detail="Bed is currently occupied or unavailable.")

    current_version = bed.version
    stmt = (
        update(models.BedRegistry)
        .where(
            models.BedRegistry.bed_code == bed_code,
            models.BedRegistry.version == current_version
        )
        .values(
            status="RESERVED",
            assigned_patient_id=patient_id,
            version=current_version + 1,
            reserved_by=x_user_id,
            reserved_at=func.now()
        )
    )
    res = await db.execute(stmt)

    if res.rowcount == 0:
        raise HTTPException(status_code=409, detail="State drift detected. Try again.")
        
    await db.commit()

    # 1. Cache Invalidation
    await redis.delete(BEDS_GRID_CACHE_KEY)
    print(f"[CACHE EVICTED] Invalidated key '{BEDS_GRID_CACHE_KEY}' due to bed reservation")

    # 2. Pub/Sub Event Broadcast
    event_payload = {
        "event_type": "BED_RESERVED",
        "bed_code": bed_code,
        "patient_id": patient_id,
        "status": "RESERVED",
        "actor": x_user_id,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await redis.publish(BED_EVENTS_CHANNEL, json.dumps(event_payload))
    print(f"[PUB/SUB EVENT] Published BED_RESERVED for {bed_code} to '{BED_EVENTS_CHANNEL}'")

    return {"status": "SUCCESS", "message": f"Bed {bed_code} successfully reserved."}


@app.put("/release/{bed_code}")
async def release_bed(
    bed_code: str,
    patient_id: str,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Gateway verification failed.")

    bed_result = await db.execute(
        select(models.BedRegistry).where(models.BedRegistry.bed_code == bed_code)
    )
    bed = bed_result.scalars().first()
    if not bed:
        raise HTTPException(status_code=404, detail="Bed location not found.")
    
    if bed.status == "AVAILABLE":
        return {"status": "SUCCESS", "message": "Bed is already vacant."}

    if bed.assigned_patient_id != patient_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security Mismatch: The patient tracking parameter does not match the actual current occupant of this bed asset."
        )

    current_version = bed.version
    stmt = (
        update(models.BedRegistry)
        .where(
            models.BedRegistry.bed_code == bed_code,
            models.BedRegistry.version == current_version
        )
        .values(
            status="AVAILABLE",
            assigned_patient_id=None,
            version=current_version + 1,
            released_by=x_user_id,
            released_at=func.now()
        )
    )
    res = await db.execute(stmt)

    if res.rowcount == 0:
        raise HTTPException(status_code=409, detail="State drift detected. Try again.")
        
    await db.commit()

    # 1. Cache Invalidation
    await redis.delete(BEDS_GRID_CACHE_KEY)
    print(f"[CACHE EVICTED] Invalidated key '{BEDS_GRID_CACHE_KEY}' due to bed release")

    # 2. Pub/Sub Event Broadcast
    event_payload = {
        "event_type": "BED_RELEASED",
        "bed_code": bed_code,
        "previous_patient_id": patient_id,
        "status": "AVAILABLE",
        "actor": x_user_id,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await redis.publish(BED_EVENTS_CHANNEL, json.dumps(event_payload))
    print(f"[PUB/SUB EVENT] Published BED_RELEASED for {bed_code} to '{BED_EVENTS_CHANNEL}'")

    return {"status": "SUCCESS", "message": f"Bed {bed_code} has been successfully wiped and marked AVAILABLE."}