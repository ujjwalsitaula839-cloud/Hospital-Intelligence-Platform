from contextlib import asynccontextmanager
from datetime import date, datetime
import logging
import os
import re
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.responses import JSONResponse
import httpx
from pydantic import BaseModel, Field, computed_field, field_validator, model_validator
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from audit import log_audit
from database import get_db, init_db
import models
from security import UserRole, require_roles, require_roles_or_internal

logger = logging.getLogger("hip.patient")

BED_SERVICE_URL = os.getenv("BED_SERVICE_URL", "http://hip-bed-service:8003").rstrip("/")
INTERNAL_SERVICE_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="Hospital Intelligence Platform - Patient & Admission Service",
    version="2.2.0",
    lifespan=lifespan
)


class PatientCreate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=1, max_length=50)
    middle_name: Optional[str] = Field(None, max_length=50)
    last_name: Optional[str] = Field(None, min_length=1, max_length=50)
    date_of_birth: Optional[date] = None
    gender: str = Field(..., description="MALE, FEMALE, or OTHER")
    phone: Optional[str] = Field(None, max_length=30)
    address: Optional[str] = None

    # Backward compatibility fields for legacy clients sending 'name' & 'age'
    name: Optional[str] = None
    age: Optional[int] = None

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v: str) -> str:
        normalized = v.upper().strip()
        if normalized not in {"MALE", "FEMALE", "OTHER"}:
            raise ValueError("Gender must be MALE, FEMALE, or OTHER")
        return normalized


class PatientResponse(BaseModel):
    patient_id: int
    first_name: str
    middle_name: Optional[str] = None
    last_name: str
    date_of_birth: date
    gender: str
    phone: Optional[str] = None
    address: Optional[str] = None
    is_active: bool = True
    create_datetime: Optional[datetime] = None
    update_datetime: Optional[datetime] = None

    @computed_field
    @property
    def name(self) -> str:
        if self.middle_name:
            return f"{self.first_name} {self.middle_name} {self.last_name}"
        return f"{self.first_name} {self.last_name}"

    @computed_field
    @property
    def age(self) -> int:
        today = date.today()
        dob = self.date_of_birth
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    @computed_field
    @property
    def created_at(self) -> Optional[datetime]:
        return self.create_datetime

    @computed_field
    @property
    def updated_at(self) -> Optional[datetime]:
        return self.update_datetime

    class Config:
        from_attributes = True


def sanitize_text(value: Optional[str], max_len: int = 500) -> Optional[str]:
    """Strip HTML tags and control characters from user input."""
    if value is None:
        return None
    cleaned = re.sub(r'<[^>]+>', '', value)  # Strip HTML tags
    cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', cleaned)  # Strip control chars
    return cleaned[:max_len].strip()


class AdmissionCreate(BaseModel):
    patient_id: int
    primary_diagnosis: Optional[str] = Field(None, max_length=500, description="Admitting clinical primary diagnosis")
    diagnosis: Optional[str] = Field(None, max_length=500, description="Alias for primary diagnosis")
    acuity_level: Optional[str] = Field("ESI_3", description="ESI_1 through ESI_5")
    notes: Optional[str] = Field(None, max_length=1000)

    def get_primary_diagnosis(self) -> str:
        return self.primary_diagnosis or self.diagnosis or "Observation"


EncounterCreate = AdmissionCreate


class AdmissionResponse(BaseModel):
    admission_id: int
    patient_id: int
    arrival_datetime: datetime
    discharge_datetime: Optional[datetime] = None
    primary_diagnosis: Optional[str] = None
    acuity_level: str
    notes: Optional[str] = None
    create_datetime: Optional[datetime] = None
    update_datetime: Optional[datetime] = None

    @computed_field
    @property
    def encounter_id(self) -> int:
        return self.admission_id

    @computed_field
    @property
    def arrival_time(self) -> datetime:
        return self.arrival_datetime

    @computed_field
    @property
    def discharge(self) -> Optional[datetime]:
        return self.discharge_datetime

    @computed_field
    @property
    def discharge_time(self) -> Optional[datetime]:
        return self.discharge_datetime

    @computed_field
    @property
    def diagnosis(self) -> Optional[str]:
        return self.primary_diagnosis

    @computed_field
    @property
    def status(self) -> str:
        return "COMPLETED" if self.discharge_datetime is not None else "ACTIVE"

    @computed_field
    @property
    def created_at(self) -> Optional[datetime]:
        return self.create_datetime

    @computed_field
    @property
    def updated_at(self) -> Optional[datetime]:
        return self.update_datetime

    class Config:
        from_attributes = True


EncounterResponse = AdmissionResponse


class NurseAssignmentCreate(BaseModel):
    nurse_id: int


class NurseAssignmentResponse(BaseModel):
    assignment_id: int
    admission_id: int
    nurse_id: int
    start_datetime: datetime
    end_datetime: Optional[datetime] = None
    status: str

    @computed_field
    @property
    def encounter_id(self) -> int:
        return self.admission_id

    @computed_field
    @property
    def start_time(self) -> datetime:
        return self.start_datetime

    @computed_field
    @property
    def end_time(self) -> Optional[datetime]:
        return self.end_datetime

    class Config:
        from_attributes = True


@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(select(models.Patient).limit(1))
        return {"status": "healthy", "database": "connected", "service": "patient-service"}
    except Exception as e:
        logger.error("Health check failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Service health check failed."
        )


@app.get("/records", response_model=List[PatientResponse])
async def get_patient_records(
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(models.Patient).order_by(models.Patient.patient_id.desc()))
    return result.scalars().all()


@app.get("/search", response_model=List[PatientResponse])
@app.get("/patients/search", response_model=List[PatientResponse])
async def search_patients(
    first_name: Optional[str] = Query(None),
    last_name: Optional[str] = Query(None),
    date_of_birth: Optional[date] = Query(None),
    phone: Optional[str] = Query(None),
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    filters = []
    if first_name:
        filters.append(func.lower(models.Patient.first_name) == first_name.strip().lower())
    if last_name:
        filters.append(func.lower(models.Patient.last_name) == last_name.strip().lower())
    if date_of_birth:
        filters.append(models.Patient.date_of_birth == date_of_birth)
    if phone:
        filters.append(models.Patient.phone == phone.strip())

    stmt = select(models.Patient)
    if not filters:
        stmt = stmt.order_by(models.Patient.patient_id.desc()).limit(20)
    else:
        stmt = stmt.where(and_(*filters)).order_by(models.Patient.patient_id.asc())

    result = await db.execute(stmt)
    return result.scalars().all()


@app.post("/register", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
async def register_patient(
    patient_in: PatientCreate,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """Registers patient identity. Returns existing record if exact name + DOB matches."""
    first_name = patient_in.first_name
    middle_name = patient_in.middle_name
    last_name = patient_in.last_name
    dob = patient_in.date_of_birth

    if not first_name and patient_in.name:
        parts = patient_in.name.strip().split()
        first_name = parts[0]
        if len(parts) > 2:
            middle_name = " ".join(parts[1:-1])
            last_name = parts[-1]
        elif len(parts) == 2:
            last_name = parts[1]
        else:
            last_name = "Unknown"

    first_name = (first_name or "Patient").strip().title()
    last_name = (last_name or "Unknown").strip().title()
    middle_name = middle_name.strip().title() if middle_name else None

    if not dob:
        age_years = patient_in.age if patient_in.age is not None else 30
        dob = date(date.today().year - age_years, 1, 1)

    match_stmt = select(models.Patient).where(
        and_(
            func.lower(models.Patient.first_name) == first_name.lower(),
            func.lower(models.Patient.last_name) == last_name.lower(),
            models.Patient.date_of_birth == dob
        )
    )
    existing_match = (await db.execute(match_stmt)).scalars().first()
    if existing_match:
        return existing_match

    new_patient = models.Patient(
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        date_of_birth=dob,
        gender=patient_in.gender.upper(),
        phone=sanitize_text(patient_in.phone, 30) if patient_in.phone else None,
        address=sanitize_text(patient_in.address, 500) if patient_in.address else None
    )

    db.add(new_patient)
    await db.commit()
    await db.refresh(new_patient)
    return new_patient


@app.get("/verify/{patient_id}")
async def verify_patient(
    patient_id: int,
    current_user: dict = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(models.Patient).where(models.Patient.patient_id == patient_id))
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="Patient record not found.")

    today = date.today()
    calculated_age = today.year - record.date_of_birth.year - ((today.month, today.day) < (record.date_of_birth.month, record.date_of_birth.day))

    return {
        "status": "VALID",
        "patient_id": record.patient_id,
        "first_name": record.first_name,
        "last_name": record.last_name,
        "name": f"{record.first_name} {record.last_name}",
        "date_of_birth": record.date_of_birth.isoformat(),
        "age": calculated_age,
        "gender": record.gender,
        "phone": record.phone
    }


@app.get("/patient/{patient_id}", response_model=PatientResponse)
async def get_patient_by_id(
    patient_id: int,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(models.Patient).where(models.Patient.patient_id == patient_id))
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="Patient record not found.")
    return record


@app.post("/admissions/create", response_model=AdmissionResponse, status_code=status.HTTP_201_CREATED)
@app.post("/encounters/create", response_model=AdmissionResponse, status_code=status.HTTP_201_CREATED)
async def create_admission(
    admission_in: AdmissionCreate,
    current_user: dict = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """Creates a hospital admission. Returns current active admission if already admitted."""
    patient = await db.get(models.Patient, admission_in.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail=f"Patient ID {admission_in.patient_id} does not exist.")
    if not patient.is_active:
        raise HTTPException(status_code=400, detail="Cannot admit a deactivated patient record.")

    active_stmt = select(models.Admission).where(
        and_(
            models.Admission.patient_id == admission_in.patient_id,
            models.Admission.discharge_datetime.is_(None)
        )
    )
    active_adm = (await db.execute(active_stmt)).scalars().first()
    if active_adm:
        return active_adm

    new_admission = models.Admission(
        patient_id=admission_in.patient_id,
        primary_diagnosis=sanitize_text(admission_in.get_primary_diagnosis(), 500),
        acuity_level=admission_in.acuity_level or "ESI_3",
        notes=sanitize_text(admission_in.notes, 1000)
    )
    db.add(new_admission)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Concurrency race caught by partial unique index uq_single_active_admission_per_patient
        active_adm = (await db.execute(active_stmt)).scalars().first()
        if active_adm:
            return active_adm
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict: Patient already has an active admission."
        )
    await db.refresh(new_admission)
    return new_admission


@app.get("/admissions/active/{patient_id}", response_model=Optional[AdmissionResponse])
@app.get("/encounters/active/{patient_id}", response_model=Optional[AdmissionResponse])
async def get_active_admission(
    patient_id: int,
    current_user: dict = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(models.Admission).where(
        and_(
            models.Admission.patient_id == patient_id,
            models.Admission.discharge_datetime.is_(None)
        )
    )
    res = await db.execute(stmt)
    return res.scalars().first()


@app.get("/admissions/verify/{admission_id}")
@app.get("/encounters/verify/{admission_id}")
async def verify_admission(
    admission_id: int,
    current_user: dict = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    admission = await db.get(models.Admission, admission_id)
    if not admission:
        raise HTTPException(status_code=404, detail=f"Admission #{admission_id} not found.")

    patient = await db.get(models.Patient, admission.patient_id)
    patient_name = f"{patient.first_name} {patient.last_name}" if patient else "Unknown"
    is_active = admission.discharge_datetime is None

    return {
        "status": "VALID",
        "admission_id": admission.admission_id,
        "encounter_id": admission.admission_id,
        "patient_id": admission.patient_id,
        "patient_name": patient_name,
        "is_active": is_active,
        "admission_status": "ACTIVE" if is_active else "COMPLETED",
        "encounter_status": "ACTIVE" if is_active else "COMPLETED",
        "acuity_level": admission.acuity_level,
        "primary_diagnosis": admission.primary_diagnosis,
        "diagnosis": admission.primary_diagnosis,
        "arrival_datetime": admission.arrival_datetime.isoformat() if admission.arrival_datetime else None,
        "arrival_time": admission.arrival_datetime.isoformat() if admission.arrival_datetime else None,
        "discharge_datetime": admission.discharge_datetime.isoformat() if admission.discharge_datetime else None,
        "discharge": admission.discharge_datetime.isoformat() if admission.discharge_datetime else None
    }


@app.get("/admissions/{admission_id}", response_model=AdmissionResponse)
@app.get("/encounters/{admission_id}", response_model=AdmissionResponse)
async def get_admission_by_id(
    admission_id: int,
    current_user: dict = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    admission = await db.get(models.Admission, admission_id)
    if not admission:
        raise HTTPException(status_code=404, detail=f"Admission #{admission_id} not found.")
    return admission


@app.get("/admissions/patient/{patient_id}", response_model=List[AdmissionResponse])
@app.get("/encounters/patient/{patient_id}", response_model=List[AdmissionResponse])
async def get_admissions_by_patient(
    patient_id: int,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(models.Admission).where(
        models.Admission.patient_id == patient_id
    ).order_by(models.Admission.arrival_datetime.desc())
    res = await db.execute(stmt)
    return res.scalars().all()


@app.put("/admissions/discharge/{admission_id}")
@app.put("/encounters/discharge/{admission_id}")
async def discharge_admission(
    admission_id: int,
    current_user: dict = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    admission = await db.get(models.Admission, admission_id)
    if not admission:
        raise HTTPException(status_code=404, detail=f"Admission #{admission_id} not found.")

    if admission.discharge_datetime is not None:
        return {"status": "SUCCESS", "message": f"Admission #{admission_id} is already discharged."}

    admission.discharge_datetime = func.now()

    nurse_stmt = select(models.PatientNurseAssignment).where(
        and_(
            models.PatientNurseAssignment.admission_id == admission_id,
            models.PatientNurseAssignment.status == "ACTIVE"
        )
    )
    active_assignments = (await db.execute(nurse_stmt)).scalars().all()
    for na in active_assignments:
        na.status = "COMPLETED"
        na.end_datetime = func.now()

    # Step 1: Commit clinical discharge in PostgreSQL FIRST to release locks before network I/O
    await db.commit()

    # Step 2: Unidirectional downstream call to release physical assets (bed, equipment) in bed-service
    internal_headers = {
        "X-User-Id": str(current_user.get("user_id", 0)),
        "X-User-Role": str(current_user.get("role", "NURSE")),
        "X-Internal-Token": INTERNAL_SERVICE_SECRET,
    }
    bed_release_status = "NOT_NOTIFIED"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{BED_SERVICE_URL}/internal/admissions/{admission_id}/release",
                headers=internal_headers
            )
            if resp.status_code == 200:
                bed_release_status = "RELEASED"
            else:
                logger.warning("Bed service release returned status %s for admission #%s", resp.status_code, admission_id)
    except Exception as e:
        logger.warning("Could not reach bed-service to release assets for admission #%s: %s", admission_id, e)

    return {
        "status": "SUCCESS",
        "message": f"Admission #{admission_id} successfully discharged.",
        "physical_assets_release": bed_release_status
    }


@app.post("/admissions/{admission_id}/assign-nurse", response_model=NurseAssignmentResponse, status_code=status.HTTP_201_CREATED)
@app.post("/encounters/{admission_id}/assign-nurse", response_model=NurseAssignmentResponse, status_code=status.HTTP_201_CREATED)
async def assign_nurse_to_admission(
    admission_id: int,
    assignment_in: NurseAssignmentCreate,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """Assigns nurse to active admission and closes previous active shift assignment."""
    admission = await db.get(models.Admission, admission_id)
    if not admission or admission.discharge_datetime is not None:
        raise HTTPException(status_code=400, detail="Cannot assign nurse to discharged or non-existent admission.")

    active_stmt = select(models.PatientNurseAssignment).where(
        and_(
            models.PatientNurseAssignment.admission_id == admission_id,
            models.PatientNurseAssignment.status == "ACTIVE"
        )
    )
    prev_assignments = (await db.execute(active_stmt)).scalars().all()
    for prev in prev_assignments:
        prev.status = "COMPLETED"
        prev.end_datetime = func.now()

    new_assignment = models.PatientNurseAssignment(
        admission_id=admission_id,
        nurse_id=assignment_in.nurse_id,
        status="ACTIVE"
    )
    db.add(new_assignment)
    await db.commit()
    await db.refresh(new_assignment)
    return new_assignment


@app.put("/admissions/nurse-assignments/{assignment_id}/complete")
@app.put("/encounters/nurse-assignments/{assignment_id}/complete")
async def complete_nurse_assignment(
    assignment_id: int,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    assignment = await db.get(models.PatientNurseAssignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Nurse assignment not found.")

    assignment.status = "COMPLETED"
    assignment.end_datetime = func.now()
    await db.commit()
    return {"status": "SUCCESS", "message": f"Nurse assignment #{assignment_id} completed."}


@app.get("/admissions/{admission_id}/nurse-assignments", response_model=List[NurseAssignmentResponse])
@app.get("/encounters/{admission_id}/nurse-assignments", response_model=List[NurseAssignmentResponse])
async def get_admission_nurse_assignments(
    admission_id: int,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(models.PatientNurseAssignment).where(
        models.PatientNurseAssignment.admission_id == admission_id
    ).order_by(models.PatientNurseAssignment.start_datetime.desc())
    res = await db.execute(stmt)
    return res.scalars().all()


# ===========================================================================
# CLINICAL OBSERVATIONS & VITALS (APPEND-ONLY MEDICO-LEGAL LEDGER)
# ===========================================================================

class ObservationCreate(BaseModel):
    heart_rate_bpm: Optional[int] = Field(None, ge=1, le=299, description="Heart rate in beats per minute")
    systolic_bp: Optional[int] = Field(None, ge=1, le=349, description="Systolic blood pressure mmHg")
    diastolic_bp: Optional[int] = Field(None, ge=1, le=249, description="Diastolic blood pressure mmHg")
    oxygen_saturation_pct: Optional[float] = Field(None, ge=0.0, le=100.0, description="SpO2 percentage (0-100)")
    temperature_celsius: Optional[float] = Field(None, ge=25.0, le=45.0, description="Core body temperature in Celsius")
    respiratory_rate: Optional[int] = Field(None, ge=0, le=100, description="Breaths per minute")
    notes: Optional[str] = Field(None, max_length=1000)
    is_correction: bool = Field(False, description="True if this chart entry corrects a previous entry")
    corrects_observation_id: Optional[int] = Field(None, description="ID of the prior observation being corrected")
    correction_reason: Optional[str] = Field(None, max_length=500, description="Required clinical reason if is_correction is True")

    @model_validator(mode="after")
    def validate_correction(self):
        if self.is_correction and not self.corrects_observation_id:
            raise ValueError("corrects_observation_id is required when is_correction is True.")
        if self.is_correction and not self.correction_reason:
            raise ValueError("correction_reason is required when is_correction is True to maintain malpractice audit trail.")
        return self


class ObservationResponse(BaseModel):
    observation_id: int
    admission_id: int
    recorded_by_user_id: int
    observation_datetime: datetime
    heart_rate_bpm: Optional[int] = None
    systolic_bp: Optional[int] = None
    diastolic_bp: Optional[int] = None
    oxygen_saturation_pct: Optional[float] = None
    temperature_celsius: Optional[float] = None
    respiratory_rate: Optional[int] = None
    notes: Optional[str] = None
    is_correction: bool = False
    corrects_observation_id: Optional[int] = None
    correction_reason: Optional[str] = None
    create_datetime: Optional[datetime] = None

    class Config:
        from_attributes = True


@app.post("/admissions/{admission_id}/observations", response_model=ObservationResponse, status_code=201)
@app.post("/encounters/{admission_id}/observations", response_model=ObservationResponse, status_code=201)
async def record_observation(
    admission_id: int,
    obs_in: ObservationCreate,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """
    Records an immutable clinical observation/vital sign or an explicit correction.
    Under HIPAA / 21 CFR Part 11, observations cannot be updated or deleted.
    """
    admission = await db.get(models.Admission, admission_id)
    if not admission:
        raise HTTPException(status_code=404, detail="Admission record not found.")

    if obs_in.is_correction:
        prior = await db.get(models.PatientObservation, obs_in.corrects_observation_id)
        if not prior or prior.admission_id != admission_id:
            raise HTTPException(
                status_code=400,
                detail=f"Prior observation #{obs_in.corrects_observation_id} does not exist for this admission."
            )

    user_id = current_user.get("user_id") or 0

    obs = models.PatientObservation(
        admission_id=admission_id,
        recorded_by_user_id=user_id,
        heart_rate_bpm=obs_in.heart_rate_bpm,
        systolic_bp=obs_in.systolic_bp,
        diastolic_bp=obs_in.diastolic_bp,
        oxygen_saturation_pct=obs_in.oxygen_saturation_pct,
        temperature_celsius=obs_in.temperature_celsius,
        respiratory_rate=obs_in.respiratory_rate,
        notes=sanitize_text(obs_in.notes, 1000),
        is_correction=obs_in.is_correction,
        corrects_observation_id=obs_in.corrects_observation_id,
        correction_reason=sanitize_text(obs_in.correction_reason, 500)
    )
    db.add(obs)
    await db.commit()
    await db.refresh(obs)

    # HIPAA audit trail
    await log_audit(
        db=db,
        action="CHART_VITALS" if not obs_in.is_correction else "CORRECT_VITALS",
        user_id=user_id,
        resource_type="patient_observation",
        resource_id=obs.observation_id,
        details={"admission_id": admission_id, "is_correction": obs_in.is_correction}
    )

    return obs


@app.get("/admissions/{admission_id}/observations", response_model=List[ObservationResponse])
@app.get("/encounters/{admission_id}/observations", response_model=List[ObservationResponse])
async def get_admission_observations(
    admission_id: int,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves full chronological ledger of observations and corrections for an admission."""
    stmt = select(models.PatientObservation).where(
        models.PatientObservation.admission_id == admission_id
    ).order_by(models.PatientObservation.observation_datetime.asc())
    res = await db.execute(stmt)
    return res.scalars().all()


# ===========================================================================
# PATIENT LIFECYCLE: SOFT DEACTIVATION & HARD DELETE REJECTION (HIPAA COMPLIANCE)
# ===========================================================================

@app.put("/patient/{patient_id}/deactivate")
@app.put("/patients/{patient_id}/deactivate")
async def deactivate_patient(
    patient_id: int,
    current_user: dict = Depends(require_roles(UserRole.ADMIN, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """Soft-deactivates a patient record to prevent future admissions while maintaining legal audit trail."""
    patient = await db.get(models.Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient record not found.")

    patient.is_active = False
    await db.commit()

    user_id = current_user.get("user_id") or 0
    await log_audit(
        db=db,
        action="DEACTIVATE_PATIENT",
        user_id=user_id,
        resource_type="patient",
        resource_id=patient_id,
        details={"patient_name": f"{patient.first_name} {patient.last_name}"}
    )

    return {
        "status": "SUCCESS",
        "message": f"Patient #{patient_id} ({patient.first_name} {patient.last_name}) deactivated."
    }


@app.delete("/patient/{patient_id}")
@app.delete("/patients/{patient_id}")
async def reject_delete_patient(patient_id: int):
    """Explicitly reject hard deletion of patient records under HIPAA retention rules."""
    return JSONResponse(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        headers={"Allow": "GET, POST, PUT"},
        content={
            "detail": "Hard deletion of healthcare records is strictly prohibited under HIPAA compliance. Use PUT /patient/{id}/deactivate."
        }
    )
