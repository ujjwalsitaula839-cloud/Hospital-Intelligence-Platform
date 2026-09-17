from sqlalchemy import Column, String, Integer, DateTime, Date, Text, ForeignKey
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