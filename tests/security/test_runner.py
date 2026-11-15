"""Tests for the HIPAA security test runner and check catalog."""
import unittest
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from hipaa_runner import RowResult, _describe, CATALOG


class MockAssertionFailureTest(unittest.TestCase):
    failureException = AssertionError

    def run_mock_assertion(self):
        """Mock test that fails an assertion."""
        self.assertEqual(1, 2)


class MockCrashTest(unittest.TestCase):
    failureException = AssertionError

    def run_mock_crash(self):
        """Mock test that crashes with runtime error."""
        raise RuntimeError("Unexpected boom")


class RunnerAndCatalogTests(unittest.TestCase):
    def test_catalog_entries_match_test_names(self):
        """Check that catalog contains expected test method keys with finding metadata."""
        expected_keys = [
            "test_forged_identity_headers_are_rejected_by_every_service",
            "test_request_without_identity_is_rejected",
            "test_live_updates_reject_anonymous_connections",
            "test_access_tokens_expire_after_15_minutes",
            "test_refresh_tokens_are_stored_only_as_hashes",
        ]
        for key in expected_keys:
            self.assertIn(key, CATALOG, f"Missing catalog key: {key}")
            entry = CATALOG[key]
            self.assertIsInstance(entry, list)
            self.assertEqual(len(entry), 5)
            self.assertTrue(entry[0].startswith("F"), f"Finding should start with F: {entry[0]}")

    def test_known_gap_assertion_failure_classified_as_known_gap(self):
        """Known gap that fails its assertion must be recorded as known_gap."""
        result = RowResult()
        test = MockAssertionFailureTest("run_mock_assertion")
        try:
            test.run_mock_assertion()
        except Exception:
            err = sys.exc_info()
            result.addExpectedFailure(test, err)

        self.assertEqual(len(result.rows), 1)
        row = result.rows[0]
        self.assertEqual(row["status"], "known_gap")
        self.assertIn("1 != 2", row["detail"])

    def test_known_gap_crash_classified_as_error(self):
        """Known gap that raises unexpected exception must be recorded as error."""
        result = RowResult()
        test = MockCrashTest("run_mock_crash")
        try:
            test.run_mock_crash()
        except Exception:
            err = sys.exc_info()
            result.addExpectedFailure(test, err)

        self.assertEqual(len(result.rows), 1)
        row = result.rows[0]
        self.assertEqual(row["status"], "error")
        self.assertIn("Known-gap test crashed instead of failing its assertion", row["detail"])
        self.assertIn("Unexpected boom", row["detail"])


if __name__ == "__main__":
    unittest.main()
