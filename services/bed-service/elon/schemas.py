"""
Pydantic schemas for ELON (Clinical & Facility Operations AI Agent)
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class UserContext(BaseModel):
    user_id: int
    username: Optional[str] = None
    role: str
    department: Optional[str] = None
    full_name: Optional[str] = None


class ElonChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000, description="User's operational query")
    session_id: Optional[str] = Field(None, description="Client session identifier")


class ElonChatResponse(BaseModel):
    response: str = Field(..., description="Clean conversational answer from ELON")
    session_id: str = Field(..., description="Session identifier")
    timestamp: str = Field(..., description="ISO 8601 response timestamp")
