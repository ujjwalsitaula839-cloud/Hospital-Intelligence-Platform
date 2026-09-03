from sqlalchemy import Column, String, Integer
from database import Base

class PatientRecord(Base):
    __tablename__ = "patient_records"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    diagnosis = Column(String, nullable=False)
    room = Column(String, nullable=False)
    # Links the record to the specific User ID injected by the gateway
    assigned_user_id = Column(String, nullable=False, index=True)