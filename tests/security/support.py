"""Shared harness for the HIPAA technical-safeguard tests.

- The synthetic environment below is applied once, for the whole run, before any service is imported.
- Each service (gateway, auth, patient, bed) is loaded in isolation: every module that lives in that
  service's folder is cleared from sys.modules before and after loading, so same-named modules
  (security, audit, authz, models, ...) from different services never leak into each other.
- No real database, Redis or network is used. Routes are exercised through FastAPI's TestClient with
  dependency overrides that hand the code an in-memory FakeSession / FakeRedis.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import importlib.util
import os
from pathlib import Path
import sys
import types
from typing import Any, Dict, Iterable, Optional
import unittest

import jwt
from sqlalchemy.orm import declarative_base

ROOT = Path(__file__).resolve().parents[2]
SYNTHETIC_SECRET = "security-regression-only-not-a-deployment-secret"
INTERNAL_SECRET = "synthetic-internal-service-secret-for-tests"

# Environment for the whole run (services read some values at import time and others per request).
RUN_ENV = {
    "ENV": "production",
    "SECRET_KEY": SYNTHETIC_SECRET,
    "INTERNAL_SERVICE_SECRET": INTERNAL_SECRET,
    "DATABASE_URL": "postgresql+asyncpg://synthetic:synthetic@127.0.0.1:1/disabled",
    "REDIS_URL": "redis://127.0.0.1:1/15",
    "BOLA_POLICY_MODE": "enforce",
    "GEMINI_API_KEY": "",
}
for _name in ("INITIAL_ADMIN_PASSWORD", "TEST_USER_PASSWORD", "ACCESS_TOKEN_EXPIRE_MINUTES", "REFRESH_TOKEN_EXPIRE_DAYS"):
    os.environ.pop(_name, None)
os.environ.update(RUN_ENV)

SERVICE_DIRS = {
    "gateway": ROOT / "gateway",
    "auth": ROOT / "services" / "auth-service",
    "patient": ROOT / "services" / "patient-service",
    "bed": ROOT / "services" / "bed-service",
}


# ---------------------------------------------------------------------------
# Test metadata: HIPAA Security Rule mapping and known gaps
# ---------------------------------------------------------------------------

def hipaa(section: str, safeguard: str, finding: str = ""):
    """Tag a test with the HIPAA section and safeguard it checks (read by hipaa_runner.py)."""
    def decorate(test):
        test.hipaa_section = section
        test.hipaa_safeguard = safeguard
        test.finding = finding
        return test
    return decorate


def known_gap(reason: str):
    """Mark a test for a gap that exists on main: it is expected to fail until the code is fixed."""
    def decorate(test):
        test = unittest.expectedFailure(test)
        test.known_gap = reason
        return test
    return decorate


# ---------------------------------------------------------------------------
# Isolated service loading
# ---------------------------------------------------------------------------

def _local_module_names(directory: Path) -> set:
    names = {"database"}
    for entry in directory.iterdir():
        if entry.suffix == ".py":
            names.add(entry.stem)
        elif entry.is_dir() and (entry / "__init__.py").exists():
            names.add(entry.name)
    return names


def _purge(names: set) -> None:
    for loaded in list(sys.modules):
        if loaded.split(".")[0] in names:
            del sys.modules[loaded]


def make_database_stub(session_factory=None) -> types.ModuleType:
    """Stand-in for each service's database.py: no engine, no connection, real declarative Base."""
    stub = types.ModuleType("database")
    stub.Base = declarative_base()

    async def get_db():  # replaced per test through app.dependency_overrides
        raise AssertionError("Database access must go through a FakeSession dependency override")
        yield  # pragma: no cover

    async def init_db(*args, **kwargs):
        return None

    stub.get_db = get_db
    stub.init_db = init_db
    stub.AsyncSessionLocal = session_factory or (lambda: (_ for _ in ()).throw(AssertionError("No real sessions in tests")))
    return stub


_LOADED: Dict[str, types.ModuleType] = {}


def load_service(service: str) -> types.ModuleType:
    """Import a service's main.py in isolation and return it; its own modules are kept on `.siblings`."""
    if service in _LOADED:
        return _LOADED[service]
    directory = SERVICE_DIRS[service]
    local = _local_module_names(directory)
    _purge(local)
    sys.modules["database"] = make_database_stub()
    sys.path.insert(0, str(directory))
    try:
        spec = importlib.util.spec_from_file_location(f"hip_{service}_main", directory / "main.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.siblings = {name: mod for name, mod in sys.modules.items() if name.split(".")[0] in local}
    finally:
        sys.path.remove(str(directory))
        _purge(local)
    _LOADED[service] = module
    return module


# ---------------------------------------------------------------------------
# In-memory database session and Redis
# ---------------------------------------------------------------------------

class FakeResult:
    def __init__(self, items: Iterable[Any] = (), rowcount: Optional[int] = None):
        self._items = list(items)
        self.rowcount = len(self._items) if rowcount is None else rowcount

    def scalars(self):
        return self

    def mappings(self):
        return self

    def first(self):
        return self._items[0] if self._items else None

    def all(self):
        return list(self._items)

    def scalar_one_or_none(self):
        return self.first()


class FakeSession:
    """Mimics AsyncSession transaction semantics: only rows added before commit() are persisted;
    anything still pending when the session closes is discarded, as in a real rollback."""

    def __init__(self, objects: Optional[Dict[tuple, Any]] = None, results: Iterable[FakeResult] = (),
                 flush_error: Optional[Exception] = None):
        self.objects = objects or {}
        self.results = list(results)
        self.flush_error = flush_error
        self.pending: list = []
        self.committed: list = []

    def add(self, obj):
        self.pending.append(obj)

    async def flush(self):
        if self.flush_error:
            raise self.flush_error

    async def commit(self):
        self.committed.extend(self.pending)
        self.pending = []

    async def rollback(self):
        self.pending = []

    async def close(self):
        self.pending = []

    async def refresh(self, obj):
        for key in ("patient_id", "admission_id", "observation_id", "handoff_id", "assignment_id"):
            if hasattr(obj, key) and getattr(obj, key) is None:
                setattr(obj, key, 9001)
        if hasattr(obj, "is_active") and getattr(obj, "is_active") is None:
            obj.is_active = True

    async def get(self, model, key):
        return self.objects.get((model.__name__, key))

    async def execute(self, *args, **kwargs):
        return self.results.pop(0) if self.results else FakeResult()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()
        return False

    def committed_audit_rows(self, action: Optional[str] = None) -> list:
        rows = [row for row in self.committed if type(row).__name__ == "AuditLog"]
        return [row for row in rows if action is None or row.action == action]


class FakeRedis:
    def __init__(self, values: Optional[Dict[str, str]] = None, fail: bool = False):
        self.values = dict(values or {})
        self.fail = fail
        self.set_calls: list = []

    def _check(self):
        if self.fail:
            raise ConnectionError("synthetic Redis outage")

    async def get(self, key):
        self._check()
        return self.values.get(key)

    async def set(self, key, value, ex=None, **kwargs):
        self._check()
        self.values[key] = value
        self.set_calls.append((key, value, ex))
        return True

    async def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)

    async def publish(self, *args):
        return 1

    async def eval(self, *args):
        return [1, 60]

    async def ping(self):
        return True

    async def aclose(self):
        return None


def fake_redis_context(redis: FakeRedis):
    """Replacement for the gateway's _get_redis() async context manager."""
    @asynccontextmanager
    async def _ctx():
        yield redis
    return _ctx


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def client_for(module, session: Optional[FakeSession] = None, redis: Optional[FakeRedis] = None,
               raise_server_exceptions: bool = True):
    """TestClient for a service app with its database/Redis dependencies overridden."""
    from fastapi.testclient import TestClient

    app = module.app
    app.dependency_overrides.clear()
    if session is not None and hasattr(module, "get_db"):
        async def _db():
            try:
                yield session
            finally:
                await session.close()
        app.dependency_overrides[module.get_db] = _db
    if hasattr(module, "get_redis"):
        fake = redis or FakeRedis()

        async def _redis():
            return fake
        app.dependency_overrides[module.get_redis] = _redis
    return TestClient(app, raise_server_exceptions=raise_server_exceptions)


def identity(role: str, user_id: int = 42, with_gateway_secret: bool = True) -> Dict[str, str]:
    """Identity headers exactly as the gateway forwards them to a service."""
    headers = {"X-User-Id": str(user_id), "X-User-Role": role, "X-User-Username": f"user{user_id}"}
    if with_gateway_secret:
        headers["X-Gateway-Secret"] = INTERNAL_SECRET
    return headers


def make_token(sub: str = "5", role: str = "NURSE", minutes: int = 15, must_change_password: bool = False,
               issued_at: Optional[datetime] = None) -> str:
    now = issued_at or datetime.now(timezone.utc)
    claims = {"sub": sub, "role": role, "iat": now.timestamp(), "exp": now + timedelta(minutes=minutes),
              "must_change_password": must_change_password}
    if must_change_password:
        claims["role"] = "RESTRICTED"
    return jwt.encode(claims, SYNTHETIC_SECRET, algorithm="HS256")
