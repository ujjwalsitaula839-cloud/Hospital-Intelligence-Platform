import os
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base

DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+asyncpg://hip_admin:oOk5ixYB0ZkX-c2AcQOTRw@hip-postgres:5432/hospital_intelligence"
)

# 1. Initialize the SQLAlchemy Async Engine
engine = create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300
)

# 2. Factory session class for async sessions
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

# 3. Base declarative class
Base = declarative_base()

# 4. Dependency to safely open and close async database connections per request
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

# 5. Async table creation for application startup with resilient retry
async def init_db(max_retries: int = 10, delay: float = 2.0):
    for attempt in range(1, max_retries + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            print(" [DB INIT] Patient service database tables initialized successfully.")
            return
        except Exception as e:
            if attempt == max_retries:
                print(f"[DB INIT FAILED] Could not initialize database after {max_retries} attempts: {e}")
                raise e
            print(f"[DB CONNECTING] Database not ready yet (attempt {attempt}/{max_retries}). Retrying in {delay}s...")
            await asyncio.sleep(delay)