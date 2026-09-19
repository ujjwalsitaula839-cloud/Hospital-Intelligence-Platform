from sqlalchemy import Boolean, CheckConstraint, Column, String, Integer, DateTime, Date, Numeric, SmallInteger, Text, ForeignKey, Index, text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base

class Patient(Base):
    __tablename__ = "patient"

    patient_id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String(50), nullable=False, index=True)
    middle_name = Column(String(50), nullable=True)
    last_name = Column(String(50), nullable=False, index=True)
    date_of_birth = Column(Date, nullable=False, index=True)
    gender = Column(String(20), nullable=False)  # MALE, FEMALE, OTHER
    phone = Column(String(30), nullable=True, index=True)
    address = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    create_datetime = Column(DateTime(timezone=True), server_default=func.now())
    update_datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    admissions = relationship("Admission", back_populates="patient", cascade="none")


class Admission(Base):
    __tablename__ = "admission"

    admission_id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patient.patient_id", ondelete="RESTRICT"), nullable=False, index=True)
    arrival_datetime = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    discharge_datetime = Column(DateTime(timezone=True), nullable=True)
    primary_diagnosis = Column(Text, nullable=True)
    acuity_level = Column(String(10), default="ESI_3", nullable=False)  # ESI_1 to ESI_5
    notes = Column(Text, nullable=True)
    create_datetime = Column(DateTime(timezone=True), server_default=func.now())
    update_datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    patient = relationship("Patient", back_populates="admissions")
    nurse_assignments = relationship("PatientNurseAssignment", back_populates="admission", cascade="none")
    observations = relationship("PatientObservation", back_populates="admission", cascade="none")

    __table_args__ = (
        Index(
            "uq_single_active_admission_per_patient",
            "patient_id",
            unique=True,
            postgresql_where=text("discharge_datetime IS NULL"),
        ),
    )


class PatientNurseAssignment(Base):
    __tablename__ = "patient_nurse_assignment"

    assignment_id = Column(Integer, primary_key=True, index=True)
    admission_id = Column(Integer, ForeignKey("admission.admission_id", ondelete="RESTRICT"), nullable=False, index=True)
    nurse_id = Column(Integer, nullable=False, index=True)  # Logical FK to personnel.personnel_id
    start_datetime = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    end_datetime = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(30), default="ACTIVE", index=True, nullable=False)  # ACTIVE, COMPLETED, CANCELLED

    # Relationships
    admission = relationship("Admission", back_populates="nurse_assignments")


class PatientObservation(Base):
    """
    Append-only clinical vitals and observations ledger with correction lineage.
    Under 21 CFR Part 11 / HIPAA legal requirements, medical observations cannot
    be overwritten or deleted. Corrections create new rows referencing the prior observation.
    """
    __tablename__ = "patient_observation"

    observation_id = Column(Integer, primary_key=True, index=True)
    admission_id = Column(Integer, ForeignKey("admission.admission_id", ondelete="RESTRICT"), nullable=False, index=True)
    recorded_by_user_id = Column(Integer, nullable=False, index=True)  # Logical FK to personnel.personnel_id
    observation_datetime = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Structured physiological vitals
    heart_rate_bpm = Column(SmallInteger, nullable=True)
    systolic_bp = Column(SmallInteger, nullable=True)
    diastolic_bp = Column(SmallInteger, nullable=True)
    oxygen_saturation_pct = Column(Numeric(4, 1), nullable=True)
    temperature_celsius = Column(Numeric(4, 1), nullable=True)
    respiratory_rate = Column(SmallInteger, nullable=True)
    notes = Column(Text, nullable=True)

    # Legal/malpractice correction audit trail
    is_correction = Column(Boolean, default=False, nullable=False)
    corrects_observation_id = Column(Integer, ForeignKey("patient_observation.observation_id", ondelete="RESTRICT"), nullable=True, index=True)
    correction_reason = Column(Text, nullable=True)

    create_datetime = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("heart_rate_bpm IS NULL OR (heart_rate_bpm > 0 AND heart_rate_bpm < 300)", name="ck_obs_heart_rate"),
        CheckConstraint("systolic_bp IS NULL OR (systolic_bp > 0 AND systolic_bp < 350)", name="ck_obs_systolic_bp"),
        CheckConstraint("diastolic_bp IS NULL OR (diastolic_bp > 0 AND diastolic_bp < 250)", name="ck_obs_diastolic_bp"),
        CheckConstraint("oxygen_saturation_pct IS NULL OR (oxygen_saturation_pct >= 0.0 AND oxygen_saturation_pct <= 100.0)", name="ck_obs_oxygen_sat"),
        CheckConstraint("temperature_celsius IS NULL OR (temperature_celsius >= 25.0 AND temperature_celsius <= 45.0)", name="ck_obs_temperature"),
        CheckConstraint("respiratory_rate IS NULL OR (respiratory_rate >= 0 AND respiratory_rate <= 100)", name="ck_obs_resp_rate"),
    )

    # Relationships
    admission = relationship("Admission", back_populates="observations")
    corrected_by = relationship("PatientObservation", remote_side=[corrects_observation_id], cascade="none")


# Import audit models so they are registered with Base.metadata.create_all
from audit import AuditLog  # noqa: E402, F401