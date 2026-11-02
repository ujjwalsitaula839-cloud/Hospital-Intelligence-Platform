"""Load real service code with database/network startup disabled.

Never read .env, create an engine, or enter application lifespan in these tests.
"""
import importlib.util
import os
from pathlib import Path
import sys
import types
from unittest.mock import patch

from sqlalchemy.orm import declarative_base

ROOT = Path(__file__).resolve().parents[2]
SYNTHETIC_SECRET = "security-regression-only-not-a-deployment-secret"


def load_app(service):
    directory = ROOT / ("gateway" if service == "gateway" else f"services/{service}-service")
    database = types.ModuleType("database")
    database.Base = declarative_base()

    async def forbidden_db():
        raise AssertionError("Unexpected database access: supply a synthetic dependency override")
        yield  # dependency shape, intentionally unreachable

    async def forbidden_startup(*args, **kwargs):
        raise AssertionError("Security tests must never run database startup")

    database.get_db = forbidden_db
    database.init_db = forbidden_startup
    database.AsyncSessionLocal = forbidden_startup
    names = ("database", "models", "security", "audit", "schemas", "redis_client", "email_utils", "core", "core.config")
    saved = {name: sys.modules.get(name) for name in names}
    for name in names:
        sys.modules.pop(name, None)
    sys.modules["database"] = database
    environment = {
        "ENV": "production", "SECRET_KEY": SYNTHETIC_SECRET,
        "INTERNAL_SERVICE_SECRET": SYNTHETIC_SECRET,
        "DATABASE_URL": "disabled://security-tests",
        "REDIS_URL": "redis://127.0.0.1:1/15",
    }
    try:
        with patch.dict(os.environ, environment):
            sys.path.insert(0, str(directory))
            spec = importlib.util.spec_from_file_location(f"security_test_{service}", directory / "main.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module._test_security = sys.modules.get("security")
            return module
    finally:
        sys.path.remove(str(directory))
        for name in names:
            sys.modules.pop(name, None)
            if saved[name] is not None:
                sys.modules[name] = saved[name]


def complete(coroutine):
    """Drive only immediately completing mocked I/O; reject accidental real I/O."""
    try:
        yielded = coroutine.send(None)
    except StopIteration as done:
        return done.value
    finally:
        coroutine.close()
    raise AssertionError(f"Unexpected asynchronous I/O: {type(yielded).__name__}")
