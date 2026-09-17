import json
import asyncio
import os
import httpx
import jwt
from typing import Any, Dict, Optional, Set
from fastapi import FastAPI, Request, Response, Body, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import redis.asyncio as aioredis

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set.")
ALGORITHM = "HS256"
REDIS_URL = os.getenv("REDIS_URL", "redis://hip-redis:6379")
BED_EVENTS_CHANNEL = "bed:events"

# Shared persistent HTTP client pool
http_client: Optional[httpx.AsyncClient] = None

# --- WEBSOCKET CONNECTION MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"[WEBSOCKET] Client connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"[WEBSOCKET] Client disconnected. Total active: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception as e:
                print(f"[WEBSOCKET ERROR] Dropping unreachable client: {e}")
                self.disconnect(connection)

manager = ConnectionManager()

# --- REDIS PUB/SUB BACKGROUND LISTENER ---
async def redis_pubsub_listener():
    """Resilient background worker that subscribes to Redis events and broadcasts to WebSockets."""
    while True:
        redis = None
        pubsub = None
        try:
            redis = aioredis.from_url(REDIS_URL, decode_responses=True)
            pubsub = redis.pubsub()
            await pubsub.subscribe(BED_EVENTS_CHANNEL)
            print(f"[REDIS PUB/SUB] Gateway subscribed to channel '{BED_EVENTS_CHANNEL}'")

            async for message in pubsub.listen():
                if message and message.get("type") == "message":
                    event_data = message.get("data")
                    if event_data:
                        await manager.broadcast(event_data)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[REDIS PUB/SUB ERROR] {e}. Reconnecting in 3 seconds...")
            await asyncio.sleep(3)
        finally:
            if pubsub:
                await pubsub.close()
            if redis:
                await redis.aclose()

# --- APPLICATION LIFESPAN ---
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
    swagger_ui_parameters={"persistAuthorization": True},
    lifespan=lifespan
)

# --- CORS CONFIGURATION ---
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer_scheme = APIKeyHeader(name="Authorization", auto_error=False, description="Format: Bearer <JWT_TOKEN>")

# --- 1. IDENTITY & ROLE INJECTION MIDDLEWARE ---
@app.middleware("http")
async def extract_user_context(request: Request, call_next):
    auth_header = request.headers.get("Authorization")
    request.state.user_id = None
    request.state.username = None
    request.state.role = None
    request.state.department = None
    request.state.full_name = None

    if auth_header and auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ")[1]
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            
            # 1. Get user_id and issued timestamp
            user_id = payload.get("sub")
            token_issued_at = payload.get("iat")

            # 2. Check if token was revoked by logout
            if token_issued_at and user_id:
                redis = aioredis.from_url(REDIS_URL, decode_responses=True)
                try:
                    last_logout = await redis.get(f"last_logout:{user_id}")
                    if last_logout and token_issued_at < float(last_logout):
                        return JSONResponse(
                            status_code=401,
                            content={"detail": "Token has been revoked by logout. Please log in again."}
                        )
                finally:
                    await redis.aclose()

            # 3. Save verified user identity
            request.state.user_id = user_id
            request.state.username = payload.get("username")
            request.state.role = payload.get("role")
            request.state.department = payload.get("department")
            request.state.full_name = payload.get("full_name")

        except (jwt.PyJWTError, IndexError): 
            pass

    return await call_next(request)

# --- 2. WEBSOCKET ENDPOINT ---
@app.websocket("/ws/beds")
async def websocket_bed_updates(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        manager.disconnect(websocket)

# --- 3. SERVICES CONFIGURATION ---
SERVICES_CONFIG = {
    "auth": {
        "url": os.getenv("AUTH_SERVICE_URL", "http://hip-auth-service:8001").rstrip("/"),
        "error_msg": "Authentication microservice is down or unreachable.",
        "methods": ["get", "post", "put"],
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
BODY_METHODS = {"post", "put", "patch"}

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

# --- 4. CORE REVERSE PROXY FORWARDER ---
async def forward_request(request: Request, service_name: str, path: str):
    global http_client
    if http_client is None:
        return JSONResponse(status_code=500, content={"detail": "Gateway HTTP Client uninitialized."})

    config = SERVICES_CONFIG[service_name]
    clean_path = path.lstrip("/")

    if config["strip_prefix"]:
        target_url = f"{config['url']}/{clean_path}"
    else:
        target_url = f"{config['url']}/{service_name}/{clean_path}"

    has_body = request.method.lower() in BODY_METHODS
    body = await request.body() if has_body else None

    # Filter incoming hop-by-hop headers
    headers_to_forward = {
        k: v for k, v in request.headers.items() 
        if k.lower() not in HOP_BY_HOP_HEADERS
    }

    # Strip untrusted user headers to prevent spoofing
    for h in ["x-user-id", "x-user-username", "x-user-role", "x-user-department", "x-user-fullname"]:
        headers_to_forward.pop(h, None)

    # Pass client origin IP for audit logging
    if request.client:
        headers_to_forward["X-Forwarded-For"] = request.client.host

    # Inject identity verified by the Gateway
    if request.state.user_id:
        headers_to_forward["X-User-Id"] = str(request.state.user_id)
    if request.state.username:
        headers_to_forward["X-User-Username"] = str(request.state.username)
    if request.state.role:
        headers_to_forward["X-User-Role"] = str(request.state.role)
    if request.state.department:
        headers_to_forward["X-User-Department"] = str(request.state.department)
    if request.state.full_name:
        headers_to_forward["X-User-Fullname"] = str(request.state.full_name)

    try:
        response = await http_client.request(
            method=request.method,
            url=target_url,
            headers=headers_to_forward,
            params=list(request.query_params.multi_items()),
            content=body
        )
        
        # Filter outgoing hop-by-hop headers before returning to browser
        response_headers = {
            k: v for k, v in response.headers.items()
            if k.lower() not in HOP_BY_HOP_HEADERS
        }

        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=response_headers
        )
    except httpx.HTTPError as e:
        print(f"[GATEWAY ERROR] Downstream communication failure at {target_url}: {e}")
        return JSONResponse(
            status_code=503,
            content={"detail": config["error_msg"]}
        )

# --- 5. DYNAMIC ROUTE REGISTRATION ---
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