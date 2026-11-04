# Security Tests

Run these commands from the repository root in PowerShell.

## Easy-to-read results

After installing the dependencies below, run both sets of checks together:

```powershell
.\.venv-security-tests\Scripts\python.exe tests/security/run_checks.py
```

This prints plain-language results and creates `tests/security/results/security-report.html`.
Open that file in a browser to see the summary, priorities, explanations and next
actions. Expand **Technical details** only when needed.

- **PASSED:** the checked scenario met its expectation.
- **NEEDS FIXING:** the security expectation was not met.
- **COULD NOT CHECK:** a test or its environment failed; this is not a confirmed vulnerability.
- **NOT TESTED:** a check was skipped.

Separate service/path scenarios appear as separate rows; row totals are not counts
of unique vulnerabilities. The assertions and application behavior are unchanged.
The command returns a nonzero exit code for failures, errors or skipped checks.
Passing these selected checks does not establish HIPAA compliance.

## Backend tests

Create a virtual environment and install the test dependencies:

```powershell
python -m venv .venv-security-tests
.\.venv-security-tests\Scripts\python.exe -m pip install -r tests/security/requirements.txt
```

Run the backend tests:

```powershell
.\.venv-security-tests\Scripts\python.exe -m unittest discover -s tests/security -p "test_*.py" -v
```

## Browser tests

Run the browser regression tests with Node.js:

```powershell
node --experimental-vm-modules --test tests/security/browser-regressions.test.mjs
```

Run the tests from `tests/security` only. Do not use repository-wide test discovery.
