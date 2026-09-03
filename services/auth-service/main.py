import os
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import models
import schemas  
from database import get_db, init_db
import security
import jwt

SECRET_KEY = os.getenv("SECRET_KEY", "dev_fallback_secret_key_change_me_in_prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure database tables are created asynchronously
    await init_db()
    yield

app = FastAPI(
    title="Hospital Intelligence Platform - Auth Service",
    version="1.0.0",
    lifespan=lifespan
)

@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(select(models.User).limit(1))
        return {"status": "healthy", "database": "connected", "service": "auth-service"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database connection failed: {str(e)}"
        )

@app.post("/register", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(user_in: schemas.Usercreate, db: AsyncSession = Depends(get_db)):
    # 1. Check if username already exists
    result_user = await db.execute(select(models.User).where(models.User.username == user_in.username))
    if result_user.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )
        
    # 2. Check if email already registered
    result_email = await db.execute(select(models.User).where(models.User.email == user_in.email))
    if result_email.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    new_user = models.User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=security.hashed_password(user_in.password)
    )
    
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    return new_user

@app.post("/login", status_code=status.HTTP_200_OK)
async def login_user(user_in: schemas.Usercreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.User).where(models.User.email == user_in.email))
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    is_valid = security.verify_password(user_in.password, user.hashed_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
        
    token_data = {"sub": str(user.id), "username": user.username}
    access_token = create_access_token(data=token_data)
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user.username
    }