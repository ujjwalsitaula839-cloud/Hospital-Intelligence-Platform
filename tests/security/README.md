# Security Tests

Run these commands from the repository root in PowerShell.

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
