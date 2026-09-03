import json
import base64
import asyncio
import os
import httpx
from typing import Any, Dict, Optional, List
from fastapi import FastAPI, Request, Response, Body, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from contextlib import asynccontextmanager
import redis.asyncio as aioredis

REDIS_URL = os.getenv("REDIS_URL", "redis://hip-redis:6379")
BED_EVENTS_CHANNEL = "bed:events"

# --- WEBSOCKET CONNECTION MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[WEBSOCKET] Client connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[WEBSOCKET] Client disconnected. Total active: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        print(f"[WEBSOCKET BROADCAST] Sending event to {len(self.active_connections)} client(s): {message}")
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                print(f"[WEBSOCKET ERROR] Error sending to client: {e}")

manager = ConnectionManager()

# --- REDIS PUB/SUB BACKGROUND LISTENER ---
async def redis_pubsub_listener():
    """Background worker that listens to Redis Pub/Sub events and broadcasts them to WebSockets."""
    while True:
        try:
            redis = aioredis.from_url(REDIS_URL, decode_responses=True)
            pubsub = redis.pubsub()
            await pubsub.subscribe(BED_EVENTS_CHANNEL)
            print(f"[REDIS PUB/SUB] Gateway subscribed to channel '{BED_EVENTS_CHANNEL}'")

            async for message in pubsub.listen():
                if message["type"] == "message":
                    event_data = message["data"]
                    print(f"[REDIS EVENT RECEIVED] {event_data}")
                    # Broadcast live bed status change to connected UI dashboards!
                    await manager.broadcast(event_data)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[REDIS PUB/SUB ERROR] {e}. Reconnecting in 3 seconds...")
            await asyncio.sleep(3)

# --- LIFESPAN MANAGER ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start Redis Pub/Sub background listener task
    listener_task = asyncio.create_task(redis_pubsub_listener())
    yield
    # Shutdown: Clean up background task
    listener_task.cancel()
    try:
        await listener_task
    except asyncio.CancelledError:
        pass

app = FastAPI(
    title="Hospital Intelligence Platform - API Gateway",
    swagger_ui_parameters={"persistAuthorization": True},
    lifespan=lifespan
)

bearer_scheme = APIKeyHeader(name="Authorization", auto_error=False, description="Format: Bearer <JWT_TOKEN>")

# 1. MIDDLEWARE FOR IDENTITY INJECTION
@app.middleware("http")
async def extract_user_context(request: Request, call_next):
    auth_header = request.headers.get("Authorization")
    request.state.user_id = None
    request.state.username = None
    if auth_header and auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ")[1]
            payload_b64 = token.split(".")[1]            
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            payload_bytes = base64.b64decode(payload_b64)
            payload_data = json.loads(payload_bytes)
            
            request.state.user_id = payload_data.get("sub")
            request.state.username = payload_data.get("username")
        except Exception:
            pass

    response = await call_next(request)
    return response

# 2. WEBSOCKET ENDPOINT FOR DASHBOARD REAL-TIME UPDATES
@app.websocket("/ws/beds")
async def websocket_bed_updates(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; wait for client ping/messages if needed
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# 3. SERVICES CONFIGURATION
SERVICES_CONFIG = {
    "auth": {
        "url": os.getenv("AUTH_SERVICE_URL", "http://hip-auth-service:8001"),
        "error_msg": "Authentication microservice is down or unreachable.",
        "methods": ["get", "post"],
        "strip_prefix": True
    },
    "patients": {
        "url": os.getenv("PATIENT_SERVICE_URL", "http://hip-patient-service:8002"),
        "error_msg": "Patient microservice is down or unreachable.",
        "methods": ["get", "post", "delete"],
        "strip_prefix": True
    },
    "beds": {
        "url": os.getenv("BED_SERVICE_URL", "http://hip-bed-service:8003"),
        "error_msg": "Bed management microservice is down or unreachable.",
        "methods": ["get", "put", "post"],
        "strip_prefix": True
    },
    "pharmacy": {
        "url": os.getenv("PHARMACY_SERVICE_URL", "http://pharmacy-service:8004"),
        "error_msg": "Pharmacy microservice is down or unreachable.",
        "methods": ["get", "post"],
        "strip_prefix": False
    }
}
BODY_METHODS = {"post", "put", "patch", "delete"}

# 4. CORE ROUTING ENGINE
async def forward_request(request: Request, service_name: str, path: str):
    config = SERVICES_CONFIG[service_name]

    if config["strip_prefix"]:
        target_url = f"{config['url']}/{path}"
    else:
        target_url = f"{config['url']}/{service_name}/{path}"

    body = await request.body()

    headers_to_forward = dict(request.headers)
    headers_to_forward.pop("host", None)

    if request.state.user_id:
        headers_to_forward["X-User-Id"] = str(request.state.user_id)
    if request.state.username:
        headers_to_forward["X-User-Username"] = str(request.state.username)

    async with httpx.AsyncClient() as client:
        try:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers_to_forward,
                params=dict(request.query_params),
                content=body
            )
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers)
            )
        except httpx.HTTPError:
            return JSONResponse(
                status_code=503,
                content={"detail": config["error_msg"]}
            )

# 5. DRY METAPROGRAMMING FACTORY
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

# 6. DYNAMIC ROUTE REGISTRATION LOOP
for service_name, config in SERVICES_CONFIG.items():
    for method in config["methods"]:
        route_decorator = getattr(app, method)
        route_decorator(
            f"/{service_name}/{{path:path}}",
            summary=f"{service_name.capitalize()} -> {method.upper()}",
            tags=[service_name.capitalize()],
            responses={200: {"content": {"application/json": {}}}}
        )(register_proxy_endpoint(service_name, method))