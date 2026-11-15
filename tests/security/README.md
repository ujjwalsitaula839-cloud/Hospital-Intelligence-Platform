# HIPAA technical-safeguard tests

These tests exercise the real gateway, auth, patient and bed service code against the HIPAA Security
Rule technical safeguards (45 CFR §164.312) and a few related requirements. They use synthetic data
only: no real database, Redis, network or PHI is touched. Each service is loaded in isolation and its
routes are called through FastAPI's `TestClient` with in-memory database and Redis stand-ins.

Passing these checks does not by itself establish HIPAA compliance (see "Not covered" below).

## Run the backend checks (Docker, nothing installed on your machine)

From the repository root, in PowerShell:

```powershell
docker run --rm -v "${PWD}:/repo:ro" -v hip-security-pip-cache:/root/.cache/pip -w /repo -e PYTHONDONTWRITEBYTECODE=1 python:3.11-slim sh -c "pip install -q --disable-pip-version-check --root-user-action=ignore -r tests/security/requirements.txt && python tests/security/hipaa_runner.py"
```

Add `--json` after `hipaa_runner.py` for machine-readable output.

## Run the browser-side checks

The browser-storage and session-token checks are Vitest tests in
`frontend/src/test/HipaaBrowserSafeguards.test.tsx`:

```powershell
cd frontend
npm ci
npx vitest run src/test/HipaaBrowserSafeguards.test.tsx
```

## One report for everything

`run_checks.py` runs the HIPAA backend checks (in the container above) and the whole frontend Vitest
suite, including the jest-axe accessibility tests, and writes one HTML report with three sections:
HIPAA safeguards, Accessibility, and Other frontend tests. Docker Desktop must be running and `npm ci`
must have been run in `frontend/`. From the repository root:

```powershell
python tests/security/run_checks.py
```

The report is written to `tests/security/results/test-report.html` (git-ignored). Use `--skip-backend`
or `--skip-frontend` to run one half. The exit code is 0 when nothing failed; known gaps are expected.

## Reading the results

| Status | Meaning |
|---|---|
| PASS | The safeguard behaves as required. |
| KNOWN GAP | A gap that exists on `main` today. The test describes the required behaviour and is expected to fail until the code is fixed, so the suite stays green while the gap stays visible. |
| GAP CLOSED | A known-gap test now passes: remove its `@known_gap` marker (or `it.fails`) so it becomes a regular check. |
| FAIL / ERROR | A regression, or a broken check. A known-gap test that crashes instead of failing its assertion is reported as ERROR. |

Every backend test is tagged with `@hipaa(section, safeguard)` and, for gaps, `@known_gap(reason)`
in `test_hipaa_safeguards.py`. Browser tests name their section in the `describe` title and use
`it.fails` with a `[known gap]` prefix.

## Not covered by these tests

Risk analysis and risk management, workforce training, business associate agreements (including the
external language-model provider), encryption at rest for the database and backups, contingency and backup plans,
physical safeguards, and review of the audit logs. These need organisational controls and deployment review.
