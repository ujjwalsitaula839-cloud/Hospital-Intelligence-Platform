import os
from datetime import datetime, date, timezone
from typing import Optional, List
from contextlib import asynccontextmanager
from fastapi import FastAPI, Header, HTTPException, status, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from pydantic import BaseModel, Field, field_validator, computed_field
import models
from database import get_db, init_db
from security import UserRole, require_roles, require_roles_or_internal

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure tables are created asynchronously
    await init_db()
    yield

app = FastAPI(
    title="Hospital Intelligence Platform - Patient & Admission Service",
    version="2.2.0",
    lifespan=lifespan
)

# --- 1. PYDANTIC SCHEMAS ---

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


class AdmissionCreate(BaseModel):
    patient_id: int
    primary_diagnosis: Optional[str] = Field(None, description="Admitting clinical primary diagnosis")
    diagnosis: Optional[str] = Field(None, description="Alias for primary diagnosis")
    acuity_level: Optional[str] = Field("ESI_3", description="ESI_1 through ESI_5")
    notes: Optional[str] = None

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


# --- 2. HEALTH CHECK ---

@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(select(models.Patient).limit(1))
        return {"status": "healthy", "database": "connected", "service": "patient-service"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database connection failed: {str(e)}"
        )


# --- 3. PATIENT IDENTITY & MULTI-FIELD SEARCH ---

@app.get("/records", response_model=List[PatientResponse])
async def get_patient_records(
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(models.Patient).order_by(models.Patient.patient_id.desc()))
    patients = result.scalars().all()
    return patients


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

    stmt = select(models.Patient)
    filters = []

    if first_name:
        filters.append(func.lower(models.Patient.first_name) == first_name.strip().lower())
    if last_name:
        filters.append(func.lower(models.Patient.last_name) == last_name.strip().lower())
    if date_of_birth:
        filters.append(models.Patient.date_of_birth == date_of_birth)
    if phone:
        filters.append(models.Patient.phone == phone.strip())

    if not filters:
        # Return recent records if no filter given
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
    """
    Registers a permanent patient identity.
    If full demographic match (first_name, last_name, DOB) already exists, returns existing patient_id.
    """

    # Handle legacy name & age conversion if first_name/last_name/DOB are omitted
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

    if not last_name:
        last_name = "Unknown"
    if not first_name:
        first_name = "Patient"

    if not dob:
        age_years = patient_in.age if patient_in.age is not None else 30
        today = date.today()
        dob = date(today.year - age_years, 1, 1)

    # Check for existing identical person match (first_name, last_name, date_of_birth)
    match_stmt = select(models.Patient).where(
        and_(
            func.lower(models.Patient.first_name) == first_name.strip().lower(),
            func.lower(models.Patient.last_name) == last_name.strip().lower(),
            models.Patient.date_of_birth == dob
        )
    )
    existing_match = (await db.execute(match_stmt)).scalars().first()
    if existing_match:
        # Exact person exists: return existing patient_id
        return existing_match

    new_patient = models.Patient(
        first_name=first_name.strip().title(),
        middle_name=middle_name.strip().title() if middle_name else None,
        last_name=last_name.strip().title(),
        date_of_birth=dob,
        gender=patient_in.gender.upper(),
        phone=patient_in.phone.strip() if patient_in.phone else None,
        address=patient_in.address.strip() if patient_in.address else None
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

    result = await db.execute(
        select(models.Patient).where(models.Patient.patient_id == patient_id)
    )
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

    result = await db.execute(
        select(models.Patient).where(models.Patient.patient_id == patient_id)
    )
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="Patient record not found.")

    return record


# --- 4. ADMISSION / ENCOUNTER MANAGEMENT ---

@app.post("/admissions/create", response_model=AdmissionResponse, status_code=status.HTTP_201_CREATED)
@app.post("/encounters/create", response_model=AdmissionResponse, status_code=status.HTTP_201_CREATED)
async def create_admission(
    admission_in: AdmissionCreate,
    current_user: dict = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new hospital stay (Admission) for a permanent patient.
    Checks that the patient exists and does not already have an active stay (discharge is NULL).
    """

    # 1. Verify Patient exists
    patient = await db.get(models.Patient, admission_in.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail=f"Patient ID {admission_in.patient_id} does not exist.")

    # 2. Check if patient already has an ACTIVE admission (discharge_datetime is NULL)
    active_stmt = select(models.Admission).where(
        and_(
            models.Admission.patient_id == admission_in.patient_id,
            models.Admission.discharge_datetime.is_(None)
        )
    )
    active_adm = (await db.execute(active_stmt)).scalars().first()
    if active_adm:
        return active_adm  # Return current active admission

    # 3. Create new Admission
    new_admission = models.Admission(
        patient_id=admission_in.patient_id,
        primary_diagnosis=admission_in.get_primary_diagnosis(),
        acuity_level=admission_in.acuity_level or "ESI_3",
        notes=admission_in.notes
    )
    db.add(new_admission)
    await db.commit()
    await db.refresh(new_admission)

    return new_admission


@app.get("/admissions/active/{patient_id}", response_model=Optional[AdmissionResponse])
@app.get("/encounters/active/{patient_id}", response_model=Optional[AdmissionResponse])
async def get_active_admission(
    patient_id: int,
    current_user: dict = Depends(require_roles_or_internal(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves the active admission (discharge_datetime is NULL) for a patient if one exists."""
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
    """Inter-service validation endpoint for Bed Service to verify an admission is valid and active."""
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
    """Preserves full historical timeline of all admissions for a patient."""
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
    """
    Completes the admission:
    Sets discharge_datetime = now().
    Patient record remains active and permanent.
    """
    admission = await db.get(models.Admission, admission_id)
    if not admission:
        raise HTTPException(status_code=404, detail=f"Admission #{admission_id} not found.")

    admission.discharge_datetime = func.now()

    # Complete any active nurse assignments
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

    await db.commit()
    return {"status": "SUCCESS", "message": f"Admission #{admission_id} successfully discharged."}


# --- 5. PATIENT NURSE ASSIGNMENTS ---

@app.post("/admissions/{admission_id}/assign-nurse", response_model=NurseAssignmentResponse, status_code=status.HTTP_201_CREATED)
@app.post("/encounters/{admission_id}/assign-nurse", response_model=NurseAssignmentResponse, status_code=status.HTTP_201_CREATED)
async def assign_nurse_to_admission(
    admission_id: int,
    assignment_in: NurseAssignmentCreate,
    current_user: dict = Depends(require_roles(UserRole.NURSE, UserRole.DOCTOR)),
    db: AsyncSession = Depends(get_db)
):
    """
    Assigns a nurse to the patient's active admission.
    Completes any previous active nurse assignment (shift handover).
    """

    admission = await db.get(models.Admission, admission_id)
    if not admission or admission.discharge_datetime is not None:
        raise HTTPException(status_code=400, detail="Cannot assign nurse to discharged or non-existent admission.")

    # Complete previous active assignment if exists
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
    """Closes a nursing assignment at the end of a shift without deleting history."""
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
    """Retrieves all historical and active nurse assignments for an admission."""
    stmt = select(models.PatientNurseAssignment).where(
        models.PatientNurseAssignment.admission_id == admission_id
    ).order_by(models.PatientNurseAssignment.start_datetime.desc())
    res = await db.execute(stmt)
    return res.scalars().all()