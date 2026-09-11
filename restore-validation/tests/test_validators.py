from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from hriv_restore_validation.models import SourcePolicy
from hriv_restore_validation.strict import ValidationError
from hriv_restore_validation.validators import _canonical_source_path, emit_result, validate_consistency, validate_database
from fixtures import ROLE_ATTRS, policy, profile


class Cursor:
    def __init__(self, responses): self.responses = responses
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def execute(self, query, params=()): self.response = self.responses.pop(0)
    def fetchone(self): return self.response
    def fetchall(self): return self.response


class Connection:
    def __init__(self, responses): self.responses = responses
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def cursor(self): return Cursor(self.responses)


def credentials(root: Path):
    (root / "username").write_text("postgres"); (root / "password").write_text("secret")


def database_factory(**change):
    p = profile()
    cluster = [{"system_identifier": "777777"}, {"in_recovery": False, "timeline": 7}, [dict(item) for item in p.expected_database_inventory], [{"name": "app", "attributes": ROLE_ATTRS, "memberships": []}, {"name": "v-dynamic", "attributes": ROLE_ATTRS, "memberships": []}], {"reached": True, "current_lsn": "A/1234"}]
    app = [{"version_num": "abc123"}, {"count": 1}, {"count": 1}, {"count": 2}, {"count": 1}, {"count": 2}, [{"id": "1", "email": "synthetic@example.invalid"}], [{"generation": 9, "fenced_at": datetime(2026, 1, 15, 9, 0, 30, tzinfo=timezone.utc)}]]
    for key, value in change.items():
        if key == "identity": cluster[0] = {"system_identifier": value}
        if key == "recovery": cluster[1] = value
        if key == "recovery_sequence": cluster[1:2] = value
        if key == "fence": app[-1] = value if isinstance(value, list) else [value]
    connections = [Connection(cluster), Connection(app)]
    return lambda **kwargs: connections.pop(0)


class ValidatorTests(unittest.TestCase):
    def test_database_success(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root); result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory())
        self.assertTrue(result["success"]); self.assertEqual("hriv", profile().application_database)

    def test_database_wrong_system(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory(identity="1"))

    def test_database_recovery_not_complete(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory(recovery={"in_recovery": True, "timeline": 7}))

    def test_database_fence_exact(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory(fence={"generation": 0, "fenced_at": datetime(2026, 1, 15, 9, 0, 30, tzinfo=timezone.utc)}))

    def test_database_fence_uses_backup_second_precision(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            fence = {"generation": 9, "fenced_at": datetime(2026, 1, 15, 9, 1, 0, 999999, tzinfo=timezone.utc)}
            result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory(fence=fence))
        self.assertEqual("2026-01-15T09:01:00Z", result["fence_fenced_at"])

    def test_database_fence_outside_bound_window(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            fence = {"generation": 9, "fenced_at": datetime(2026, 1, 15, 8, 59, 59, tzinfo=timezone.utc)}
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory(fence=fence))

    def test_database_inventory_excludes_nonconnectable(self):
        import inspect
        source = inspect.getsource(validate_database)
        self.assertIn("WHERE d.datallowconn ORDER BY d.datname", source)
        self.assertNotIn("datistemplate", source)

    def test_database_recovery_pending_retries_without_mutation(self):
        sleeps = []
        sequence = [{"in_recovery": True, "timeline": 6}, {"in_recovery": False, "timeline": 7}]
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory(recovery_sequence=sequence), sleeper=sleeps.append)
        self.assertTrue(result["recovery_complete"]); self.assertEqual([5.0], sleeps)

    def test_database_requires_exactly_one_fence_row(self):
        fence = {"generation": 9, "fenced_at": datetime(2026, 1, 15, 9, 0, 30, tzinfo=timezone.utc)}
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError):
                validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory(fence=[fence, fence]))

    def test_database_rejects_latest(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "latest", 7, root, connect=database_factory())

    def test_dynamic_vault_role_ignored(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root); result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, root, connect=database_factory())
        self.assertEqual(["app"], [item["name"] for item in result["static_role_inventory"]])

    def test_consistency_success(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); (source / "a.jpg").write_bytes(b"123"); (source / "b.jpg").write_bytes(b"1234567")
            creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            connection = Connection([[{"row_id": "1", "stored_path": "a.jpg", "status": "ready"}, {"row_id": "2", "stored_path": "b.jpg", "status": "ready"}]])
            result = validate_consistency(profile(), policy(), "db", source, creds, connect=lambda **kwargs: connection)
        self.assertEqual(2, result["restored_file_count"]); self.assertEqual(10, result["restored_total_bytes"])

    def test_consistency_missing_order_is_numeric_row_id(self):
        missing = [{"row_id": "2", "status": "ready", "stored_path": "data/source_images/z.jpg", "reason": "missing_source"}, {"row_id": "10", "status": "ready", "stored_path": "data/source_images/a.jpg", "reason": "missing_source"}]
        state = {"missing_sources": missing, "orphan_sources": []}; digest = hashlib.sha256(json.dumps(state, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        source_policy = SourcePolicy.parse(json.dumps({"schema_version": 1, "policy_version": 1, "source_state": state, "sha256": digest}))
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            connection = Connection([[{"row_id": "10", "stored_path": "a.jpg", "status": "ready"}, {"row_id": "2", "stored_path": "z.jpg", "status": "ready"}]])
            result = validate_consistency(profile(), source_policy, "db", source, creds, connect=lambda **kwargs: connection)
        self.assertEqual(["2", "10"], [item["row_id"] for item in result["missing_sources"]])

    def test_consistency_preserves_policy_reasons_and_row_order(self):
        missing = [
            {"row_id": "10", "status": "unsafe", "stored_path": "data/source_images/a.jpg", "reason": "unsafe_or_out_of_root"},
            {"row_id": "2", "status": "duplicate", "stored_path": "data/source_images/z.jpg", "reason": "duplicate_source_reference"},
        ]
        canonical = sorted(missing, key=lambda item: (int(item["row_id"]), item["status"], item["stored_path"], item["reason"]))
        state = {"missing_sources": canonical, "orphan_sources": []}
        digest = hashlib.sha256(json.dumps(state, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        source_policy = SourcePolicy.parse(json.dumps({"schema_version": 1, "policy_version": 1, "source_state": {"missing_sources": missing, "orphan_sources": []}, "sha256": digest}))
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            rows = [{"row_id": "10", "stored_path": "a.jpg", "status": "unsafe"}, {"row_id": "2", "stored_path": "z.jpg", "status": "duplicate"}]
            result = validate_consistency(profile(), source_policy, "db", source, creds, connect=lambda **kwargs: Connection([rows]))
        self.assertEqual(["duplicate_source_reference", "unsafe_or_out_of_root"], [item["reason"] for item in result["missing_sources"]])
        self.assertEqual(["2", "10"], [item["row_id"] for item in result["missing_sources"]])

    def test_consistency_preserves_inactive_source_rows(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); (source / "a.jpg").write_bytes(b"x"); creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            connection = Connection([[{"row_id": "1", "stored_path": "a.jpg", "status": "inactive"}]])
            result = validate_consistency(profile(), policy(), "db", source, creds, connect=lambda **kwargs: connection)
        self.assertEqual(1, result["database_source_count"])

    def test_consistency_policy_mismatch(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            connection = Connection([[{"row_id": "1", "stored_path": "missing.jpg", "status": "ready"}]])
            with self.assertRaises(ValidationError): validate_consistency(profile(), policy(), "db", source, creds, connect=lambda **kwargs: connection)

    def test_consistency_rejects_wrong_root(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_consistency(profile(), policy(), "db", root, root, connect=lambda **kwargs: None)

    def test_canonical_path_rejects_parent(self):
        with self.assertRaises(ValidationError): _canonical_source_path("../x")

    def test_emit_one_json_line(self):
        with patch("builtins.print") as output: emit_result({"schema_version": 1, "success": True})
        self.assertEqual(1, output.call_count); json.loads(output.call_args.args[0])


if __name__ == "__main__": unittest.main()
