# HIP database schema

This implements the proposed 18 application tables plus `hip_schema_migrations`, using versioned PostgreSQL SQL migrations. No patient/staff/agency demo rows are inserted. Four role definitions and the ER department are reference data, not demo accounts.

## What this changes

- 001 creates the three original tables only if they are absent.
- 002 adds the new tables, FK/check constraints, active-assignment uniqueness, indexes, timestamps, and version fields.
- 003 validates old references, copies known user roles into user_roles, and maps existing bed department labels to department IDs. Existing patient IDs, names, room text, user records, password hashes, and bed reservation timestamps remain intact.
- All pending migrations execute in one transaction, protected by an advisory lock and migration checksums. Do not edit a migration after applying it: add another numbered SQL file.

**This is an expansion migration, not the frontend/API cutover.** The old endpoints do not write encounters, assignments, tasks, or alerts. Do not use old and new APIs as simultaneous writers. In particular, the legacy reservation fields are not synchronized with bed_assignments, and later account registrations are not automatically provisioned in user_roles. The existing backend authorization flaws are not repaired by this schema.

## Before applying

1. Back up the target PostgreSQL database and verify a restore on a disposable copy.
2. Stop API writers while checking/applying, or run against the disposable copy first. The migration runner's lock coordinates migrations, not old API requests.
3. Use PostgreSQL 15+ and a database owner/migration role with DDL permissions. The migration targets `public`. Use a direct or session-pooled connection for DDL. Avoid a transaction pooler for the migration run.
4. Set DATABASE_URL in the environment. The runner accepts `postgresql://...` and the existing `postgresql+asyncpg://...`; it never reads or prints secret files. For local PostgreSQL from the host use port 5433; from Docker use hostname hip-postgres and port 5432. Do not reuse the placeholder external URL in .env.example.

## Run with Python (from repository root)

```powershell
python -m pip install -r database/requirements.txt
python database/migrate.py status
python database/migrate.py check
python database/migrate.py upgrade
python database/migrate.py status
```

`status` reads the version ledger without creating schema objects. `check` executes the pending migration SQL and backfill, then rolls it back; it takes DDL locks and is best run on the disposable copy. PostgreSQL sequences may advance even in rolled-back transactions, so `check` is not a read-only operation. `upgrade` commits. A failure rolls back the entire pending batch. Credentials and database exception details are suppressed to avoid exposing sensitive values.

If preflight fails, run `database/preflight.sql` using your database client on an existing three-table installation. It returns issue counts, not patient details. Resolve issues deliberately and retry; do not delete rows to bypass constraints.

## Optional Docker runner

```powershell
docker compose --profile migrations build db-migrate
docker compose --profile migrations run --rm db-migrate status
docker compose --profile migrations run --rm db-migrate check
docker compose --profile migrations run --rm db-migrate upgrade
```

This opt-in service gets DATABASE_URL from your existing Compose environment. It does not start the database; start the intended PostgreSQL instance first. Normal `docker compose up` does not run migrations. A host .env file is read by Compose, but not by the standalone Python command.

## Important transition decisions

- `patient_records.room`, `diagnosis`, `assigned_user_id`, `users.role`, and legacy bed fields remain. Retire them only after the new APIs and data import are complete.
- `bed_registry.department_id` is temporarily nullable because old bed creation sends a department string. Existing beds are backfilled; require the FK in the later cutover.
- No encounter status, arrival timestamp, nursing assignment, agency membership, or clinical history is inferred from old rows. Before importing existing patient records, review journey state, creator mapping, and department. Original naive reservation timestamps need an explicitly chosen source timezone before conversion.
- New encounter codes should be supplied by the service using a UUID-derived or sequence-based scheme. Do not use the current eight-character patient UUID truncation for new IDs.
- Full name falls back to username for legacy account registration. New code should supply the actual display name and provision roles explicitly.
- `version` is not auto-incremented by a trigger: APIs must use `WHERE id = ... AND version = expected`, increment in the same statement, and return 409 on no match.
- Services must atomically update bed status plus assignments; these tables do not imply cross-service transactions. Coordinate ownership in bed-service.
- Role checks, state-transition rules, scoped API reads, immutable event behavior, outbox delivery, alert generation, and automatic retention deletion require application code. FK constraints alone do not provide them.
- On closure the future service sets `purge_after = closed_at + interval '6 months'`. There is deliberately no automatic deletion job yet. All FKs restrict deletion; a reviewed purge must remove dependent rows in order and retain identities with other retained encounters. User/department/bed definitions are deactivated, not purged with encounters.
- A separate active-session table may be needed if the login implementation chooses server-managed sessions.

## Validate on a disposable PostgreSQL database

```powershell
python -m pip install -r database/requirements-dev.txt
python -m unittest discover -s database/tests -v
```

Unit tests validate the runner without a database. Integration tests require HIP_TEST_DATABASE_URL to point to a disposable, empty database. They create tables inside transactions that roll back and refuse a nonempty public schema. Never point this variable at your working or production database.

## Next implementation step

Add authenticated encounter/intake APIs using these tables, then replace the frontend's in-memory data with API requests. Expand SQLAlchemy models/service contracts during that cutover. This migration does not change the mentor demo or publish anything.
