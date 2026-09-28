"""Explicit, transactional PostgreSQL migrations. Never runs on API startup."""
import argparse
import hashlib
import os
from pathlib import Path
import sys

MIGRATIONS = Path(__file__).parent / "migrations"
LOCK_ID = 724190831


def migration_files():
    return sorted(MIGRATIONS.glob("[0-9]*.sql"))


def checksum_for(path):
    # Normalize platform line endings before hashing.
    return hashlib.sha256(path.read_text(encoding="utf-8").encode("utf-8")).hexdigest()


def database_url():
    value = os.environ.get("DATABASE_URL", "")
    if not value:
        raise ValueError("Set DATABASE_URL in the environment; no default credentials are used.")
    return value.replace("postgresql+asyncpg://", "postgresql://", 1)


def run(command, connection):
    # One transaction for all pending migrations, including backfill and version records.
    with connection.transaction():
        connection.execute("SET LOCAL search_path TO public")
        connection.execute("SET LOCAL lock_timeout TO '10s'")
        connection.execute("SET LOCAL statement_timeout TO '120s'")
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_ID,))
        exists = connection.execute("SELECT to_regclass('public.hip_schema_migrations')").fetchone()[0]
        applied = dict(connection.execute("SELECT version, checksum FROM hip_schema_migrations").fetchall()) if exists else {}
        files = migration_files()
        if set(applied) - {p.name for p in files}:
            raise ValueError("Database contains unknown migrations; use the matching source revision.")
        for path in files:
            checksum = checksum_for(path)
            if path.name in applied and applied[path.name] != checksum:
                raise ValueError(f"Applied migration changed: {path.name}. Restore it; add a new migration instead.")
        if command == "status":
            for path in files:
                print(f"{'APPLIED' if path.name in applied else 'PENDING'} {path.name}")
            return
        connection.execute("""CREATE TABLE IF NOT EXISTS hip_schema_migrations (
            version TEXT PRIMARY KEY, checksum TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        for path in files:
            if path.name in applied:
                continue
            connection.execute(path.read_text(encoding="utf-8"))
            connection.execute("INSERT INTO hip_schema_migrations (version, checksum) VALUES (%s, %s)",
                               (path.name, checksum_for(path)))
            print(f"Validated {path.name}")
        if command == "check":
            # The caller rolls back the outer connection transaction.
            print("Schema and backfill validated; changes will be rolled back.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["status", "check", "upgrade"])
    args = parser.parse_args()
    try:
        import psycopg
        with psycopg.connect(database_url(), autocommit=False, connect_timeout=10) as conn:
            # Start the outer transaction so run() uses a savepoint.
            conn.execute("SELECT 1")
            run(args.command, conn)
            if args.command != "upgrade":
                conn.rollback()
            else:
                conn.commit()
                print("Migration committed successfully.")
    except Exception as exc:
        # Exception text from drivers can contain credentials or patient values.
        if isinstance(exc, ValueError):
            print(str(exc), file=sys.stderr)
        else:
            code = getattr(exc, "sqlstate", None)
            print(f"Migration failed ({type(exc).__name__}, SQLSTATE {code or 'unavailable'}). No pending migrations committed.", file=sys.stderr)
            if code == "P0001":
                print("Legacy-data preflight failed. Use the read-only preflight queries documented in database/README.md.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
