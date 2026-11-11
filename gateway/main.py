import asyncio
from contextlib import asynccontextmanager
import ipaddress
import json
import logging
import os
from typing import Any, Dict, Optional, Set, Tuple
import urllib.parse

from fastapi import Body, Depends, FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
import httpx
import jwt
import redis.asyncio as aioredis

logger = logging.getLogger("hip.gateway")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set.")

ALGORITHM = "HS256"
REDIS_URL = os.getenv("REDIS_URL", "redis://hip-redis:6379")
INTERNAL_SERVICE_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")
GATEWAY_ENV = os.getenv("ENV", "development").lower()
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "false").lower() == "true" or GATEWAY_ENV != "production"
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "true").lower() == "true"

MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", str(2 * 1024 * 1024)))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMIT_AI_PER_MIN = int(os.getenv("RATE_LIMIT_AI_PER_MIN", "20"))
RATE_LIMIT_USER_PER_MIN = int(os.getenv("RATE_LIMIT_USER_PER_MIN", "300"))
RATE_LIMIT_ANON_AUTH_PER_MIN = int(os.getenv("RATE_LIMIT_ANON_AUTH_PER_MIN", "60"))
MAX_WS_PER_USER = int(os.getenv("MAX_WS_PER_USER", "5"))
MAX_WS_TOTAL = int(os.getenv("MAX_WS_TOTAL", "1000"))
MAX_WS_MSG_BYTES = 4096

BED_EVENTS_CHANNEL = "bed:events"

REDIS_RATE_LIMIT_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
"""

http_client: Optional[httpx.AsyncClient] = None
redis_client: Optional[aioredis.Redis] = None


@asynccontextmanager
async def _get_redis():
    """Reuse the shared Redis client from lifespan, or open a short-lived one in isolated tests."""
    if redis_client is not None:
        yield redis_client
        return
    temp_client = aioredis.from_url(
        REDIS_URL, decode_responses=True, socket_timeout=1.5, socket_connect_timeout=1.5
    )
    try:
        yield temp_client
    finally:
        await temp_client.aclose()


class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.user_connections: Dict[str, Set[WebSocket]] = {}

    def can_connect(self, user_id: str) -> Tuple[bool, str]:
        if len(self.active_connections) >= MAX_WS_TOTAL:
            return False, "Server WebSocket capacity reached. Try again shortly."
        if len(self.user_connections.get(user_id, set())) >= MAX_WS_PER_USER:
            return False, "Too many concurrent WebSocket connections for this user."
        return True, ""

    async def connect(self, websocket: WebSocket, user_id: Optional[str] = None):
        await websocket.accept()
        self.active_connections.add(websocket)
        if user_id:
            self.user_connections.setdefault(user_id, set()).add(websocket)
        logger.info("WebSocket connected. Active clients: %d", len(self.active_connections))

    def disconnect(self, websocket: WebSocket, user_id: Optional[str] = None):
        self.active_connections.discard(websocket)
        if user_id and user_id in self.user_connections:
            self.user_connections[user_id].discard(websocket)
            if not self.user_connections[user_id]:
                self.user_connections.pop(user_id, None)
        else:
            for uid in list(self.user_connections.keys()):
                self.user_connections[uid].discard(websocket)
                if not self.user_connections[uid]:
                    self.user_connections.pop(uid, None)
        logger.info("WebSocket disconnected. Active clients: %d", len(self.active_connections))

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.warning("Dropping unreachable WebSocket client: %s", e)
                self.disconnect(connection)


manager = ConnectionManager()


async def redis_pubsub_listener():
    """Background listener forwarding Redis bed events to active WebSocket clients."""
    while True:
        redis = None
        pubsub = None
        try:
            redis = aioredis.from_url(REDIS_URL, decode_responses=True)
            pubsub = redis.pubsub()
            await pubsub.subscribe(BED_EVENTS_CHANNEL)
            logger.info("Subscribed to Redis channel '%s'", BED_EVENTS_CHANNEL)

            async for message in pubsub.listen():
                if message and message.get("type") == "message":
                    event_data = message.get("data")
                    if event_data:
                        await manager.broadcast(event_data)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Redis Pub/Sub error: %s. Reconnecting in 3s...", e)
            await asyncio.sleep(3)
        finally:
            if pubsub:
                await pubsub.close()
            if redis:
                await redis.aclose()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client, redis_client
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(25.0, connect=10.0),
        limits=httpx.Limits(max_keepalive_connections=30, max_connections=150),
        follow_redirects=True
    )
    redis_client = aioredis.from_url(
        REDIS_URL, decode_responses=True, socket_timeout=1.5, socket_connect_timeout=1.5
    )

    listener_task = asyncio.create_task(redis_pubsub_listener())
    yield

    listener_task.cancel()
    try:
        await listener_task
    except asyncio.CancelledError:
        pass

    if http_client:
        await http_client.aclose()
    if redis_client:
        await redis_client.aclose()
        redis_client = None


app = FastAPI(
    title="Hospital Intelligence Platform - API Gateway",
    version="2.4.0",
    docs_url="/docs" if ENABLE_DOCS else None,
    redoc_url="/redoc" if ENABLE_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_DOCS else None,
    swagger_ui_parameters={"persistAuthorization": True},
    lifespan=lifespan
)


def _parse_valid_ip(raw_ip: Optional[str]) -> Optional[str]:
    if not raw_ip:
        return None
    try:
        return str(ipaddress.ip_address(raw_ip.strip()))
    except ValueError:
        return None


_TRUSTED_PROXY_NETWORKS = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
)


def _is_trusted_proxy_peer(peer_host: Optional[str]) -> bool:
    if not peer_host:
        return False
    try:
        addr = ipaddress.ip_address(peer_host)
        if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
            addr = addr.ipv4_mapped
        return any(addr in net for net in _TRUSTED_PROXY_NETWORKS)
    except ValueError:
        return False


def _extract_client_ip(request: Request) -> str:
    """Resolve client IP, trusting Nginx X-Real-IP / X-Forwarded-For only from trusted local proxies."""
    peer_host = request.client.host if request.client else ""
    if TRUST_PROXY_HEADERS and _is_trusted_proxy_peer(peer_host):
        real_ip = _parse_valid_ip(request.headers.get("X-Real-IP"))
        if real_ip:
            return real_ip
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            first_hop = _parse_valid_ip(forwarded.split(",")[0])
            if first_hop:
                return first_hop
    return peer_host or "unknown"


def _normalize_gateway_path(raw_path: str) -> str:
    path = raw_path.rstrip("/") or "/"
    if path.startswith("/api/v1/"):
        path = "/" + path[len("/api/v1/"):]
    return path


_AI_ROUTE_PATHS = frozenset({
    "/beds/elon/chat",
    "/beds/beds/elon/chat",
    "/beds/recommend",
    "/beds/recommend/reserve",
})


def _select_rate_limit_rule(request: Request, client_ip: str) -> Optional[Tuple[str, int]]:
    """Select per-user or per-IP Redis rate limit bucket matching endpoint sensitivity."""
    if request.method.upper() == "OPTIONS":
        return None

    path = _normalize_gateway_path(request.url.path)
    if path in ("/health", "/nginx-health"):
        return None

    user_id = getattr(request.state, "user_id", None)
    if path in _AI_ROUTE_PATHS:
        identity = f"user:{user_id}" if user_id else f"ip:{client_ip}"
        return f"rl:ai:{identity}", RATE_LIMIT_AI_PER_MIN

    if path.startswith("/auth/") and not user_id:
        return f"rl:auth:ip:{client_ip}", RATE_LIMIT_ANON_AUTH_PER_MIN

    if user_id:
        return f"rl:user:{user_id}", RATE_LIMIT_USER_PER_MIN

    return f"rl:anon:ip:{client_ip}", RATE_LIMIT_USER_PER_MIN


async def _enforce_rate_limit(
    key: str,
    limit: int,
    window_seconds: int = RATE_LIMIT_WINDOW_SECONDS
) -> Tuple[bool, int, int]:
    """Atomic Redis fixed-window limiter; fails open if Redis is temporarily unavailable."""
    try:
        async with _get_redis() as redis:
            res = await redis.eval(REDIS_RATE_LIMIT_LUA, 1, key, str(window_seconds))
            count = int(res[0])
            ttl = int(res[1]) if len(res) > 1 and int(res[1]) > 0 else window_seconds
            remaining = max(0, limit - count)
            return count <= limit, remaining, ttl
    except Exception as e:
        logger.warning("Gateway rate limiter skipped (Redis unavailable): %s", e)
        return True, limit, window_seconds


bearer_scheme = APIKeyHeader(name="Authorization", auto_error=False, description="Format: Bearer <JWT_TOKEN>")


def _extract_bearer_token(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header:
        return None
    raw = auth_header.strip()
    if raw.lower().startswith("bearer "):
        raw = raw[7:].strip()
    token = raw.strip('"').strip("'")
    if '"' in token:
        token = token.split('"', 1)[0].strip()
    if ',' in token:
        token = token.split(',', 1)[0].strip()
    return token or None


async def _check_token_revocation(user_id: str, issued_at: float) -> bool:
    async with _get_redis() as redis:
        last_logout = await redis.get(f"last_logout:{user_id}")
        return bool(last_logout and issued_at < float(last_logout))


ALLOWED_RESET_ROUTES = {
    ("POST", "/auth/force-reset-password"),
    ("POST", "/auth/logout"),
    ("GET", "/auth/me"),
    ("POST", "/auth/forgot-password"),
    ("POST", "/auth/reset-password"),
    ("POST", "/api/v1/auth/forgot-password"),
    ("POST", "/api/v1/auth/reset-password"),
}


# --- 1. Inner middleware: JWT user extraction & Redis per-user/IP rate limiting ---
@app.middleware("http")
async def extract_user_context(request: Request, call_next):
    request.state.user_id = None
    request.state.username = None
    request.state.role = None
    request.state.department = None
    request.state.full_name = None

    token = _extract_bearer_token(request.headers.get("Authorization"))
    if token:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except (jwt.PyJWTError, IndexError, Exception) as e:
            logger.debug("Failed to decode token: %s", e)
            payload = None

        if payload:
            user_id = payload.get("sub")
            issued_at = payload.get("iat")
            if issued_at and user_id and await _check_token_revocation(user_id, issued_at):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Token has been revoked by logout. Please log in again."}
                )

            request.state.user_id = user_id
            request.state.role = payload.get("role")
            request.state.username = payload.get("username")
            request.state.department = payload.get("department")
            request.state.full_name = payload.get("full_name")

            # Restricted tokens (must_change_password=True) are blocked from all clinical routes.
            if payload.get("must_change_password"):
                req_pair = (request.method.upper(), request.url.path.rstrip("/"))
                if req_pair not in ALLOWED_RESET_ROUTES:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Password reset required before accessing clinical resources."}
                    )

    client_ip = _extract_client_ip(request)
    request.state.client_ip = client_ip
    rate_rule = _select_rate_limit_rule(request, client_ip)
    rate_headers: Dict[str, str] = {}

    if rate_rule:
        rate_key, limit = rate_rule
        allowed, remaining, reset_ttl = await _enforce_rate_limit(rate_key, limit)
        rate_headers = {
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": str(remaining),
        }
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please wait before retrying."},
                headers={**rate_headers, "Retry-After": str(max(1, reset_ttl))},
            )

    response = await call_next(request)
    for k, v in rate_headers.items():
        response.headers[k] = v
    return response


# --- 2. Security headers middleware (applies to both normal and 401/403/429 responses) ---
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "0"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "img-src 'self' data: https://fastapi.tiangolo.com; "
        "connect-src 'self' ws: wss:;"
    )
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


# --- 3. Outermost middleware: CORS (added last so even 401/403/429 responses receive CORS headers) ---
cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)


@app.get("/health")
async def gateway_health():
    """Lightweight gateway readiness endpoint (Redis check non-blocking for fail-open routing)."""
    redis_status = "unavailable"
    try:
        async with _get_redis() as redis:
            if await redis.ping():
                redis_status = "connected"
    except Exception:
        pass
    return {"status": "healthy", "service": "gateway", "redis": redis_status}


# --- HIGH-1 FIX: WebSocket with JWT authentication ---
async def validate_ws_token(token: str) -> Optional[Dict[str, Any]]:
    """Validate a JWT token for WebSocket authentication."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None

    user_id = payload.get("sub")
    token_issued_at = payload.get("iat")

    if not user_id:
        return None

    # Check Redis revocation
    if token_issued_at and user_id:
        async with _get_redis() as redis:
            last_logout = await redis.get(f"last_logout:{user_id}")
            if last_logout and token_issued_at < float(last_logout):
                return None

    return payload


@app.websocket("/ws/beds")
async def websocket_bed_updates(websocket: WebSocket):
    # HIGH-1 FIX: Require JWT token via query parameter
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Authentication required. Provide token as query parameter.")
        return

    payload = await validate_ws_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid or expired authentication token.")
        return

    user_id = str(payload.get("sub"))
    allowed, reason = manager.can_connect(user_id)
    if not allowed:
        await websocket.close(code=4008, reason=reason)
        return

    logger.info("Authenticated WebSocket connection from user_id=%s", user_id)

    await manager.connect(websocket, user_id=user_id)
    try:
        while True:
            msg = await websocket.receive_text()
            if len(msg.encode("utf-8", errors="ignore")) > MAX_WS_MSG_BYTES:
                await websocket.close(code=1009, reason="Incoming WebSocket frame exceeds size limit.")
                break
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        manager.disconnect(websocket, user_id=user_id)


# ===========================================================================
# SERVICE PROXY CONFIGURATION
# ===========================================================================

SERVICES_CONFIG = {
    "auth": {
        "url": os.getenv("AUTH_SERVICE_URL", "http://hip-auth-service:8001").rstrip("/"),
        "error_msg": "Authentication microservice is down or unreachable.",
        "methods": ["get", "post", "put", "delete"],
        "strip_prefix": True
    },
    "patients": {
        "url": os.getenv("PATIENT_SERVICE_URL", "http://hip-patient-service:8002").rstrip("/"),
        "error_msg": "Patient microservice is down or unreachable.",
        "methods": ["get", "post", "put", "delete"],
        "strip_prefix": True
    },
    "beds": {
        "url": os.getenv("BED_SERVICE_URL", "http://hip-bed-service:8003").rstrip("/"),
        "error_msg": "Bed management microservice is down or unreachable.",
        "methods": ["get", "put", "post", "delete", "patch"],
        "strip_prefix": True
    }
}

BODY_METHODS = {"post", "put", "patch", "delete"}

HOP_BY_HOP_HEADERS = {
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "content-encoding"
}

IDEMPOTENCY_TTL_SECONDS = 120  # 2 minute protection window for tablet/network retries


async def check_idempotency(redis_url: str, key: str) -> Optional[Response]:
    """Check if an Idempotency-Key is already completed or in flight."""
    try:
        async with _get_redis() as redis:
            cached_val = await redis.get(key)
            if cached_val:
                if cached_val == "IN_PROGRESS":
                    return JSONResponse(
                        status_code=409,
                        content={"detail": "A request with this Idempotency-Key is currently in progress."}
                    )
                cached = json.loads(cached_val)
                resp = Response(
                    content=cached.get("body", "").encode("utf-8"),
                    status_code=cached.get("status_code", 200),
                    media_type="application/json"
                )
                resp.headers["X-Cache-Lookup"] = "HIT-IDEMPOTENT"
                return resp
            # Reserve key atomically
            await redis.set(key, "IN_PROGRESS", ex=IDEMPOTENCY_TTL_SECONDS)
            return None
    except Exception as e:
        logger.warning("Idempotency check failed, bypassing: %s", e)
        return None


async def save_idempotency(redis_url: str, key: str, status_code: int, body_text: str):
    """Store completed response under Idempotency-Key with sliding TTL."""
    try:
        async with _get_redis() as redis:
            data = json.dumps({"status_code": status_code, "body": body_text})
            await redis.set(key, data, ex=IDEMPOTENCY_TTL_SECONDS)
    except Exception as e:
        logger.warning("Failed to save idempotency cache: %s", e)


async def clear_idempotency(redis_url: str, key: str):
    """Clear key on upstream/downstream errors so client can retry immediately."""
    try:
        async with _get_redis() as redis:
            await redis.delete(key)
    except Exception as e:
        logger.warning("Failed to clear idempotency key: %s", e)


def _prepare_forward_headers(request: Request) -> dict:
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in HOP_BY_HOP_HEADERS
        and not k.lower().startswith("x-user-")
        and not k.lower().startswith("x-internal-")
        and not k.lower().startswith("x-gateway-")
    }
    client_ip = getattr(request.state, "client_ip", None) or _extract_client_ip(request)
    if client_ip and client_ip != "unknown":
        headers["X-Real-IP"] = client_ip
        headers["X-Forwarded-For"] = client_ip
    if INTERNAL_SERVICE_SECRET:
        headers["X-Gateway-Secret"] = INTERNAL_SERVICE_SECRET
    for attr, name in [
        ("user_id", "X-User-Id"),
        ("username", "X-User-Username"),
        ("role", "X-User-Role"),
        ("department", "X-User-Department"),
        ("full_name", "X-User-Fullname"),
    ]:
        val = getattr(request.state, attr, None)
        if val:
            headers[name] = str(val)
    return headers


def _build_idempotency_key(request: Request, has_body: bool, service: str, path: str) -> Optional[str]:
    key = request.headers.get("idempotency-key") or request.headers.get("x-idempotency-key")
    if not key or not has_body:
        return None
    user_part = str(request.state.user_id or "anon")
    return f"idempotency:{user_part}:{request.method.upper()}:{service}:{path}:{key}"


def _build_target_url(service_name: str, clean_path: str) -> str:
    config = SERVICES_CONFIG[service_name]
    return f"{config['url']}/{clean_path}" if config["strip_prefix"] else f"{config['url']}/{service_name}/{clean_path}"


async def _update_idempotency_cache(key: Optional[str], status_code: int, text: str) -> None:
    if not key:
        return
    if status_code < 500:
        await save_idempotency(REDIS_URL, key, status_code, text)
    else:
        await clear_idempotency(REDIS_URL, key)


async def forward_request(request: Request, service_name: str, path: str):
    if http_client is None:
        return JSONResponse(status_code=500, content={"detail": "Gateway HTTP Client uninitialized."})

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "Request payload too large."})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header."})

    clean_path = urllib.parse.unquote(path).lstrip("/")
    target_url = _build_target_url(service_name, clean_path)

    has_body = request.method.lower() in BODY_METHODS
    body = await request.body() if has_body else None
    if body is not None and len(body) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "Request payload too large."})

    redis_idemp_key = _build_idempotency_key(request, has_body, service_name, clean_path)
    if redis_idemp_key:
        cached_resp = await check_idempotency(REDIS_URL, redis_idemp_key)
        if cached_resp is not None:
            return cached_resp

    headers_to_forward = _prepare_forward_headers(request)

    upstream_timeout = 50.0 if _normalize_gateway_path(request.url.path) in _AI_ROUTE_PATHS else 25.0

    try:
        response = await http_client.request(
            method=request.method,
            url=target_url,
            headers=headers_to_forward,
            params=list(request.query_params.multi_items()),
            content=body,
            timeout=upstream_timeout,
        )

        response_headers = {
            k: v for k, v in response.headers.items()
            if k.lower() not in HOP_BY_HOP_HEADERS
        }

        await _update_idempotency_cache(redis_idemp_key, response.status_code, response.text)

        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=response_headers
        )
    except httpx.HTTPError as e:
        if redis_idemp_key:
            await clear_idempotency(REDIS_URL, redis_idemp_key)
        logger.error("Downstream communication failure at %s: %r", target_url, e)
        return JSONResponse(
            status_code=503,
            content={"detail": SERVICES_CONFIG[service_name]["error_msg"]}
        )


def register_proxy_endpoint(service_name: str, method_name: str):
    if method_name in BODY_METHODS:
        async def handler_with_body(
            request: Request,
            path: str,
            body: Optional[Any] = Body(default=None, media_type="application/json"),
            auth_token: Optional[str] = Depends(bearer_scheme)
        ):
            return await forward_request(request, service_name, path)
        handler_with_body.__name__ = f"route_{service_name}_{method_name}"
        return handler_with_body
    else:
        async def handler(
            request: Request,
            path: str,
            auth_token: Optional[str] = Depends(bearer_scheme)
        ):
            return await forward_request(request, service_name, path)
        handler.__name__ = f"route_{service_name}_{method_name}"
        return handler


for service_name, config in SERVICES_CONFIG.items():
    for method in config["methods"]:
        route_decorator = getattr(app, method)
        route_decorator(
            f"/{service_name}/{{path:path}}",
            summary=f"{service_name.capitalize()} -> {method.upper()}",
            tags=[service_name.capitalize()],
            responses={200: {"content": {"application/json": {}}}}
        )(register_proxy_endpoint(service_name, method))
        route_decorator(
            f"/api/v1/{service_name}/{{path:path}}",
            summary=f"API v1 {service_name.capitalize()} -> {method.upper()}",
            tags=[f"API v1 {service_name.capitalize()}"],
            responses={200: {"content": {"application/json": {}}}}
        )(register_proxy_endpoint(service_name, method))