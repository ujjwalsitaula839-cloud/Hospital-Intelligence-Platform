"""
Unit test suite for API Gateway DDoS/rate-limiting, trusted proxy IP extraction,
WebSocket connection caps, payload limits, and zero-trust X-Gateway-Secret propagation.
"""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-gateway-secret-key-for-unit-tests-only")
os.environ.setdefault("ENV", "production")
os.environ.setdefault("ENABLE_DOCS", "false")
os.environ.setdefault("INTERNAL_SERVICE_SECRET", "unit-test-shared-secret")

ROOT = Path(__file__).resolve().parent.parent
GATEWAY_DIR = Path(__file__).resolve().parent


def _load_security_module(service_name: str):
    path = ROOT / "services" / service_name / "security.py"
    spec = importlib.util.spec_from_file_location(f"{service_name}_security_test", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class TestGatewaySecurityAndRateLimiting(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Lazy-import gateway dependencies so service containers without httpx/redis
        # can still execute TestServiceZeroTrustGatewaySecret cleanly.
        from fastapi.testclient import TestClient

        if str(GATEWAY_DIR) not in sys.path:
            sys.path.insert(0, str(GATEWAY_DIR))
        import main as gw_mod

        cls.gw = gw_mod
        cls.TestClient = TestClient

    def test_docs_disabled_in_production(self):
        client = self.TestClient(self.gw.app)
        self.assertEqual(client.get("/docs").status_code, 404)
        self.assertEqual(client.get("/redoc").status_code, 404)
        self.assertEqual(client.get("/openapi.json").status_code, 404)

    def test_extract_client_ip_trusts_only_private_proxy_peers(self):
        trusted_req = MagicMock()
        trusted_req.client.host = "172.18.0.5"
        trusted_req.headers = {"X-Real-IP": "203.0.113.42", "X-Forwarded-For": "198.51.100.7"}
        self.assertEqual(self.gw._extract_client_ip(trusted_req), "203.0.113.42")

        untrusted_req = MagicMock()
        untrusted_req.client.host = "198.51.100.99"
        untrusted_req.headers = {"X-Real-IP": "127.0.0.1", "X-Forwarded-For": "10.0.0.1"}
        self.assertEqual(self.gw._extract_client_ip(untrusted_req), "198.51.100.99")

    def test_prepare_forward_headers_strips_forged_headers_and_injects_gateway_secret(self):
        req = MagicMock()
        req.headers = {
            "Authorization": "Bearer abc",
            "X-User-Role": "ADMIN",
            "X-Internal-Token": "forged",
            "X-Gateway-Secret": "forged-gw",
            "Content-Type": "application/json",
        }
        req.client.host = "172.18.0.5"
        req.state.client_ip = "203.0.113.42"
        req.state.user_id = "7"
        req.state.username = "nurse_amy"
        req.state.role = "NURSE"
        req.state.department = "EMERGENCY"
        req.state.full_name = "Amy Pond, RN"

        forwarded = self.gw._prepare_forward_headers(req)
        self.assertEqual(forwarded["X-Real-IP"], "203.0.113.42")
        self.assertEqual(forwarded["X-Forwarded-For"], "203.0.113.42")
        self.assertEqual(forwarded["X-Gateway-Secret"], "unit-test-shared-secret")
        self.assertEqual(forwarded["X-User-Role"], "NURSE")
        self.assertEqual(forwarded["X-User-Id"], "7")
        self.assertNotIn("X-Internal-Token", forwarded)

    def test_rate_limit_rule_selection(self):
        req = MagicMock()
        req.method = "POST"
        req.state.user_id = "42"
        req.url.path = "/api/v1/beds/elon/chat"
        self.assertEqual(self.gw._select_rate_limit_rule(req, "1.2.3.4"), ("rl:ai:user:42", self.gw.RATE_LIMIT_AI_PER_MIN))

        req.state.user_id = None
        req.url.path = "/auth/login"
        self.assertEqual(
            self.gw._select_rate_limit_rule(req, "1.2.3.4"),
            ("rl:auth:ip:1.2.3.4", self.gw.RATE_LIMIT_ANON_AUTH_PER_MIN),
        )

        req.url.path = "/health"
        self.assertIsNone(self.gw._select_rate_limit_rule(req, "1.2.3.4"))

    def test_gateway_returns_429_json_when_redis_limit_exceeded(self):
        client = self.TestClient(self.gw.app)
        with patch.object(self.gw, "_enforce_rate_limit", new=AsyncMock(return_value=(False, 0, 25))):
            resp = client.get("/beds/grid")
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.headers.get("Retry-After"), "25")
        self.assertEqual(resp.headers.get("X-RateLimit-Remaining"), "0")
        self.assertIn("Rate limit exceeded", resp.json()["detail"])

    def test_gateway_rejects_oversized_payload_with_413(self):
        client = self.TestClient(self.gw.app)
        with (
            patch.object(self.gw, "_enforce_rate_limit", new=AsyncMock(return_value=(True, 10, 60))),
            patch.object(self.gw, "http_client", new=AsyncMock()),
        ):
            resp = client.post(
                "/patients/register",
                headers={"Content-Length": str(self.gw.MAX_BODY_BYTES + 100)},
                json={"first_name": "Big"},
            )
        self.assertEqual(resp.status_code, 413)

    def test_websocket_connection_manager_enforces_per_user_cap(self):
        mgr = self.gw.ConnectionManager()
        for idx in range(self.gw.MAX_WS_PER_USER):
            ws = MagicMock()
            mgr.active_connections.add(ws)
            mgr.user_connections.setdefault("user-1", set()).add(ws)
        allowed, reason = mgr.can_connect("user-1")
        self.assertFalse(allowed)
        self.assertIn("Too many concurrent WebSocket connections", reason)


class TestServiceZeroTrustGatewaySecret(unittest.TestCase):
    def test_all_services_reject_missing_or_wrong_gateway_secret(self):
        for service in ("patient-service", "bed-service", "auth-service"):
            sec = _load_security_module(service)
            checker = sec.require_roles(sec.UserRole.ADMIN)
            with self.assertRaises(Exception) as ctx:
                checker(
                    x_user_id="1",
                    x_user_role="ADMIN",
                    x_user_username="admin",
                    x_user_department="ADMINISTRATION",
                    x_user_fullname="Admin",
                    x_gateway_secret="wrong-secret",
                )
            self.assertEqual(ctx.exception.status_code, 401)

            accepted = checker(
                x_user_id="1",
                x_user_role="ADMIN",
                x_user_username="admin",
                x_user_department="ADMINISTRATION",
                x_user_fullname="Admin",
                x_gateway_secret="unit-test-shared-secret",
            )
            self.assertEqual(accepted["user_id"], 1)
            self.assertEqual(accepted["role"], "ADMIN")


if __name__ == "__main__":
    unittest.main(verbosity=2)

