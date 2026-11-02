import os
from typing import Optional


class Settings:
    # SMTP / Mailpit Configuration
    SMTP_HOST: str = os.getenv("SMTP_HOST", "mailpit")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "1025"))
    SMTP_USER: Optional[str] = os.getenv("SMTP_USER") or None
    SMTP_PASSWORD: Optional[str] = os.getenv("SMTP_PASSWORD") or None
    EMAILS_FROM_EMAIL: str = os.getenv("EMAILS_FROM_EMAIL", "noreply@hospital.org")

    # Frontend URL for password reset links
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

    # Security & Tokens
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

    # Database & Redis
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://hip-redis:6379")

    # Password policy
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 15
    PASSWORD_HISTORY_DEPTH: int = 5


settings = Settings()
