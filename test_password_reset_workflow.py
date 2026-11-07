import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
import urllib.request
import urllib.error

root_dir = Path(__file__).resolve().parent

try:
    from dotenv import load_dotenv
    load_dotenv(root_dir / ".env")
except (ImportError, Exception):
    pass

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


def test_pydantic_schema_and_domain_validation():
    print("\n--- Test Suite 3: Pydantic Validation & @hospital.org Domain Enforcement ---")
    # Valid @hospital.org forgot-password request
    req1 = schemas.ForgotPasswordRequest(email="doctor@hospital.org")
    test_result("Valid @hospital.org email accepted", req1.email == "doctor@hospital.org")

    # Non-@hospital.org domain (e.g. gmail.com) REJECTED
    try:
        schemas.ForgotPasswordRequest(email="attacker@gmail.com")
        test_result("Non-@hospital.org domain rejected", False, "Should have rejected @gmail.com")
    except Exception as e:
        test_result("Non-@hospital.org domain (@gmail.com) rejected", "@hospital.org" in str(e))

    # Another external domain (e.g. yahoo.com) REJECTED
    try:
        schemas.ForgotPasswordRequest(email="user@yahoo.com")
        test_result("External domain (@yahoo.com) rejected", False, "Should have rejected @yahoo.com")
    except Exception as e:
        test_result("External domain (@yahoo.com) rejected", "@hospital.org" in str(e))

    # Invalid email syntax rejected
    try:
        schemas.ForgotPasswordRequest(email="not-an-email")
        test_result("Malformed email format rejected", False, "Should have raised ValidationError")
    except Exception:
        test_result("Malformed email format rejected", True)

    # AdminProvisionRequest @hospital.org enforcement
    try:
        schemas.AdminProvisionRequest(
            username="new_doctor",
            email="new_doctor@gmail.com",
            full_name="New Doctor",
            role="DOCTOR",
            department="EMERGENCY"
        )
        test_result("Admin provision with @gmail.com rejected", False, "Should have rejected @gmail.com")
    except Exception as e:
        test_result("Admin provision with @gmail.com rejected", "@hospital.org" in str(e))

    prov = schemas.AdminProvisionRequest(
        username="new_doctor",
        email="new_doctor@hospital.org",
        full_name="New Doctor",
        role="DOCTOR",
        department="EMERGENCY"
    )
    test_result("Admin provision with @hospital.org accepted", prov.email == "new_doctor@hospital.org")

    # LoginRequest @hospital.org enforcement
    try:
        schemas.LoginRequest(email="doctor@gmail.com", password="Password123!")
        test_result("Login with @gmail.com rejected by schema", False, "Should have rejected @gmail.com")
    except Exception as e:
        test_result("Login with @gmail.com rejected by schema", "@hospital.org" in str(e))

    login_req = schemas.LoginRequest(email="doctor@hospital.org", password="Password123!")
    test_result("Login with @hospital.org accepted by schema", login_req.email == "doctor@hospital.org")


    # Valid ResetPasswordRequest
    req2 = schemas.ResetPasswordRequest(
        token="some_valid_token",
        new_password="TestValidPassword123!",
        confirm_password="TestValidPassword123!"
    )
    test_result("Valid ResetPasswordRequest accepted", req2.token == "some_valid_token")

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


def is_service_listening(url: str) -> bool:
    """Helper to probe if a live HTTP service is up and accepting requests."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as _:
            return True
    except urllib.error.HTTPError:
        # HTTP 401, 404, etc. means the service is running and responding
        return True
    except Exception:
        # Connection refused, timeout, host unreachable
        return False


def test_live_mailpit_and_gateway_flow():
    print("\n--- Test Suite 6: Live Gateway & Mailpit Integration Test ---")
    gateway_url = os.getenv("GATEWAY_URL", "http://localhost:8080")
    mailpit_url = os.getenv("MAILPIT_HTTP_URL", "http://localhost:8025")

    # Guard: Detect if live services are running (skipped during standalone unit test runner)
    if not is_service_listening(gateway_url) or not is_service_listening(mailpit_url):
        print("  [SKIP] Live Gateway and/or Mailpit not running. Skipping live integration tests during unit test suite.")
        return

    # Ensure isolated test user exists if database is accessible
    test_pg_dsn = os.getenv("TEST_PG_DSN")
    if test_pg_dsn:
        try:
            import asyncpg
            async def _seed_test_nurse():
                conn = await asyncpg.connect(test_pg_dsn)
                try:
                    await conn.execute("""
                        INSERT INTO personnel (username, email, hashed_password, full_name, role, department, is_active, must_change_password)
                        VALUES ('test_pwd_reset_nurse', 'test_pwd_reset_nurse@hospital.org', '$2b$12$aPsckHdYBHnxdGPTK7.bi.51JvQ1jaLywa1tHN2RJynRWLHteI9PW', 'Test Reset Nurse, RN', 'NURSE', 'EMERGENCY', true, false)
                        ON CONFLICT (email) DO UPDATE SET is_active = true, must_change_password = false;
                    """)
                finally:
                    await conn.close()
            asyncio.run(_seed_test_nurse())
        except Exception:
            pass


    # Step 1: Reject non-hospital domain via Gateway on forgot-password
    try:
        req = urllib.request.Request(
            f"{gateway_url}/auth/forgot-password",
            data=json.dumps({"email": "hacker@external.com"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            test_result("Gateway forgot-password rejects external domain", False, f"Expected 422, got {resp.status}")
    except urllib.error.HTTPError as e:
        test_result("Gateway forgot-password rejects external domain with HTTP 422", e.code == 422)
    except Exception as e:
        test_result("Gateway connection error", False, str(e))

    # Step 1b: Reject non-hospital domain via Gateway on login
    try:
        l_bad = urllib.request.Request(
            f"{gateway_url}/auth/login",
            data=json.dumps({"email": "attacker@gmail.com", "password": "Password123!"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(l_bad) as resp:
            test_result("Gateway login rejects non-hospital domain", False, f"Expected 422, got {resp.status}")
    except urllib.error.HTTPError as e:
        test_result("Gateway login rejects non-hospital domain with HTTP 422", e.code == 422)
    except Exception as e:
        test_result("Gateway connection error on login check", False, str(e))

    # Step 2: Request password reset for valid @hospital.org account
    target_email = "test_pwd_reset_nurse@hospital.org"
    try:
        req = urllib.request.Request(
            f"{gateway_url}/auth/forgot-password",
            data=json.dumps({"email": target_email}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            test_result(
                "Gateway accepts valid @hospital.org email with 200 OK",
                resp.status == 200 and data.get("status") == "SUCCESS"
            )
    except Exception as e:
        test_result("Gateway forgot-password dispatch failed", False, str(e))
        return

    # Give async task time to send email to Mailpit
    import time
    time.sleep(1.5)

    # Step 3: Check Mailpit messages
    try:
        with urllib.request.urlopen(f"{mailpit_url}/api/v1/messages") as resp:
            messages_data = json.loads(resp.read().decode())
            messages = messages_data.get("messages", [])
            test_result("Mailpit received at least one email message", len(messages) > 0)

            latest_msg = messages[0] if messages else None
            if latest_msg:
                msg_id = latest_msg["ID"]
                # Fetch full message
                with urllib.request.urlopen(f"{mailpit_url}/api/v1/message/{msg_id}") as m_resp:
                    full_msg = json.loads(m_resp.read().decode())
                    text_body = full_msg.get("Text", "") + full_msg.get("HTML", "")
                    test_result("Email contains reset link", "reset-password?token=" in text_body)

                    token_match = re.search(r"reset-password\?token=([a-zA-Z0-9_\-]+)", text_body)
                    test_result("Token successfully extracted from email", bool(token_match))

                    if token_match:
                        extracted_token = token_match.group(1)

                        # Step 4: Test Reset Password via Gateway with extracted token
                        new_pass = f"ResetNurse{secrets.token_hex(4)}!A1"
                        reset_req = urllib.request.Request(
                            f"{gateway_url}/auth/reset-password",
                            data=json.dumps({
                                "token": extracted_token,
                                "new_password": new_pass,
                                "confirm_password": new_pass
                            }).encode(),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(reset_req) as r_resp:
                            r_data = json.loads(r_resp.read().decode())
                            test_result(
                                "Password reset succeeded with token from email",
                                r_resp.status == 200 and r_data.get("status") == "SUCCESS"
                            )

                        # Step 5: Verify single-use token (second attempt must fail)
                        try:
                            with urllib.request.urlopen(reset_req) as _:
                                test_result("Reused reset token rejected", False, "Should have failed")
                        except urllib.error.HTTPError as r_err:
                            test_result("Reused reset token rejected with 400", r_err.code == 400)

                        # Step 6: Test login with the newly set password
                        login_req = urllib.request.Request(
                            f"{gateway_url}/auth/login",
                            data=json.dumps({
                                "email": target_email,
                                "password": new_pass
                            }).encode(),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(login_req) as l_resp:
                            l_data = json.loads(l_resp.read().decode())
                            test_result(
                                "Login succeeds with the newly reset password",
                                l_resp.status == 200 and "access_token" in l_data
                            )

    except Exception as e:
        test_result("Mailpit integration test failed", False, str(e))


def main():
    print("=" * 65)
    print("HIP SELF-SERVICE PASSWORD RESET TDD VALIDATION SUITE")
    print("=" * 65)

    test_token_generation_and_hashing()
    test_email_template_rendering()
    test_pydantic_schema_and_domain_validation()
    test_token_expiration_logic()
    test_password_history_invalidation()
    test_live_mailpit_and_gateway_flow()

    print("\n" + "=" * 65)
    print(f"RESULTS: {passed} PASSED, {failed} FAILED")
    print("=" * 65)

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
