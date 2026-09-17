import asyncio
import importlib.util
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import pool, MetaData
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from dotenv import load_dotenv

# Load environment variables from .env if present
root_dir = Path(__file__).resolve().parent.parent
load_dotenv(root_dir / ".env")

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set sqlalchemy.url from ALEMBIC_DATABASE_URL or DATABASE_URL env var if present
db_url = os.getenv("ALEMBIC_DATABASE_URL") or os.getenv("DATABASE_URL")
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)


def load_module_from_file(module_name: str, file_path: Path):
    spec = importlib.util.spec_from_file_location(module_name, str(file_path))
    mod = importlib.util.module_from_spec(spec)
    # temporarily add directory to sys.path for database imports
    sys.path.insert(0, str(file_path.parent))
    try:
        spec.loader.exec_module(mod)
    finally:
        if str(file_path.parent) in sys.path:
            sys.path.remove(str(file_path.parent))
    return mod


auth_models = load_module_from_file("auth_models", root_dir / "services" / "auth-service" / "models.py")
patient_models = load_module_from_file("patient_models", root_dir / "services" / "patient-service" / "models.py")
bed_models = load_module_from_file("bed_models", root_dir / "services" / "bed-service" / "models.py")

# Merge all tables into a unified metadata target
target_metadata = MetaData()
for base in [auth_models.Base, patient_models.Base, bed_models.Base]:
    for table_name, table in base.metadata.tables.items():
        if table_name not in target_metadata.tables:
            table.tometadata(target_metadata)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode using AsyncEngine."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
