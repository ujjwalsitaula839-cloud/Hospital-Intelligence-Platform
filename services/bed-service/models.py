from sqlalchemy import Column, String, Integer, DateTime
from sqlalchemy.sql import func
from database import Base

class BedRegistry(Base):
    __tablename__ = "bed_registry"

    id = Column(Integer, primary_key=True, index=True)
    bed_code = Column(String, unique=True, index=True, nullable=False)
    department = Column(String, nullable=False)
    status = Column(String, default="AVAILABLE")
    assigned_patient_id = Column(String, nullable=True)
    version = Column(Integer, default=1)
    
    # AUDIT FIELDS
    reserved_by = Column(String, nullable=True)
    reserved_at = Column(DateTime, nullable=True)
    released_by = Column(String, nullable=True)
    released_at = Column(DateTime, nullable=True)