"""Run the HIPAA safeguard tests and report each result with its Security Rule section.

Usage (inside the test container, see README.md):
    python tests/security/hipaa_runner.py          # readable table
    python tests/security/hipaa_runner.py --json   # machine-readable rows for run_checks.py

Statuses: passed, known_gap (expected failure for a gap that exists on main), failed, error,
gap_closed (a known-gap test now passes: remove its @known_gap marker), skipped.
Exit code is non-zero only for failed, error or gap_closed.
"""
import argparse
from contextlib import redirect_stderr
import io
import json
from pathlib import Path
import sys
import unittest
import warnings

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _describe(test):
    method = getattr(test, test._testMethodName)
    doc = (method.__doc__ or "").strip().splitlines()
    return {
        "id": test._testMethodName,
        "group": type(test).__name__,
        "description": doc[0] if doc else test._testMethodName.replace("_", " "),
        "section": getattr(method, "hipaa_section", ""),
        "safeguard": getattr(method, "hipaa_safeguard", ""),
        "finding": getattr(method, "finding", ""),
        "gap": getattr(method, "known_gap", ""),
    }


class RowResult(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.rows = []

    def _add(self, test, status, detail=""):
        self.rows.append({**_describe(test), "status": status, "detail": detail})

    def addSuccess(self, test):
        super().addSuccess(test)
        self._add(test, "passed")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._add(test, "failed", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self._add(test, "error", self._exc_info_to_string(err, test))

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        # A known gap must fail on its assertion; a crash means the check itself is broken.
        if issubclass(err[0], test.failureException):
            self._add(test, "known_gap", self._exc_info_to_string(err, test).strip().splitlines()[-1])
        else:
            self._add(test, "error", "Known-gap test crashed instead of failing its assertion:\n"
                      + self._exc_info_to_string(err, test))

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._add(test, "gap_closed", "This known gap now passes; remove its @known_gap marker.")

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._add(test, "skipped", reason)

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            status = "failed" if issubclass(err[0], test.failureException) else "error"
            self._add(test, status, f"{subtest._subDescription()}: {self._exc_info_to_string(err, test)}")


def run():
    suite = unittest.defaultTestLoader.discover(str(HERE), pattern="test_hipaa_*.py", top_level_dir=str(HERE))
    result = RowResult()
    with warnings.catch_warnings(), redirect_stderr(io.StringIO()):
        warnings.simplefilter("ignore")
        suite.run(result)
    # A test whose subtests failed is reported once, by its failure, not also as passed.
    failed_ids = {r["id"] for r in result.rows if r["status"] in ("failed", "error")}
    return [r for r in result.rows if not (r["status"] == "passed" and r["id"] in failed_ids)]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true", help="print JSON rows instead of a table")
    args = parser.parse_args()
    rows = run()
    if args.json:
        print(json.dumps(rows))
    else:
        labels = {"passed": "PASS", "known_gap": "KNOWN GAP", "failed": "FAIL", "error": "ERROR",
                  "gap_closed": "GAP CLOSED", "skipped": "SKIPPED"}
        for row in sorted(rows, key=lambda r: (r["section"], r["id"])):
            print(f'{labels[row["status"]]:10} | {row["section"]:28} | {row["description"]}')
            if row["status"] in ("failed", "error", "gap_closed"):
                print("    " + row["detail"].strip().replace("\n", "\n    "))
        totals = {label: sum(r["status"] == key for r in rows) for key, label in labels.items()}
        print("\n" + " | ".join(f"{count} {label.lower()}" for label, count in totals.items() if count or label in ("PASS", "KNOWN GAP")))
        print("These checks test application behaviour; they do not by themselves establish HIPAA compliance.")
    return 1 if any(r["status"] in ("failed", "error", "gap_closed") for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
