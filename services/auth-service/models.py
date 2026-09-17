from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from database import Base

class Personnel(Base):
    __tablename__ = "personnel"
    
    personnel_id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False, default="Staff Member")
    role = Column(String(30), nullable=False, default="NURSE")  # DOCTOR, NURSE, CLEANING_CREW, PHARMACY, ADMIN
    department = Column(String(50), nullable=False, default="EMERGENCY")
    is_active = Column(Boolean, default=True)
    create_datetime = Column(DateTime(timezone=True), server_default=func.now())
    last_logout_datetime = Column(DateTime(timezone=True), nullable=True)