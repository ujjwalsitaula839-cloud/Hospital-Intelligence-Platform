# Hospital Intelligence Platform (HIP)

HIP is a hospital operations system for bed management. Nurses and doctors use it to admit, move and discharge
patients, chart vitals and hand over shifts, and to log incoming ambulances so a bed and equipment are ready before
the patient arrives. Housekeeping staff use it to work through bed cleaning, and administrators use it to manage staff
accounts and the bed inventory. Bed status updates reach every open dashboard in real time.

## Features

- Sign-in by role (admin, doctor, nurse, cleaning crew, pharmacy), a forced password change on first login, and
  self-service password reset by email.
- Admin dashboard: provision staff accounts with a one-time temporary password, deactivate and reactivate accounts,
  and set bed status in the bed registry.
- Clinical dashboard (doctors and nurses): a live bed grid; admit, reserve, transfer and discharge; a patient
  registry; vitals charting kept as an append-only record with explicit corrections; nurse assignments and I-PASS shift
  handoffs; and equipment allocation.
- EMS intake for incoming ambulances, on the clinical dashboard. Staff type in the radio report: ambulance unit,
  estimated arrival time (required), acuity, complaint, any pre-hospital vitals and whatever patient details are known.
  An unidentified patient gets a placeholder identity that staff correct later with Update Identity. Submitting
  creates the patient, an admission and, if vitals were given, a first vitals record. The inbound worklist counts down
  to arrival, raises a notification when less than a minute is left and shows an overdue banner once the time passes.
  Hold Bed asks the bed recommender for a bed and equipment to pre-stage (staff can pick a different bed), reserves the
  bed for the admission and allocates the chosen equipment. When the patient arrives, staff mark the held bed occupied
  from the bed grid; for a diverted ambulance, Cancel Hold deactivates the patient record and removes it from the
  worklist. There is no connection to an external
  EMS or dispatch system: everything is entered by hospital staff, and the countdown runs in the browser that logged
  the call (other workstations show the reported arrival time without counting down).
- Housekeeping dashboard: a cleaning queue that cleaners claim and complete. Finishing a cleaning frees the bed.
- The bed recommender suggests a bed and equipment for an incoming patient using Google Gemini, and falls back to
  rule-based logic when no Gemini key is configured or the call fails.
- The ELON assistant answers questions about capacity, cleaning queues and bed holds from live data. Housekeeping staff
  only get bed and cleaning information. It also uses Gemini, with built-in answers when no key is set.
- The auth, patient and bed services write audit rows for access and changes.

Pharmacy accounts exist in the data model but have no dashboard yet; signing in as pharmacy shows an access-denied page.

## Architecture

Three FastAPI services sit behind a gateway, and nginx sits in front of the gateway. The gateway and services are
reachable only inside the Docker network; on the host, nginx is published, and Postgres and Mailpit are bound to
127.0.0.1 for local tools.

```
Browser
  |  http://localhost:3000  (Vite dev server; proxies /api /auth /patients /beds /ws to nginx)
  v
nginx         :80 / :443, and 127.0.0.1:8080
              TLS when certificates are mounted, per-IP rate limits, request size limits
  v
gateway       :8000
              checks the JWT and logout revocation (Redis), applies rate limits,
              strips client-supplied identity headers, forwards X-User-* and X-Gateway-Secret
  |-- /auth/*      -> auth-service     :8001  staff accounts, login, refresh, logout, password reset
  |-- /patients/*  -> patient-service  :8002  patients, admissions, vitals, nurse assignments, handoffs
  |-- /beds/*      -> bed-service      :8003  beds, cleaning, equipment, bed recommender, ELON assistant
  `-- /ws/beds     -> WebSocket that relays bed events published by bed-service through Redis

PostgreSQL 15 (one database for all services)
Redis 7       (bed grid cache, pub/sub, rate limits, logout revocation)
Mailpit       (local inbox for password-reset email)
```

The services trust the `X-User-*` identity headers only when the request carries the shared `INTERNAL_SERVICE_SECRET`,
which only the gateway adds. Each service creates its tables on startup; Alembic migrations are in `alembic/`.

Stack: Python 3.11, FastAPI, SQLAlchemy 2 (async, asyncpg), PyJWT and redis-py on the backend; React 19, TypeScript,
Vite, Tailwind CSS 4 and Vitest on the frontend; nginx, PostgreSQL, Redis and Docker Compose for the environment.

## Local setup

The steps are the same on Windows, macOS and Linux. Commands are shown for PowerShell where they differ.

### Prerequisites

- Docker with Compose v2: Docker Desktop on Windows and macOS, or Docker Engine plus the Compose plugin on Linux.
- Node.js 22.13 or later, or 24. Vitest and jsdom declare these as their minimum versions.
- Git.
- Python 3, only if you want to run the combined test report.

On Windows, read the line-endings note under "Known setup issues" before you clone.

### Configure the environment

Copy the template and fill in your own values:

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

`.env` is ignored by Git. The keys that matter:

| Key | Why it matters |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Create the database on the first start of the `postgres` container. |
| `DATABASE_URL` | Used by all three services: `postgresql+asyncpg://<user>:<password>@hip-postgres:5432/<db>`. It must match the three keys above. If the password contains `@ : / ? # %`, percent-encode it here, or use only letters and digits. |
| `SECRET_KEY` | Signs and verifies JWTs. The gateway and auth service refuse to start without it. |
| `INTERNAL_SERVICE_SECRET` | Shared secret the gateway adds to every forwarded request. Leave it empty and the services will accept identity headers from any caller, so always set it, and make it different from `SECRET_KEY`. |
| `REDIS_PASSWORD`, `REDIS_URL` | Redis starts with `--requirepass`, so `REDIS_URL` must include the password: `redis://:<password>@hip-redis:6379`. |
| `INITIAL_ADMIN_PASSWORD` | Password for the `admin@hospital.org` account created on first start. If unset, a built-in fallback is used and a password change is forced at first login. Set it. |
| `CORS_ORIGINS` | Must include the frontend origin, `http://localhost:3000` by default. |
| `FRONTEND_URL` | Base URL used in password-reset email links. |
| `GEMINI_API_KEY` | Optional. Without it the bed recommender and the ELON assistant use their built-in fallbacks. |
| `BOLA_POLICY_MODE` | `enforce` (default), `audit_only` or `off`. Keep `enforce`; `off` also stops read auditing. |
| `SMTP_*`, `EMAILS_FROM_EMAIL` | Default to the Mailpit container. |
| `TEST_PG_DSN`, `ALEMBIC_DATABASE_URL` | Only for scripts run on the host; they reach Postgres on `localhost:5431`. |

Secrets can be generated with `python -c "import secrets; print(secrets.token_hex(32))"`.

### Start the backend

```bash
docker compose up -d --build
docker compose ps
```

Check the gateway through nginx:

```bash
curl http://localhost:8080/health      # PowerShell: curl.exe http://localhost:8080/health
```

A healthy stack returns `"status":"healthy"` and `"redis":"connected"`. Mailpit's inbox is at http://localhost:8025.

For development with hot reload and the API docs at http://localhost:8080/docs, add the dev overlay. It also publishes
Redis on port 6379.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Stop the stack with `docker compose down`. Add `-v` only if you want to delete the database and Redis volumes.

### Start the frontend

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. The dev server proxies API and WebSocket calls to nginx on port 8080, so no frontend
`.env` is needed.

### Seed demo data

On first start the services create the admin account, six beds and some equipment. For a realistic demo, load
`seed_relational_data.py`: 21 staff accounts across all roles, 120 beds, 84 patients with admissions, cleaning tasks,
equipment allocations, nurse assignments and vitals.

The script empties all application tables before inserting, so only run it against local data. It runs inside the
auth-service container, which already has its dependencies:

```bash
docker compose cp seed_relational_data.py auth-service:/tmp/seed_relational_data.py
docker compose exec auth-service sh -c 'SEED_DB_DSN=$(printf %s "$DATABASE_URL" | sed "s#+asyncpg##") python /tmp/seed_relational_data.py'
```

The script prints the connection string, including the database password, when it starts.

The demo accounts are listed in `seed_relational_data.py` (the `personnel_records` list). They all share one password,
taken from `INITIAL_STAFF_PASSWORD` if you pass it with `docker compose exec -e INITIAL_STAFF_PASSWORD=...`, otherwise
from the fallback in the script. Seeding replaces the admin account created at startup.

## Known setup issues

### nginx exits on Windows: `10-hip-tls-mode.sh: not found`

Git for Windows usually checks files out with CRLF line endings (`core.autocrlf=true`). The nginx entrypoint script
then starts with `#!/bin/sh\r`, which Linux cannot run, and the `hip-nginx` container exits with code 127. The
repository stores LF endings; only the working copy is affected.

Clone with LF endings:

```bash
git clone -c core.autocrlf=input <repository-url>
```

Or fix an existing clone. Only the shell script needs LF endings; the nginx config files work either way:

```powershell
git config core.autocrlf input
Remove-Item nginx/docker-entrypoint.d/10-hip-tls-mode.sh
git checkout -- nginx/docker-entrypoint.d/10-hip-tls-mode.sh
docker compose up -d --build nginx
```

`git ls-files --eol nginx/docker-entrypoint.d/` should then show `w/lf`.

### Port conflicts

The stack publishes 80, 443 and 127.0.0.1:8080 (nginx), 127.0.0.1:5431 (Postgres), and 127.0.0.1:1025 and :8025
(Mailpit). The dev overlay adds 6379 (Redis), and the frontend uses 3000. Check what is listening first:

```bash
# PowerShell: Get-NetTCPConnection -State Listen -LocalPort 80,443,8080,5431,1025,8025,3000,6379
# macOS / Linux: lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(80|443|8080|5431|1025|8025|3000|6379) '
```

If port 3000 is taken, run the frontend on another port and add that origin to `.env`:

```bash
npm run dev -- --port 3001
```

Then set `CORS_ORIGINS` to include `http://localhost:3001` and `FRONTEND_URL=http://localhost:3001`, and recreate
the gateway and auth service with `docker compose up -d`. For the other ports, stop the conflicting program, or
remap the port in a `docker-compose.override.yml`, which is ignored by Git.

### Redis connection errors

If `/health` reports `"redis":"unavailable"` or sign-in fails with a server error, `REDIS_URL` is probably missing the
password. Fix it in `.env`, then run `docker compose up -d` so the containers pick up the new value; `docker compose
restart` does not re-read `.env`.

### Locked out after failed sign-ins

The auth service allows 5 failed sign-ins per email address in 15 minutes. Wait for the window to pass.

## Testing

### Frontend tests

```bash
cd frontend
npm ci
npm test
npm run lint
```

`npm test` runs the Vitest suite. This covers the pages, dialogs and helpers; jest-axe accessibility scans of the
sign-in pages and main dialogs (`src/test/A11y.test.tsx`); and the browser-side HIPAA checks
(`src/test/HipaaBrowserSafeguards.test.tsx`).

### HIPAA safeguard checks

`tests/security/test_hipaa_safeguards.py` checks the real gateway, auth, patient and bed service code against the
HIPAA Security Rule technical safeguards (45 CFR §164.312) and a few related requirements. Each check is tagged with
the section it covers. The checks use synthetic data and in-memory stand-ins for the database and Redis, and run in a
throwaway Python container, so nothing is installed on your machine. From the repository root, with Docker running:

```bash
docker run --rm -v "${PWD}:/repo:ro" -v hip-security-pip-cache:/root/.cache/pip -w /repo -e PYTHONDONTWRITEBYTECODE=1 python:3.11-slim sh -c "pip install -q --disable-pip-version-check --root-user-action=ignore -r tests/security/requirements.txt && python tests/security/hipaa_runner.py"
```

Use `$(pwd)` instead of `${PWD}` in shells where `${PWD}` is not set.

### One report for everything

```bash
python tests/security/run_checks.py
```

This runs the HIPAA checks in the container and the full frontend suite, then writes
`tests/security/results/test-report.html` with three sections: HIPAA safeguards, Accessibility, and other frontend
tests. Each test has a plain-English description and its result, and HIPAA checks also show their Security Rule
section. It needs Docker running and `npm ci` already done in `frontend/`. Use `--skip-backend` or `--skip-frontend`
to run one half.

A known gap is a check for a weakness that exists in the code today. The test describes the required behaviour and is
expected to fail until the code is fixed. The runner reports it as a known gap rather than a failure, so the suite
stays green while the gap stays visible. When a fix lands, the runner reports "gap closed", and the marker
(`@known_gap` in Python, `it.fails` in Vitest) should be removed so the check becomes a normal regression test. The
command exits with a non-zero code only for real failures, errors or closed gaps.

### Older suites

CI also runs the service unit tests (`gateway/test_gateway_security_unit.py` and the `test_*_unit.py` files under
`services/`) and the live integration scripts in the repository root (`test_*.py`). The integration scripts need the
full stack running and they delete and re-create database rows, so only point them at throwaway data.

### What the tests do not cover

These checks test how the application behaves. They do not make the system HIPAA compliant on their own. Compliance
also depends on a risk analysis, business associate agreements with every vendor that handles PHI (including Google for
the Gemini features), encryption at rest for the database and backups, contingency and backup plans, workforce
training, physical safeguards, real TLS certificates in deployment, and regular review of the audit logs.

## Project structure

```
alembic/                 database migrations
frontend/                React app (Vite)
  src/pages/             sign-in pages and the admin, clinical and housekeeping dashboards
  src/components/        dialogs, notifications, the ELON assistant widget
  src/test/              Vitest suites, including accessibility and browser HIPAA checks
gateway/                 API gateway (FastAPI)
nginx/                   edge proxy config, TLS templates, entrypoint script
services/
  auth-service/          staff accounts, tokens, password reset
  patient-service/       patients, admissions, vitals, nurse assignments, handoffs
  bed-service/           beds, cleaning, equipment, bed recommender, ELON assistant (elon/)
tests/security/          HIPAA safeguard checks and the combined report runner
docker-compose.yml       the full stack; docker-compose.dev.yml adds hot reload
seed_relational_data.py  demo data loader
test_*.py                live integration scripts (destructive, see Testing)
```
