"""
FastAPI Router for ELON (Clinical & Facility Operations AI Agent)
"""
import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis

from database import get_db
from redis_client import get_redis
from security import require_roles, UserRole
from elon.schemas import ElonChatRequest, ElonChatResponse, UserContext
from elon import agent

logger = logging.getLogger("hip.bed.elon.router")

router = APIRouter(tags=["ELON AI Operations Agent"])


@router.post("/elon/chat", response_model=ElonChatResponse)
@router.post("/beds/elon/chat", response_model=ElonChatResponse)
async def chat_with_elon(
    payload: ElonChatRequest,
    current_user: Dict[str, Any] = Depends(
        require_roles(
            UserRole.CLEANING_CREW,
            UserRole.NURSE,
            UserRole.DOCTOR,
            UserRole.ADMIN,
            UserRole.PHARMACY,
        )
    ),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    Conversational endpoint for ELON: Hospital Operations AI Coordinator.
    Enforces two-tiered RBAC and HIPAA boundaries based on verified JWT role.
    """
    user_context = UserContext(
        user_id=current_user.get("user_id", 0),
        username=current_user.get("username") or f"user_{current_user.get('user_id', 0)}",
        role=current_user.get("role", "DOCTOR"),
        department=current_user.get("department"),
        full_name=current_user.get("full_name"),
    )

    try:
        response = await agent.ask_elon(
            message=payload.message,
            user_context=user_context,
            db=db,
            redis=redis,
            session_id=payload.session_id,
        )
        return response
    except Exception as e:
        logger.error("ELON agent execution error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ELON operations agent encountered an unexpected error processing your request."
        )
