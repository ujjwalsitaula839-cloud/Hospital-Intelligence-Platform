from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Boolean, Index, text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base

class Bed(Base):
    __tablename__ = "bed"

    bed_id = Column(Integer, primary_key=True, index=True)
    bed_code = Column(String(30), unique=True, index=True, nullable=False)
    department = Column(String(50), nullable=False, default="EMERGENCY")
    room_number = Column(String(20), nullable=False, default="101")
    bed_type = Column(String(30), default="STANDARD", nullable=False)  # STANDARD, ICU, BARIATRIC, ISOLATION
    status = Column(String(30), default="AVAILABLE", index=True, nullable=False)  # AVAILABLE, RESERVED, OCCUPIED, DIRTY, CLEANING_IN_PROGRESS, OUT_OF_SERVICE
    version = Column(Integer, default=1, nullable=False)
    create_datetime = Column(DateTime(timezone=True), server_default=func.now())
    update_datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    allocations = relationship("BedAllocation", back_populates="bed", cascade="none")
    cleaning_tasks = relationship("CleaningTask", back_populates="bed", cascade="none")


class BedAllocation(Base):
    __tablename__ = "bed_allocation"

    allocation_id = Column(Integer, primary_key=True, index=True)
    bed_id = Column(Integer, ForeignKey("bed.bed_id", ondelete="RESTRICT"), nullable=False, index=True)
    admission_id = Column(Integer, index=True, nullable=False)  # Logical FK to admission.admission_id
    assigned_by_personnel_id = Column(Integer, nullable=False)  # Logical FK to personnel.personnel_id
    status = Column(String(30), default="RESERVED", index=True, nullable=False)  # RESERVED, OCCUPIED, COMPLETED, TRANSFERRED, CANCELLED
    start_datetime = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    end_datetime = Column(DateTime(timezone=True), nullable=True)
    create_datetime = Column(DateTime(timezone=True), server_default=func.now())
    update_datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    bed = relationship("Bed", back_populates="allocations")
    cleaning_tasks = relationship("CleaningTask", back_populates="bed_allocation", cascade="none")

    __table_args__ = (
        Index(
            "uq_single_active_bed_allocation",
            "bed_id",
            unique=True,
            postgresql_where=text("status IN ('RESERVED', 'OCCUPIED') AND end_datetime IS NULL"),
        ),
        Index(
            "uq_single_active_admission_bed",
            "admission_id",
            unique=True,
            postgresql_where=text("status IN ('RESERVED', 'OCCUPIED') AND end_datetime IS NULL"),
        ),
    )


class EquipmentType(Base):
    __tablename__ = "equipment_type"

    equipment_type_id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    description = Column(Text, nullable=True)

    # Relationships
    equipment_items = relationship("Equipment", back_populates="equipment_type", cascade="none")


class Equipment(Base):
    __tablename__ = "equipment"

    equipment_id = Column(Integer, primary_key=True, index=True)
    equipment_type_id = Column(Integer, ForeignKey("equipment_type.equipment_type_id", ondelete="RESTRICT"), nullable=False, index=True)
    serial_number = Column(String(60), unique=True, index=True, nullable=False)
    equipment_name = Column(String(100), nullable=False)
    department = Column(String(50), nullable=False, default="EMERGENCY")
    status = Column(String(30), default="AVAILABLE", index=True, nullable=False)  # AVAILABLE, ALLOCATED, MAINTENANCE, DECOMMISSIONED
    version = Column(Integer, default=1, nullable=False)
    last_inspected_datetime = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    equipment_type = relationship("EquipmentType", back_populates="equipment_items")
    allocations = relationship("EquipmentAllocation", back_populates="equipment", cascade="none")


class EquipmentAllocation(Base):
    __tablename__ = "equipment_allocation"

    equipment_allocation_id = Column(Integer, primary_key=True, index=True)
    equipment_id = Column(Integer, ForeignKey("equipment.equipment_id", ondelete="RESTRICT"), nullable=False, index=True)
    admission_id = Column(Integer, index=True, nullable=False)  # Logical FK to admission.admission_id
    allocated_by_personnel_id = Column(Integer, nullable=False)  # Logical FK to personnel.personnel_id
    start_datetime = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    end_datetime = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(30), default="ACTIVE", index=True, nullable=False)  # ACTIVE, RELEASED

    # Relationships
    equipment = relationship("Equipment", back_populates="allocations")

    __table_args__ = (
        Index(
            "uq_single_active_equipment_allocation",
            "equipment_id",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND end_datetime IS NULL"),
        ),
    )


class CleaningTask(Base):
    __tablename__ = "cleaning_task"

    cleaning_id = Column(Integer, primary_key=True, index=True)
    bed_id = Column(Integer, ForeignKey("bed.bed_id", ondelete="RESTRICT"), nullable=False, index=True)
    allocation_id = Column(Integer, ForeignKey("bed_allocation.allocation_id", ondelete="SET NULL"), nullable=True, index=True)
    personnel_id = Column(Integer, nullable=True)  # Logical FK to personnel.personnel_id (NULL while PENDING, required when IN_PROGRESS/COMPLETED)
    status = Column(String(30), default="PENDING", index=True, nullable=False)  # PENDING, IN_PROGRESS, COMPLETED, VERIFIED
    requested_datetime = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_datetime = Column(DateTime(timezone=True), nullable=True)
    completed_datetime = Column(DateTime(timezone=True), nullable=True)
    disinfection_notes = Column(Text, nullable=True)

    # Relationships
    bed = relationship("Bed", back_populates="cleaning_tasks")

    bed_allocation = relationship("BedAllocation", back_populates="cleaning_tasks")