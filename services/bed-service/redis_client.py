# services/bed-service/redis_client.py
from contextlib import asynccontextmanager
import os
from fastapi import FastAPI
import redis.asyncio as aioredis
from database import init_db

REDIS_URL = os.getenv("REDIS_URL", "redis://hip-redis:6379")

redis_client: aioredis.Redis | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    # Startup 1: Ensure database tables are created asynchronously
    await init_db()
    # Startup 2: Initialize shared Redis connection pool
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    yield
    # Shutdown: Close socket connection gracefully
    if redis_client:
        await redis_client.aclose()

async def get_redis() -> aioredis.Redis:
    """Dependency provider for FastAPI routes"""
    if redis_client is None:
        raise RuntimeError("Redis connection pool is not initialized")
    return redis_client