"""Plain-language console and HTML reporting; does not alter test assertions."""
import argparse
from contextlib import redirect_stderr, redirect_stdout
import html
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
import warnings

HERE = Path(__file__).resolve().parent
CATALOG = json.loads((HERE / "check_catalog.json").read_text(encoding="utf-8"))
LABELS = {"passed": "PASSED", "failed": "NEEDS FIXING", "error": "COULD NOT CHECK", "skipped": "NOT TESTED"}


def entry(name, status, detail="", suffix=""):
    finding, priority, title, meaning, action = CATALOG.get(name, (
        "", "Unrated", name, "This check has no plain-language description yet.",
        "Review the technical details and add a description."))
    return dict(finding=finding, priority=priority, title=title + suffix,
                status=status, meaning=meaning, action=action, detail=detail)


class ReportResult(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.subtests = set()

    def record(self, test, status, detail="", suffix=""):
        self.rows.append(entry(test.id().split(".")[-1], status, detail, suffix))

    def addSuccess(self, test):
        super().addSuccess(test)
        if test.id() not in self.subtests:
            self.record(test, "passed")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.record(test, "failed", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self.record(test, "error", self._exc_info_to_string(err, test))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.record(test, "skipped", reason)

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self.record(test, "failed", self._exc_info_to_string(err, test))

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self.record(test, "error", "An expected-failure marker is stale; review this test.")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        self.subtests.add(test.id())
        friendly = {"auth": "staff accounts", "patient": "patient records", "bed": "beds and equipment",
                    "login": "sign in", "refresh": "renew login", "reset-password": "reset password",
                    "forgot-password": "request password recovery"}
        scope = ", ".join(friendly.get(str(value), str(value)) for value in subtest.params.values())
        status = "passed" if err is None else ("failed" if issubclass(err[0], test.failureException) else "error")
        self.record(test, status, "" if err is None else self._exc_info_to_string(err, subtest), f" ({scope})")


def backend_rows():
    # Discover only the safe security suite, never the legacy root scripts.
    result = ReportResult()
    with warnings.catch_warnings(), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        warnings.simplefilter("ignore", DeprecationWarning)
        unittest.defaultTestLoader.discover(str(HERE), pattern="test_*.py").run(result)
    return result.rows


def browser_rows():
    command = ["node", "--experimental-vm-modules", "--test", "--test-reporter", (HERE / "browser_reporter.mjs").as_uri(), str(HERE / "browser-regressions.test.mjs")]
    try:
        process = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
        events = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
        rows = [entry(e["name"], "skipped" if e.get("skipped") else e["status"], e.get("detail", "")) for e in events]
        if not rows or (process.returncode and all(r["status"] == "passed" for r in rows)):
            raise RuntimeError(process.stderr or "The browser test runner did not return usable results.")
        return rows
    except (OSError, subprocess.TimeoutExpired, ValueError, RuntimeError) as error:
        return [entry("Browser checks could not run", "error", str(error))]


def write_html(rows, destination):
    counts = {status: sum(r["status"] == status for r in rows) for status in LABELS}
    escape = lambda value: html.escape(str(value), quote=True)
    cards = "".join(f'<div class="card {key}"><strong>{value}</strong>{escape(LABELS[key])}</div>' for key, value in counts.items())
    records = []
    for row in rows:
        meaning = "The checked scenario met its expected behavior." if row["status"] == "passed" else (
            "The test could not complete. This is not a confirmed application vulnerability." if row["status"] == "error" else row["meaning"])
        action = "No action for this checked scenario." if row["status"] == "passed" else row["action"]
        detail = f'<details><summary>Technical details</summary><pre>{escape(row["detail"])}</pre></details>' if row["detail"] else ""
        records.append(f'<tr><td><span class="badge {row["status"]}">{escape(LABELS[row["status"]])}</span></td><td><b>{escape(row["title"])}</b><small>{escape(row["finding"])} · {escape(row["priority"])}</small>{detail}</td><td>{escape(meaning)}</td><td>{escape(action)}</td></tr>')
    document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security check results</title><style>
body{font:16px/1.5 system-ui,sans-serif;color:#18283a;background:#f4f7fa;margin:0;padding:32px}main{max-width:1250px;margin:auto}h1{margin-bottom:8px}.cards{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.card{background:white;border:1px solid #ccd5df;border-radius:10px;padding:18px;min-width:150px}.card strong{display:block;font-size:32px}.badge{display:inline-block;padding:5px 9px;border-radius:6px;font-weight:700;font-size:12px}.passed{color:#17623b}.failed{color:#a02b23}.error{color:#925200}.skipped{color:#526274}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:16px;border-bottom:1px solid #dbe2eb;vertical-align:top}th{background:#e7eef5}small{display:block;color:#526274;margin-top:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer;color:#315b80;margin-top:8px}.table-wrap{overflow-x:auto}footer{margin-top:24px;color:#526274}@media(max-width:650px){body{padding:16px}td,th{padding:10px}table{min-width:780px}}
</style><main><h1>Security check results</h1><p>These checks use synthetic data. No production database is accessed.</p>'''
    document += f'<div class="cards">{cards}</div><div class="table-wrap"><table><thead><tr><th>Result</th><th>Check / priority</th><th>What it means</th><th>Next action</th></tr></thead><tbody>{"".join(records)}</tbody></table></div>'
    document += '<footer><b>Not tested here:</b> deployed TLS, backup recovery, vendor agreements, MFA and organizational policies. Passing these selected checks does not establish HIPAA compliance.<br>Priority reflects the audit finding; separate rows may refer to the same finding.</footer></main></html>'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(document, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "results" / "security-report.html")
    args = parser.parse_args()
    rows = backend_rows() + browser_rows()
    rows.sort(key=lambda row: (row["priority"], row["title"]))
    print("SECURITY CHECK RESULTS\n")
    for row in rows:
        print(f'{LABELS[row["status"]]:16} | {row["title"]} | {row["priority"]}')
        if row["status"] == "failed":
            print(f'  Meaning: {row["meaning"]}\n  Next: {row["action"]}')
        elif row["status"] == "error":
            print("  The check could not complete; review technical details in the report.")
    print("\n" + " | ".join(f'{sum(row["status"] == status for row in rows)} {label.lower()}' for status, label in LABELS.items()))
    write_html(rows, args.output)
    print(f"Report: {args.output.resolve()}")
    print("Selected checks only. TLS, backups, agreements and policies need separate review.")
    return 2 if any(r["status"] == "error" for r in rows) else (1 if any(r["status"] in ("failed", "skipped") for r in rows) else 0)


if __name__ == "__main__":
    sys.exit(main())
