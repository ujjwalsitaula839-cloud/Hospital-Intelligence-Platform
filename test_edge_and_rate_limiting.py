"""
Live integration test suite verifying Nginx edge proxy, port lockdown, HTTP hardening,
gateway proxy headers/rate limits, and auth brute-force 429 JSON throttling.

Uses Python standard library only so it runs on any host or CI runner.
"""
import http.client
import json
import os
import socket
import sys
from typing import Optional

BASE_URL = os.getenv("GATEWAY_URL", "http://localhost:8080").rstrip("/")
NGINX_HOST = os.getenv("EDGE_HOST", "127.0.0.1")
NGINX_PORT = int(os.getenv("EDGE_PORT", "8080"))

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} -- {detail}")


def http_req(
    path: str,
    method: str = "GET",
    body: Optional[bytes] = None,
    headers: Optional[dict] = None,
):
    conn = http.client.HTTPConnection(NGINX_HOST, NGINX_PORT, timeout=10)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8", errors="replace")
        return resp.status, dict(resp.getheaders()), raw
    finally:
        conn.close()


def is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1.0)
        return sock.connect_ex((host, port)) == 0


def main() -> None:
    print("=" * 70)
    print("   HIP NGINX EDGE PROXY, PORT LOCKDOWN & RATE LIMIT INTEGRATION SUITE")
    print("=" * 70)

    # 1. Edge & Gateway Health through Nginx
    status, headers, raw = http_req("/nginx-health")
    check("GET /nginx-health returns 200 JSON", status == 200 and '"nginx"' in raw, f"status={status} body={raw}")

    status, headers, raw = http_req("/health")
    check(
        "GET /health proxies to gateway & reports healthy Redis",
        status == 200 and '"gateway"' in raw and '"connected"' in raw,
        f"status={status} body={raw}",
    )

    # 2. Internal gateway & microservice ports must NOT be exposed on host
    for svc_name, port in [
        ("gateway", 8000),
        ("auth-service", 8001),
        ("patient-service", 8002),
        ("bed-service", 8003),
    ]:
        open_state = is_port_open("127.0.0.1", port)
        check(f"{svc_name} port :{port} is closed on host (no Nginx bypass)", not open_state, f"port {port} is open!")

    # 3. Swagger / OpenAPI / hidden dotfiles blocked in production Nginx
    for blocked_path in ("/docs", "/redoc", "/openapi.json", "/.env", "/.git/config"):
        st, _, _ = http_req(blocked_path)
        check(f"Blocked scanner path GET {blocked_path} -> 404", st == 404, f"got {st}")

    # 4. Unsupported HTTP method blocked
    st, _, _ = http_req("/health", method="TRACE")
    check("Unsupported TRACE method blocked with HTTP 405", st == 405, f"got {st}")

    # 5. Version hiding & security headers
    st, hdrs, _ = http_req("/health")
    lower_hdrs = {k.lower(): v for k, v in hdrs.items()}
    server_hdr = lower_hdrs.get("server", "")
    check("Nginx version suppressed from Server header", "/" not in server_hdr, f"Server={server_hdr!r}")
    check(
        "Security headers present from gateway",
        lower_hdrs.get("x-content-type-options") == "nosniff" and lower_hdrs.get("x-frame-options") == "DENY",
        f"headers={lower_hdrs}",
    )

    # 6. Oversized payload (> 1 MB nginx client_max_body_size) rejected with 413
    big_payload = b'{"pad":"' + (b"A" * (1100 * 1024)) + b'"}'
    try:
        st, _, _ = http_req("/auth/login", method="POST", body=big_payload, headers={"Content-Type": "application/json"})
        check("Oversized >1MB request rejected with HTTP 413", st == 413, f"got {st}")
    except (ConnectionResetError, BrokenPipeError, http.client.HTTPException) as exc:
        # Nginx may immediately return 413 and close socket before client finishes writing body
        check("Oversized >1MB request terminated early by Nginx", True, str(exc))

    # 7. Gateway rate-limit headers & WebSocket auth check via Nginx
    st, hdrs, _ = http_req("/beds/grid")
    lower_hdrs = {k.lower(): v for k, v in hdrs.items()}
    check(
        "Authenticated/protected route returns 401 + Redis X-RateLimit headers",
        st == 401 and "x-ratelimit-limit" in lower_hdrs and "x-ratelimit-remaining" in lower_hdrs,
        f"status={st} headers={lower_hdrs}",
    )

    # 8. Auth brute-force burst triggers Nginx JSON 429
    print("\n--- Firing 18 rapid POST /auth/login requests to trigger Nginx auth_strict (429) ---")
    statuses = []
    throttled_body = ""
    throttled_ct = ""
    for _ in range(18):
        st, h, body = http_req(
            "/auth/login",
            method="POST",
            body=b'{"email":"ratelimit_probe@external.com","password":"WrongPassword1!"}',
            headers={"Content-Type": "application/json"},
        )
        statuses.append(st)
        if st == 429 and not throttled_body:
            throttled_body = body
            throttled_ct = {k.lower(): v for k, v in h.items()}.get("content-type", "")

    has_429 = 429 in statuses
    valid_json_429 = False
    if throttled_body:
        try:
            parsed = json.loads(throttled_body)
            valid_json_429 = "detail" in parsed
        except json.JSONDecodeError:
            valid_json_429 = False

    check(
        "Nginx auth_strict triggers HTTP 429 under rapid burst",
        has_429,
        f"observed statuses={statuses}",
    )
    check(
        "Nginx 429 response returns structured application/json",
        valid_json_429 and "application/json" in throttled_ct,
        f"ct={throttled_ct!r} body={throttled_body!r}",
    )

    print("\n" + "=" * 70)
    print(f"   RESULTS: {passed} PASSED  |  {failed} FAILED")
    print("=" * 70)
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

