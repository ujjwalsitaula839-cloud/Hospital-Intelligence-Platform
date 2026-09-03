import uuid
import os
import httpx
from typing import Optional, Any
from contextlib import asynccontextmanager
from fastapi import FastAPI, Header, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import models
from database import get_db, init_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure tables are created asynchronously
    await init_db()
    yield

app = FastAPI(
    title="Hospital Intelligence Platform - Patient Service",
    lifespan=lifespan
)

# 1. PYDANTIC SCHEMAS
class PatientCreate(BaseModel):
    name: str
    diagnosis: str
    room: str

# 2. INTERNAL MICROSERVICE URL CONFIGURATION
BED_SERVICE_URL = os.getenv("BED_SERVICE_URL", "http://hip-bed-service:8003")


# 3. CORE ENDPOINTS

@app.get("/records")
async def get_patient_records(
    x_user_id: str = Header(None),
    x_user_username: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    # Guard Rule: Reject direct internal calls lacking gateway context
    if not x_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Direct internal access forbidden. You must route through the API Gateway."
        )

    # Secure async relational query
    result = await db.execute(
        select(models.PatientRecord).where(models.PatientRecord.assigned_user_id == x_user_id)
    )
    user_records = result.scalars().all()

    return {
        "logged_in_as": x_user_username,
        "assigned_user_id": x_user_id,
        "records": [
            {
                "patient_id": r.patient_id,
                "name": r.name,
                "diagnosis": r.diagnosis,
                "room": r.room
            } for r in user_records
        ]
    }


@app.post("/register")
async def register_patient(
    patient: PatientCreate,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db)
): 
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Gateway verification failed.")
    
    # Build the exact PatientRecord mapping matching models.py
    new_patient = models.PatientRecord(
        patient_id=str(uuid.uuid4())[:8],
        name=patient.name,
        diagnosis=patient.diagnosis,
        room=patient.room,
        assigned_user_id=x_user_id
    )
    
    db.add(new_patient)
    await db.commit()
    await db.refresh(new_patient)
    
    return {
        "status": "SUCCESS", 
        "patient_id": new_patient.patient_id,
        "internal_id": new_patient.id
    }


@app.get("/verify/{patient_id}")
async def verify_patient(
    patient_id: str,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    # Guard Rule: Ensure internal verification context is intact
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Gateway verification failed.")

    result = await db.execute(
        select(models.PatientRecord).where(models.PatientRecord.patient_id == patient_id)
    )
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="Patient registry match not found.")

    return {"status": "VALID", "patient_id": record.patient_id}


@app.delete("/checkout/{patient_id}")
async def checkout_patient(
    patient_id: str,
    x_user_id: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Gateway verification failed.")

    # 1. Locate the patient record
    result = await db.execute(
        select(models.PatientRecord).where(models.PatientRecord.patient_id == patient_id)
    )
    patient = result.scalars().first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient record not found.")

    # Capture the room metadata before removing the database row
    assigned_bed_code = patient.room 

    # 2. Network Cleanup Loop: If a bed is linked, release it first!
    if assigned_bed_code:
        async with httpx.AsyncClient() as client:
            try:
                # Fire the ownership-verified release request to the bed service mesh
                bed_response = await client.put(
                    f"{BED_SERVICE_URL}/release/{assigned_bed_code}?patient_id={patient_id}",
                    headers={"x-user-id": x_user_id}
                )
                
                # If the bed service reports an issue (other than already vacant), halt the deletion
                if bed_response.status_code not in [200, 404]:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="Dependency Failure: Failed to safely release the assigned bed asset. Deletion aborted."
                    )
            except httpx.RequestError:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="System Fault: Bed service unreachable. Patient deletion aborted to protect data integrity."
                )

    # 3. Atomic Database Purge
    await db.delete(patient)
    await db.commit()

    return {
        "status": "SUCCESS", 
        "message": f"Patient {patient_id} checked out successfully. Bed {assigned_bed_code} has been automatically released."
    }