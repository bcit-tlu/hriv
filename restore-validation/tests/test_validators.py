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
from fixtures import ROLE_ATTRS, policy, policy_document, profile

EMPTY_SOURCE_STATE = {"missing_sources": [], "orphan_sources": []}


def policy_for(state):
    digest = hashlib.sha256(json.dumps(state, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return SourcePolicy.parse(json.dumps(policy_document(len(state["missing_sources"]), len(state["orphan_sources"]), digest)))


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
    cluster = [{"system_identifier": "777777"}, {"in_recovery": False, "timeline": 8}, [dict(item) for item in p.required_database_inventory], [{"name": "app", "attributes": ROLE_ATTRS, "memberships": []}, {"name": "v-dynamic", "attributes": ROLE_ATTRS, "memberships": []}], {"reached": True, "current_lsn": "A/1234"}]
    app = [{"version_num": "abc123"}, {"count": 1}, {"count": 1}, {"count": 2}, {"count": 1}, {"count": 2}, [{"id": "1", "email": "synthetic@example.invalid"}], [{"generation": 9, "fenced_at": datetime(2026, 1, 15, 9, 0, 30, tzinfo=timezone.utc)}]]
    for key, value in change.items():
        if key == "identity": cluster[0] = {"system_identifier": value}
        if key == "recovery": cluster[1] = value
        if key == "recovery_sequence": cluster[1:2] = value
        if key == "fence": app[-1] = value if isinstance(value, list) else [value]
        if key == "databases": cluster[2] = value
        if key == "roles": cluster[3] = value
        if key == "row_counts":
            for index, count in enumerate(value, start=1): app[index] = {"count": count}
        if key == "synthetic": app[-2] = value
    connections = [Connection(cluster), Connection(app)]
    return lambda **kwargs: connections.pop(0)


class ValidatorTests(unittest.TestCase):
    def test_database_success(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root); result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory())
        self.assertTrue(result["success"]); self.assertEqual("hriv", profile().application_database)
        self.assertEqual(8, result["timeline"]); self.assertEqual(7, result["target_tli"])

    def test_database_wrong_system(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(identity="1"))

    def test_database_recovery_not_complete(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(recovery={"in_recovery": True, "timeline": 7}))

    def test_database_requires_promoted_target_timeline(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(recovery={"in_recovery": False, "timeline": 7}))

    def test_database_fence_exact(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(fence={"generation": 0, "fenced_at": datetime(2026, 1, 15, 9, 0, 30, tzinfo=timezone.utc)}))

    def test_database_fence_uses_backup_second_precision(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            fence = {"generation": 9, "fenced_at": datetime(2026, 1, 15, 9, 1, 0, 999999, tzinfo=timezone.utc)}
            result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(fence=fence))
        self.assertEqual("2026-01-15T09:01:00.999999Z", result["fence_fenced_at"])

    def test_database_fence_fractional_commit_uses_exact_precision(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            fence = {"generation": 9, "fenced_at": datetime(2026, 1, 15, 9, 1, 0, 900000, tzinfo=timezone.utc)}
            with self.assertRaises(ValidationError):
                validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00.100000Z", "A/1234", 7, 2, root, connect=database_factory(fence=fence))

    def test_database_fence_outside_bound_window(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            fence = {"generation": 9, "fenced_at": datetime(2026, 1, 15, 8, 59, 59, tzinfo=timezone.utc)}
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(fence=fence))

    def test_database_inventory_excludes_nonconnectable(self):
        import inspect
        source = inspect.getsource(validate_database)
        self.assertIn("WHERE d.datallowconn ORDER BY d.datname", source)
        self.assertNotIn("datistemplate", source)

    def test_database_recovery_pending_retries_without_mutation(self):
        sleeps = []
        sequence = [{"in_recovery": True, "timeline": 6}, {"in_recovery": False, "timeline": 8}]
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(recovery_sequence=sequence), sleeper=sleeps.append)
        self.assertTrue(result["recovery_complete"]); self.assertEqual([5.0], sleeps)

    def test_database_requires_exactly_one_fence_row(self):
        fence = {"generation": 9, "fenced_at": datetime(2026, 1, 15, 9, 0, 30, tzinfo=timezone.utc)}
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError):
                validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(fence=[fence, fence]))

    def test_database_rejects_latest(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "latest", 7, 2, root, connect=database_factory())

    def test_dynamic_vault_role_ignored(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root); result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory())
        self.assertEqual(["app"], [item["name"] for item in result["required_static_role_inventory"]])

    def test_database_allows_unrelated_inventory_and_higher_minimum_counts(self):
        p = profile()
        databases = [dict(item) for item in p.required_database_inventory] + [{"name": "unrelated", "owner": "app", "allow_connections": True}]
        roles = [{"name": "app", "attributes": ROLE_ATTRS, "memberships": []}, {"name": "static_unrelated", "attributes": ROLE_ATTRS, "memberships": []}]
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            result = validate_database(p, "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(databases=databases, roles=roles, row_counts=[5, 6, 7, 8]))
        self.assertEqual({"categories": 5, "images": 6, "source_images": 7, "users": 8}, result["observed_row_counts"])
        self.assertNotIn("unrelated", json.dumps(result["required_database_inventory"]))

    def test_database_hashes_lowercase_email_without_emitting_email(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            result = validate_database(profile(), "db", "2026-01-15T09:00:00Z", "2026-01-15T09:01:00Z", "A/1234", 7, 2, root, connect=database_factory(synthetic=[{"id": "1", "email": "Synthetic@Example.Invalid"}]))
        self.assertEqual(profile().synthetic_row, result["synthetic_row"])
        self.assertNotIn("Synthetic@", json.dumps(result))

    def test_consistency_success(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); (source / "a.jpg").write_bytes(b"123"); (source / "b.jpg").write_bytes(b"1234567")
            creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            connection = Connection([[{"row_id": "1", "stored_path": "a.jpg", "status": "ready"}, {"row_id": "2", "stored_path": "b.jpg", "status": "ready"}]])
            result = validate_consistency(profile(), policy(), EMPTY_SOURCE_STATE, "db", source, creds, connect=lambda **kwargs: connection)
        expected_files = {
            "data/source_images/a.jpg": {"size": 3, "sha256": hashlib.sha256(b"123").hexdigest()},
            "data/source_images/b.jpg": {"size": 7, "sha256": hashlib.sha256(b"1234567").hexdigest()},
        }
        expected_digest = hashlib.sha256(json.dumps(expected_files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(2, result["restored_file_count"]); self.assertEqual(10, result["restored_total_bytes"])
        self.assertEqual(expected_digest, result["source_files_sha256"])

    def test_consistency_digest_uses_utf8_canonical_paths(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); (source / "é.jpg").write_bytes(b"image")
            creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            rows = [[{"row_id": "1", "stored_path": "é.jpg", "status": "ready"}]]
            result = validate_consistency(profile(), policy(), EMPTY_SOURCE_STATE, "db", source, creds, connect=lambda **kwargs: Connection(rows))
        files = {
            "data/source_images/é.jpg": {
                "size": 5,
                "sha256": hashlib.sha256(b"image").hexdigest(),
            }
        }
        expected = hashlib.sha256(
            json.dumps(files, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
        self.assertEqual(expected, result["source_files_sha256"])

    def test_consistency_digest_detects_same_size_mutation(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); path = source / "a.jpg"; path.write_bytes(b"abc")
            creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            rows = lambda: [[{"row_id": "1", "stored_path": "a.jpg", "status": "ready"}]]
            first = validate_consistency(profile(), policy(), EMPTY_SOURCE_STATE, "db", source, creds, connect=lambda **kwargs: Connection(rows()))
            path.write_bytes(b"xyz")
            second = validate_consistency(profile(), policy(), EMPTY_SOURCE_STATE, "db", source, creds, connect=lambda **kwargs: Connection(rows()))
        self.assertEqual(first["restored_total_bytes"], second["restored_total_bytes"])
        self.assertNotEqual(first["source_files_sha256"], second["source_files_sha256"])

    def test_consistency_missing_order_is_numeric_row_id(self):
        missing = [{"row_id": "2", "status": "ready", "stored_path": "data/source_images/z.jpg", "reason": "missing_source"}, {"row_id": "10", "status": "ready", "stored_path": "data/source_images/a.jpg", "reason": "missing_source"}]
        state = {"missing_sources": missing, "orphan_sources": []}
        source_policy = policy_for(state)
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            connection = Connection([[{"row_id": "10", "stored_path": "a.jpg", "status": "ready"}, {"row_id": "2", "stored_path": "z.jpg", "status": "ready"}]])
            result = validate_consistency(profile(), source_policy, state, "db", source, creds, connect=lambda **kwargs: connection)
        self.assertEqual(2, result["missing_count"])
        self.assertNotIn("missing_sources", result)

    def test_consistency_preserves_policy_reasons_and_row_order(self):
        missing = [
            {"row_id": "10", "status": "unsafe", "stored_path": "data/source_images/a.jpg", "reason": "unsafe_or_out_of_root"},
            {"row_id": "2", "status": "duplicate", "stored_path": "data/source_images/z.jpg", "reason": "duplicate_source_reference"},
        ]
        canonical = sorted(missing, key=lambda item: (int(item["row_id"]), item["status"], item["stored_path"], item["reason"]))
        state = {"missing_sources": canonical, "orphan_sources": []}
        source_policy = policy_for(state)
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            rows = [{"row_id": "10", "stored_path": "a.jpg", "status": "unsafe"}, {"row_id": "2", "stored_path": "z.jpg", "status": "duplicate"}]
            result = validate_consistency(profile(), source_policy, state, "db", source, creds, connect=lambda **kwargs: Connection([rows]))
        self.assertEqual(2, result["missing_count"])
        self.assertNotIn("missing_sources", result)

    def test_consistency_preserves_inactive_source_rows(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); (source / "a.jpg").write_bytes(b"x"); creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            connection = Connection([[{"row_id": "1", "stored_path": "a.jpg", "status": "inactive"}]])
            result = validate_consistency(profile(), policy(), EMPTY_SOURCE_STATE, "db", source, creds, connect=lambda **kwargs: connection)
        self.assertEqual(1, result["database_source_count"])

    def test_consistency_rejects_recomputed_drift_and_unexpected_orphans(self):
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir(); (source / "orphan.jpg").write_bytes(b"x")
            creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            connection = Connection([[{"row_id": "1", "stored_path": "missing.jpg", "status": "ready"}]])
            with self.assertRaisesRegex(ValidationError, "SOURCE_POLICY_MISMATCH"):
                validate_consistency(profile(), policy(), EMPTY_SOURCE_STATE, "db", source, creds, connect=lambda **kwargs: connection)

    def test_consistency_maximum_long_missing_state_stays_below_32k(self):
        missing = [
            {"row_id": str(index), "status": "s" * 512, "stored_path": f"data/source_images/{index}-" + "x" * 470, "reason": "missing_source"}
            for index in range(1, 257)
        ]
        state = {"missing_sources": missing, "orphan_sources": []}
        source_policy = policy_for(state)
        rows = [{"row_id": item["row_id"], "stored_path": item["stored_path"], "status": item["status"]} for item in missing]
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "source_images"; source.mkdir()
            creds = Path(raw) / "creds"; creds.mkdir(); credentials(creds)
            result = validate_consistency(profile(), source_policy, state, "db", source, creds, connect=lambda **kwargs: Connection([rows]))
        self.assertEqual(256, result["missing_count"])
        self.assertEqual(0, result["unexpected_orphan_count"])
        self.assertNotIn("missing_sources", result)
        self.assertLess(len(json.dumps(result, separators=(",", ":"), ensure_ascii=False).encode("utf-8")), 32 * 1024)

    def test_consistency_rejects_wrong_root(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); credentials(root)
            with self.assertRaises(ValidationError): validate_consistency(profile(), policy(), EMPTY_SOURCE_STATE, "db", root, root, connect=lambda **kwargs: None)

    def test_canonical_path_rejects_parent(self):
        with self.assertRaises(ValidationError): _canonical_source_path("../x")

    def test_emit_one_json_line(self):
        with patch("builtins.print") as output: emit_result({"schema_version": 1, "success": True})
        self.assertEqual(1, output.call_count); json.loads(output.call_args.args[0])


if __name__ == "__main__": unittest.main()
