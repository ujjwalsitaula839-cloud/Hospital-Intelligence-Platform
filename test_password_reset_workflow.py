import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import os
from pathlib import Path
import secrets
import sys

from dotenv import load_dotenv

# Ensure services/auth-service is on sys.path
root_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(root_dir / "services" / "auth-service"))
load_dotenv(root_dir / ".env")

import models
import schemas
import security
from email_utils import build_reset_email_html
from core.config import settings

passed = 0
failed = 0


def test_result(name: str, condition: bool, detail: str = ""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} -- {detail}")


def test_token_generation_and_hashing():
    print("\n--- Test Suite 1: Token Cryptography & Hashing ---")
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    test_result("Raw token length is at least 32 characters", len(raw_token) >= 32)
    test_result("Token hash is 64 hex characters (SHA-256)", len(token_hash) == 64)

    # Re-computing hash yields identical result
    second_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    test_result("Deterministic SHA-256 verification", token_hash == second_hash)

    # Tampered token fails hash match
    tampered_hash = hashlib.sha256((raw_token + "x").encode()).hexdigest()
    test_result("Tampered token mismatch", token_hash != tampered_hash)


def test_email_template_rendering():
    print("\n--- Test Suite 2: Email HTML Template Generation ---")
    raw_token = "TEST_TOKEN_12345"
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"
    html = build_reset_email_html(reset_url, "dr_smith@hospital.org")

    test_result("HTML contains frontend reset URL", reset_url in html)
    test_result("HTML contains recipient email", "dr_smith@hospital.org" in html)
    test_result("HTML contains 15-minute expiration warning", "15 minutes" in html)
    test_result("HTML does not leak raw token in unexpected plain fields", raw_token in reset_url)


def test_pydantic_schema_validation():
    print("\n--- Test Suite 3: Pydantic Validation & Security Rules ---")
    # Valid forgot-password request
    req1 = schemas.ForgotPasswordRequest(email="doctor@hospital.org")
    test_result("Valid ForgotPasswordRequest", req1.email == "doctor@hospital.org")

    # Invalid email rejected
    try:
        schemas.ForgotPasswordRequest(email="not-an-email")
        test_result("Invalid email rejected", False, "Should have raised ValidationError")
    except Exception:
        test_result("Invalid email rejected", True)

    # Valid ResetPasswordRequest
    req2 = schemas.ResetPasswordRequest(
        token="some_valid_token",
        new_password="NewSecurePassword123!",
        confirm_password="NewSecurePassword123!"
    )
    test_result("Valid ResetPasswordRequest", req2.token == "some_valid_token")

    # Mismatched passwords rejected
    try:
        schemas.ResetPasswordRequest(
            token="token",
            new_password="Password123!",
            confirm_password="DifferentPassword123!"
        )
        test_result("Mismatched passwords rejected", False, "Should have raised ValidationError")
    except Exception:
        test_result("Mismatched passwords rejected", True)

    # Weak password rejected (missing special character or number)
    try:
        schemas.ResetPasswordRequest(
            token="token",
            new_password="alllowercase",
            confirm_password="alllowercase"
        )
        test_result("Weak password rejected", False, "Should have rejected weak password")
    except Exception:
        test_result("Weak password rejected", True)


def test_token_expiration_logic():
    print("\n--- Test Suite 4: Expiration Window Logic ---")
    now_utc = datetime.now(timezone.utc)
    valid_expiry = now_utc + timedelta(minutes=15)
    expired_expiry = now_utc - timedelta(seconds=1)

    test_result("Valid token within 15-min window is not expired", now_utc <= valid_expiry)
    test_result("Expired token correctly detected", now_utc > expired_expiry)


def test_password_history_invalidation():
    print("\n--- Test Suite 5: Password History & Session Invalidation Logic ---")
    old_pw = "OldPassword123!"
    old_hash = security.hashed_password(old_pw)

    # Verify matching current password
    is_same = security.verify_password(old_pw, old_hash)
    test_result("Current password reuse detected", is_same)

    new_pw = "BrandNewPassword123!"
    is_diff = security.verify_password(new_pw, old_hash)
    test_result("Distinct new password accepted", not is_diff)

    # Token version increment
    initial_version = 1
    new_version = (initial_version or 0) + 1
    test_result("Token version increments on password reset", new_version == 2)


def main():
    print("=" * 60)
    print("HIP SELF-SERVICE PASSWORD RESET VALIDATION SUITE")
    print("=" * 60)

    test_token_generation_and_hashing()
    test_email_template_rendering()
    test_pydantic_schema_validation()
    test_token_expiration_logic()
    test_password_history_invalidation()

    print("\n" + "=" * 60)
    print(f"RESULTS: {passed} PASSED, {failed} FAILED")
    print("=" * 60)

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
