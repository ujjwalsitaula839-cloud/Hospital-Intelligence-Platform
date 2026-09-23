import asyncio
from contextlib import asynccontextmanager
import json
import logging
import os
from typing import Any, Dict, Optional, Set
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
BED_EVENTS_CHANNEL = "bed:events"

http_client: Optional[httpx.AsyncClient] = None


class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info("WebSocket connected. Active clients: %d", len(self.active_connections))

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
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
    global http_client
    http_client = httpx.AsyncClient(
        timeout=15.0,
        limits=httpx.Limits(max_keepalive_connections=30, max_connections=150),
        follow_redirects=True
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


app = FastAPI(
    title="Hospital Intelligence Platform - API Gateway",
    version="2.3.0",
    swagger_ui_parameters={"persistAuthorization": True},
    lifespan=lifespan
)

# --- CORS — HIGH-3 FIX: Tighten from wildcard to explicit ---
cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)


# --- LOW-3 FIX: Security headers middleware (CSP allows Swagger CDN assets) ---
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
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        last_logout = await redis.get(f"last_logout:{user_id}")
        return bool(last_logout and issued_at < float(last_logout))
    finally:
        await redis.aclose()


ALLOWED_RESET_ROUTES = {
    ("POST", "/auth/force-reset-password"),
    ("POST", "/auth/logout"),
    ("GET", "/auth/me"),
}


# --- User context extraction middleware ---
@app.middleware("http")
async def extract_user_context(request: Request, call_next):
    request.state.user_id = None
    request.state.username = None
    request.state.role = None
    request.state.department = None
    request.state.full_name = None

    token = _extract_bearer_token(request.headers.get("Authorization"))
    if not token:
        return await call_next(request)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except (jwt.PyJWTError, IndexError, Exception) as e:
        logger.debug("Failed to decode token: %s", e)
        return await call_next(request)

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

    return await call_next(request)


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
        redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        try:
            last_logout = await redis.get(f"last_logout:{user_id}")
            if last_logout and token_issued_at < float(last_logout):
                return None
        finally:
            await redis.aclose()

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

    user_id = payload.get("sub")
    logger.info("Authenticated WebSocket connection from user_id=%s", user_id)

    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        manager.disconnect(websocket)


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
        redis = aioredis.from_url(redis_url, decode_responses=True)
        try:
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
        finally:
            await redis.aclose()
    except Exception as e:
        logger.warning("Idempotency check failed, bypassing: %s", e)
        return None


async def save_idempotency(redis_url: str, key: str, status_code: int, body_text: str):
    """Store completed response under Idempotency-Key with sliding TTL."""
    try:
        redis = aioredis.from_url(redis_url, decode_responses=True)
        try:
            data = json.dumps({"status_code": status_code, "body": body_text})
            await redis.set(key, data, ex=IDEMPOTENCY_TTL_SECONDS)
        finally:
            await redis.aclose()
    except Exception as e:
        logger.warning("Failed to save idempotency cache: %s", e)


async def clear_idempotency(redis_url: str, key: str):
    """Clear key on upstream/downstream errors so client can retry immediately."""
    try:
        redis = aioredis.from_url(redis_url, decode_responses=True)
        try:
            await redis.delete(key)
        finally:
            await redis.aclose()
    except Exception as e:
        logger.warning("Failed to clear idempotency key: %s", e)


def _prepare_forward_headers(request: Request) -> dict:
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in HOP_BY_HOP_HEADERS
        and not k.lower().startswith("x-user-")
        and not k.lower().startswith("x-internal-")
    }
    if request.client:
        headers["X-Forwarded-For"] = request.client.host
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

    clean_path = urllib.parse.unquote(path).lstrip("/")
    target_url = _build_target_url(service_name, clean_path)

    has_body = request.method.lower() in BODY_METHODS
    body = await request.body() if has_body else None

    redis_idemp_key = _build_idempotency_key(request, has_body, service_name, clean_path)
    if redis_idemp_key:
        cached_resp = await check_idempotency(REDIS_URL, redis_idemp_key)
        if cached_resp is not None:
            return cached_resp

    headers_to_forward = _prepare_forward_headers(request)

    try:
        response = await http_client.request(
            method=request.method,
            url=target_url,
            headers=headers_to_forward,
            params=list(request.query_params.multi_items()),
            content=body
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
        logger.error("Downstream communication failure at %s: %s", target_url, e)
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