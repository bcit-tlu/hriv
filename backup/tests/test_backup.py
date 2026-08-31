"""Unit tests for the HRIV backup service."""

import contextlib
import copy
import io
import importlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backup  # noqa: E402


class _BackupTestCase(unittest.TestCase):
    """Base test case that isolates os.environ and reloads the backup module."""

    _ENV_KEYS = (
        "BACKUP_MODE",
        "BACKUP_CRON_SCHEDULE",
        "BACKUP_RETENTION_COUNT",
        "AZURE_STORAGE_CONNECTION_STRING",
        "AZURE_STORAGE_CONTAINER",
        "AZURE_BLOB_PREFIX",
        "BACKUP_STALE_HOURS",
        "DATABASE_URL",
        "DATA_DIR",
        "RESTORE_TEST_DATABASE_URL",
        "RESTORE_TEST_DATA_DIR",
    )

    def setUp(self):
        self._saved_env = {key: os.environ.get(key) for key in self._ENV_KEYS}

    def tearDown(self):
        # Restore env and reload the module to a consistent, valid state.
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        importlib.reload(backup)

    def _reload(self, env):
        for key in self._ENV_KEYS:
            os.environ.pop(key, None)
        for key, value in env.items():
            os.environ[key] = value
        importlib.reload(backup)


class BackupModeTestCase(_BackupTestCase):
    """Tests for BACKUP_MODE handling."""

    def test_default_mode_is_development(self):
        self._reload({})
        self.assertEqual(backup.BACKUP_MODE, "development")
        self.assertFalse(backup._exclude_tiles())

    def test_production_mode_excludes_tiles(self):
        self._reload({"BACKUP_MODE": "production"})
        self.assertEqual(backup.BACKUP_MODE, "production")
        self.assertTrue(backup._exclude_tiles())

    def test_invalid_mode_exits(self):
        with self.assertRaises(SystemExit):
            self._reload({"BACKUP_MODE": "invalid"})


class LoggingSetupTestCase(_BackupTestCase):
    """Tests for resilient root logging configuration."""

    def test_setup_logging_preserves_otel_and_replaces_other_handlers(self):
        root = logging.getLogger()
        original_handlers = root.handlers[:]
        original_level = root.level

        class FakeOTELHandler(logging.Handler):
            pass

        FakeOTELHandler.__module__ = "opentelemetry.sdk._logs"
        otel_handler = FakeOTELHandler()
        other_handler = logging.StreamHandler(io.StringIO())

        try:
            for handler in root.handlers[:]:
                root.removeHandler(handler)
            root.addHandler(otel_handler)
            root.addHandler(other_handler)

            backup.setup_logging()

            self.assertIn(otel_handler, root.handlers)
            self.assertNotIn(other_handler, root.handlers)
            console_handlers = [
                handler
                for handler in root.handlers
                if isinstance(handler, logging.StreamHandler) and handler is not otel_handler
            ]
            self.assertEqual(len(console_handlers), 1)
            self.assertEqual(console_handlers[0].formatter._fmt, backup.LOG_FORMAT)
            self.assertIs(console_handlers[0].stream, sys.stdout)
            self.assertEqual(root.level, logging.INFO)
        finally:
            for handler in root.handlers[:]:
                root.removeHandler(handler)
            for handler in original_handlers:
                root.addHandler(handler)
            root.setLevel(original_level)


class TarFilterTestCase(unittest.TestCase):
    """Tests for the tar filter that excludes generated tiles."""

    def _make_info(self, name):
        return tarfile.TarInfo(name)

    def test_development_includes_tiles(self):
        f = backup._tar_filter(False, "snap/data/tiles")
        self.assertIsNotNone(f(self._make_info("snap/data/tiles")))
        self.assertIsNotNone(f(self._make_info("snap/data/tiles/0/0.jpg")))

    def test_production_excludes_tiles(self):
        f = backup._tar_filter(True, "snap/data/tiles")
        self.assertIsNone(f(self._make_info("snap/data/tiles")))
        self.assertIsNone(f(self._make_info("snap/data/tiles/0/0.jpg")))
        self.assertIsNotNone(f(self._make_info("snap/data/source_images/img.jpg")))
        self.assertIsNotNone(f(self._make_info("snap/db.sql")))


class RestoreTestCase(_BackupTestCase):
    """Tests for restore behavior in development and production modes."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmp = Path(self._tmpdir.name)
        self.data_dir = self.tmp / "data"
        self.data_dir.mkdir()
        (self.data_dir / "source_images").mkdir()
        (self.data_dir / "source_images" / "existing.jpg").write_bytes(b"existing source")
        (self.data_dir / "tiles").mkdir()
        (self.data_dir / "tiles" / "existing.dzi").write_bytes(b"existing tiles")

    def _build_archive(self, data_subtree, backup_mode="development"):
        snapshot_dir = self.tmp / "snapshot"
        snapshot_dir.mkdir()
        (snapshot_dir / "db.sql").write_text("dump")
        shutil.copytree(data_subtree, snapshot_dir / "data")
        manifest = {
            "snapshot_name": snapshot_dir.name,
            "created_at": "2026-01-01T00:00:00+00:00",
            "backup_mode": backup_mode,
            "tiles_excluded": backup_mode == "production",
            "files": {},
        }
        (snapshot_dir / "manifest.json").write_text(json.dumps(manifest))
        archive_path = self.tmp / "backup.tar.gz"
        with tarfile.open(archive_path, "w:gz") as tar:
            tar.add(snapshot_dir, arcname="snapshot")
        return archive_path

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_development_restore_overwrites_tiles(self, _mock_run):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "archive_data"
        archive_data.mkdir()
        (archive_data / "source_images").mkdir()
        (archive_data / "source_images" / "restored.jpg").write_bytes(b"restored source")
        (archive_data / "tiles").mkdir()
        (archive_data / "tiles" / "restored.dzi").write_bytes(b"restored tiles")
        archive = self._build_archive(archive_data, backup_mode="development")

        with patch.object(backup, "_local_backup_dir", return_value=self.tmp / "backups"):
            self.assertTrue(backup._restore_from_archive(archive))
        self.assertEqual(
            (self.data_dir / "source_images" / "restored.jpg").read_bytes(),
            b"restored source",
        )
        self.assertEqual(
            (self.data_dir / "tiles" / "restored.dzi").read_bytes(),
            b"restored tiles",
        )
        self.assertFalse((self.data_dir / "source_images" / "existing.jpg").exists())
        restore_state = json.loads((self.tmp / "backups" / "RESTORE_STATE.json").read_text())
        self.assertTrue(restore_state["operator"]["database"]["success"])
        self.assertTrue(restore_state["operator"]["filesystem"]["success"])

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_production_restore_preserves_tiles(self, _mock_run):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "archive_data"
        archive_data.mkdir()
        (archive_data / "source_images").mkdir()
        (archive_data / "source_images" / "restored.jpg").write_bytes(b"restored source")
        (archive_data / "tiles").mkdir()
        (archive_data / "tiles" / "restored.dzi").write_bytes(b"restored tiles")
        archive = self._build_archive(archive_data, backup_mode="development")

        with patch.object(backup, "_local_backup_dir", return_value=self.tmp / "backups"):
            self.assertTrue(backup._restore_from_archive(archive))
        self.assertEqual(
            (self.data_dir / "source_images" / "restored.jpg").read_bytes(),
            b"restored source",
        )
        # Existing tiles should be preserved, archive tiles ignored.
        self.assertEqual(
            (self.data_dir / "tiles" / "existing.dzi").read_bytes(),
            b"existing tiles",
        )
        self.assertFalse((self.data_dir / "tiles" / "restored.dzi").exists())

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_restore_warns_on_backup_mode_mismatch(self, _mock_run):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "archive_data"
        archive_data.mkdir()
        (archive_data / "source_images").mkdir()
        (archive_data / "source_images" / "restored.jpg").write_bytes(b"restored source")
        archive = self._build_archive(archive_data, backup_mode="development")

        with self.assertLogs("hriv-backup", level="WARNING") as cm:
            with patch.object(backup, "_local_backup_dir", return_value=self.tmp / "backups"):
                self.assertTrue(backup._restore_from_archive(archive))
        self.assertTrue(
            any("mismatch" in msg.lower() for msg in cm.output),
            f"Expected mismatch warning, got: {cm.output}",
        )

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_restore_returns_false_when_archive_has_no_restorable_components(self, _mock_run):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        snapshot_dir = self.tmp / "empty_snapshot"
        snapshot_dir.mkdir()
        (snapshot_dir / "manifest.json").write_text(
            json.dumps({"snapshot_name": "empty_snapshot", "created_at": "2026-01-01T00:00:00+00:00"})
        )
        archive = self.tmp / "empty-backup.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(snapshot_dir, arcname="empty_snapshot")

        with patch.object(backup, "_local_backup_dir", return_value=self.tmp / "backups"):
            self.assertFalse(backup._restore_from_archive(archive))

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_restore_persists_state_for_operator_restore(self, _mock_run):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "archive_state"
        archive_data.mkdir()
        (archive_data / "source_images").mkdir()
        (archive_data / "source_images" / "restored.jpg").write_bytes(b"restored source")
        archive = self._build_archive(archive_data, backup_mode="development")

        with patch.object(backup, "_local_backup_dir", return_value=self.tmp / "backups"):
            self.assertTrue(backup._restore_from_archive(archive))

        state = json.loads((self.tmp / "backups" / "RESTORE_STATE.json").read_text())
        self.assertEqual(state["schema_version"], 1)
        self.assertEqual(state["operator"]["database"]["archive_name"], archive.name)
        self.assertTrue(state["operator"]["database"]["success"])
        self.assertTrue(state["operator"]["filesystem"]["success"])
        self.assertIsNone(state["test"]["database"]["started_at"])

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_run_restore_test_uses_separate_targets(self, _mock_run):
        test_data_dir = self.tmp / "restore-test-data"
        self._reload(
            {
                "BACKUP_MODE": "development",
                "DATA_DIR": str(self.data_dir),
                "RESTORE_TEST_DATABASE_URL": "postgresql://restore:test@db:5432/restore_test",
                "RESTORE_TEST_DATA_DIR": str(test_data_dir),
            }
        )
        archive_data = self.tmp / "archive_test"
        archive_data.mkdir()
        (archive_data / "source_images").mkdir()
        (archive_data / "source_images" / "restored.jpg").write_bytes(b"restored source")
        archive = self._build_archive(archive_data, backup_mode="development")
        local_backups = self.tmp / "backups"
        local_backups.mkdir()
        shutil.copy2(archive, local_backups / archive.name)

        with patch.object(backup, "_local_backup_dir", return_value=local_backups):
            self.assertTrue(backup.run_restore_test(archive.name))

        self.assertTrue((test_data_dir / "source_images" / "restored.jpg").exists())
        self.assertTrue((self.data_dir / "source_images" / "existing.jpg").exists())
        state = json.loads((local_backups / "RESTORE_STATE.json").read_text())
        self.assertTrue(state["test"]["database"]["success"])
        self.assertTrue(state["test"]["filesystem"]["success"])


class BackupRunTestCase(_BackupTestCase):
    """Tests for a full backup run."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmp = Path(self._tmpdir.name)
        self.data_dir = self.tmp / "data"
        self.data_dir.mkdir()
        (self.data_dir / "source_images").mkdir()
        (self.data_dir / "source_images" / "img.jpg").write_bytes(b"source")
        (self.data_dir / "tiles").mkdir()
        (self.data_dir / "tiles" / "img.dzi").write_bytes(b"tiles")

    def test_run_backup_excludes_tiles_in_production(self):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "DATA_DIR": str(self.data_dir),
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
            }
        )
        uploaded_path = self.tmp / "uploaded.tar.gz"
        uploads: dict[str, bytes] = {}

        def fake_upload_blob(blob_name, data, overwrite=True, etag=None, match_condition=None):
            payload = data.read()
            uploads[blob_name] = payload
            if blob_name.endswith(".tar.gz"):
                uploaded_path.write_bytes(payload)

        def fake_download_blob(blob_name):
            if blob_name not in uploads:
                raise backup.ResourceNotFoundError("missing")
            payload = uploads[blob_name]
            return SimpleNamespace(
                properties=SimpleNamespace(etag=f"etag-{len(payload)}"),
                readall=lambda: payload,
            )

        fake_container = MagicMock()
        fake_container.upload_blob = fake_upload_blob
        fake_container.download_blob = fake_download_blob
        fake_container.list_blobs.return_value = []
        fake_container.delete_blob = MagicMock()

        def fake_subprocess_run(cmd, **_kwargs):
            if cmd[0] == "pg_dump":
                f_idx = cmd.index("-f")
                Path(cmd[f_idx + 1]).write_text("dump")
            return MagicMock(returncode=0)

        with patch.object(backup, "_blob_container_client", return_value=fake_container), patch.object(backup, "subprocess", run=fake_subprocess_run):
            result = backup.run_backup()
        self.assertIsNotNone(result)
        self.assertTrue(uploaded_path.exists())
        with tarfile.open(uploaded_path, "r:gz") as tar:
            names = tar.getnames()
        self.assertTrue(any("data/source_images/img.jpg" in n for n in names))
        self.assertFalse(any("data/tiles" in n for n in names))
        marker_blob = "hriv-backups/LAST_SUCCESS.json"
        state_blob = "hriv-backups/BACKUP_STATE.json"
        self.assertIn(marker_blob, uploads)
        self.assertIn(state_blob, uploads)
        sidecar_blob = f"hriv-backups/{result.name.removesuffix('.tar.gz')}.manifest.json"
        self.assertIn(sidecar_blob, uploads)
        sidecar = json.loads(uploads[sidecar_blob].decode())
        self.assertEqual(sidecar["snapshot_name"], result.name.removesuffix(".tar.gz"))
        self.assertIn("data/source_images/img.jpg", sidecar["files"])
        marker = json.loads(uploads[marker_blob].decode())
        self.assertEqual(marker["snapshot_name"], result.name.removesuffix(".tar.gz"))
        self.assertEqual(marker["backup_mode"], "production")
        self.assertTrue(marker["tiles_excluded"])
        self.assertGreater(marker["archive_size"], 0)
        state = json.loads(uploads[state_blob].decode())
        self.assertEqual(state["schema_version"], 2)
        self.assertTrue(state["database"]["success"])
        self.assertTrue(state["filesystem"]["success"])
        self.assertEqual(
            state["database"]["last_success_archive_key"],
            f"hriv-backups/{result.name}",
        )
        self.assertEqual(
            state["filesystem"]["last_success_archive_key"],
            f"hriv-backups/{result.name}",
        )

    def test_run_backup_writes_local_manifest_sidecar(self):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "DATA_DIR": str(self.data_dir),
            }
        )
        local_dir = self.tmp / "backups"
        local_dir.mkdir()

        def fake_subprocess_run(cmd, **_kwargs):
            if cmd[0] == "pg_dump":
                f_idx = cmd.index("-f")
                Path(cmd[f_idx + 1]).write_text("dump")
            return MagicMock(returncode=0)

        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=fake_subprocess_run),
        ):
            result = backup.run_backup()

        archive = local_dir / result.name
        sidecar = local_dir / f"{result.name.removesuffix('.tar.gz')}.manifest.json"
        state_path = local_dir / "BACKUP_STATE.json"
        self.assertTrue(archive.exists())
        self.assertTrue(sidecar.exists())
        self.assertTrue(state_path.exists())
        payload = json.loads(sidecar.read_text())
        self.assertEqual(payload["snapshot_name"], result.name.removesuffix(".tar.gz"))
        self.assertIn("data/source_images/img.jpg", payload["files"])
        state = json.loads(state_path.read_text())
        self.assertEqual(state["schema_version"], 2)
        self.assertTrue(state["filesystem"]["success"])
        self.assertEqual(state["filesystem"]["last_success_archive_key"], str(archive))
        self.assertEqual(state["database"]["last_success_archive_key"], str(archive))

    def test_run_backup_marker_records_completion_and_per_type_success(self):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "DATA_DIR": str(self.data_dir),
            }
        )
        local_dir = self.tmp / "backups"
        local_dir.mkdir()

        def fake_subprocess_run(cmd, **_kwargs):
            if cmd[0] == "pg_dump":
                f_idx = cmd.index("-f")
                Path(cmd[f_idx + 1]).write_text("dump")
            return MagicMock(returncode=0)

        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=fake_subprocess_run),
        ):
            result = backup.run_backup()

        marker = json.loads((local_dir / "LAST_SUCCESS.json").read_text())
        state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
        self.assertEqual(marker["snapshot_name"], result.name.removesuffix(".tar.gz"))
        self.assertGreaterEqual(marker["completed_at"], marker["created_at"])
        self.assertEqual(marker["run_id"], state["run_id"])
        self.assertEqual(sorted(marker["types"]), ["database", "filesystem"])
        self.assertEqual(marker["types"]["filesystem"]["archive_key"], str(local_dir / result.name))
        self.assertEqual(state["database"]["run_id"], state["run_id"])
        self.assertEqual(
            sorted(entry["backup_type"] for entry in state["attempts"]),
            ["database", "filesystem"],
        )

    def test_pg_dump_failure_updates_backup_state(self):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "DATA_DIR": str(self.data_dir),
            }
        )
        local_dir = self.tmp / "backups"
        local_dir.mkdir()

        def fake_subprocess_run(_cmd, **_kwargs):
            return MagicMock(returncode=1, stderr="boom")

        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=fake_subprocess_run),
        ):
            result = backup.run_backup()

        self.assertIsNone(result)
        state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
        self.assertFalse(state["database"]["success"])
        self.assertIsNone(state["filesystem"]["started_at"])

    def test_backup_state_preserves_previous_success_history_on_filesystem_failure(self):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "DATA_DIR": str(self.data_dir),
            }
        )
        local_dir = self.tmp / "backups"
        local_dir.mkdir()
        (local_dir / "BACKUP_STATE.json").write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "database": {
                        "last_success_started_at": "2026-07-12T08:00:00+00:00",
                        "last_success_completed_at": "2026-07-12T08:00:42+00:00",
                        "last_success_duration_seconds": 42,
                        "last_success_size_bytes": 100,
                        "last_success_archive_key": "old-db",
                    },
                    "filesystem": {
                        "last_success_started_at": "2026-07-11T08:01:00+00:00",
                        "last_success_completed_at": "2026-07-11T08:09:00+00:00",
                        "last_success_duration_seconds": 480,
                        "last_success_size_bytes": 200,
                        "last_success_archive_key": "old-fs",
                    },
                }
            )
        )

        def fake_subprocess_run(cmd, **_kwargs):
            if cmd[0] == "pg_dump":
                f_idx = cmd.index("-f")
                Path(cmd[f_idx + 1]).write_text("dump")
            return MagicMock(returncode=0)

        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=fake_subprocess_run),
            patch.object(backup.tarfile, "open", side_effect=RuntimeError("tar failed")),
        ):
            result = backup.run_backup()

        self.assertIsNone(result)
        state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
        self.assertTrue(state["database"]["success"])
        self.assertFalse(state["filesystem"]["success"])
        self.assertEqual(
            state["filesystem"]["last_success_completed_at"],
            "2026-07-11T08:09:00+00:00",
        )
        self.assertEqual(state["filesystem"]["last_success_archive_key"], "old-fs")


class RetentionTestCase(_BackupTestCase):
    """Tests for snapshot retention cleanup."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmp = Path(self._tmpdir.name)

    def test_local_retention_deletes_sidecar_with_archive(self):
        self._reload({"BACKUP_RETENTION_COUNT": "1"})
        local_dir = self.tmp / "backups"
        local_dir.mkdir()
        old_archive = local_dir / "hriv-backup-20260101-020000.tar.gz"
        old_archive.write_bytes(b"old")
        old_sidecar = local_dir / "hriv-backup-20260101-020000.manifest.json"
        old_sidecar.write_text("{}")
        new_archive = local_dir / "hriv-backup-20260102-020000.tar.gz"
        new_archive.write_bytes(b"new")
        new_sidecar = local_dir / "hriv-backup-20260102-020000.manifest.json"
        new_sidecar.write_text("{}")

        with patch.object(backup, "_local_backup_dir", return_value=local_dir):
            backup._enforce_local_retention()

        self.assertFalse(old_archive.exists())
        self.assertFalse(old_sidecar.exists())
        self.assertTrue(new_archive.exists())
        self.assertTrue(new_sidecar.exists())


class StatusTestCase(_BackupTestCase):
    """Tests for the backup health/status command."""

    def _reload_status(
        self,
        *,
        marker_created_at: datetime | None,
        snapshots: list | None = None,
        marker_completed_at: datetime | None = None,
    ):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "BACKUP_STALE_HOURS": "2",
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
                "AZURE_BLOB_PREFIX": "fake",
            }
        )

        marker_payload = None
        if marker_created_at is not None:
            marker = {
                "snapshot_name": "hriv-backup-20260101-020000",
                "created_at": marker_created_at.isoformat(),
                "archive_size": 1234,
                "backup_mode": "production",
                "tiles_excluded": True,
            }
            if marker_completed_at is not None:
                marker["completed_at"] = marker_completed_at.isoformat()
            marker_payload = json.dumps(marker).encode()

        class _Download:
            def __init__(self, payload: bytes):
                self._payload = payload

            def readall(self):
                return self._payload

        fake_container = MagicMock()
        if snapshots is None:
            snapshots = [
                SimpleNamespace(
                    name="hriv-backups/hriv-backup-20260101-020000.tar.gz",
                    size=1234,
                    last_modified=datetime.now(timezone.utc),
                ),
                SimpleNamespace(
                    name="hriv-backups/hriv-backup-20260102-020000.tar.gz",
                    size=2345,
                    last_modified=datetime.now(timezone.utc) + timedelta(minutes=1),
                ),
            ]
        fake_container.list_blobs.return_value = snapshots
        if marker_payload is None:
            fake_container.download_blob.side_effect = backup.ResourceNotFoundError("missing")
        else:
            fake_container.download_blob.return_value = _Download(marker_payload)
        return fake_container

    def test_status_reports_fresh(self):
        marker_created_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        fake_container = self._reload_status(marker_created_at=marker_created_at)

        with patch.object(backup, "_blob_container_client", return_value=fake_container), contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertTrue(backup.run_status())

        output = stdout.getvalue()
        self.assertIn("Status: FRESH", output)
        self.assertIn("Last successful backup:", output)
        self.assertIn("Newest snapshot: hriv-backup-20260102-020000.tar.gz", output)
        self.assertIn("Snapshot count: 2", output)

    def test_status_reports_stale(self):
        marker_created_at = datetime.now(timezone.utc) - timedelta(hours=3)
        fake_container = self._reload_status(marker_created_at=marker_created_at)

        with patch.object(backup, "_blob_container_client", return_value=fake_container), contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertFalse(backup.run_status())

        output = stdout.getvalue()
        self.assertIn("Status: STALE", output)
        self.assertIn("Age:", output)

    def test_status_fails_when_marker_missing(self):
        fake_container = self._reload_status(marker_created_at=None)

        with patch.object(backup, "_blob_container_client", return_value=fake_container), contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertFalse(backup.run_status())

        output = stdout.getvalue()
        self.assertIn("Status: MISSING", output)
        self.assertIn("Last successful backup: (missing)", output)

    def test_status_reports_no_snapshots_when_marker_fresh(self):
        marker_created_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        fake_container = self._reload_status(marker_created_at=marker_created_at, snapshots=[])

        with patch.object(backup, "_blob_container_client", return_value=fake_container), contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertFalse(backup.run_status())

        output = stdout.getvalue()
        self.assertIn("Status: NO_SNAPSHOTS", output)
        self.assertIn("Snapshot count: 0", output)

    def test_status_measures_age_from_completion_time(self):
        # A long-running backup that started 3h ago but finished 30m ago is
        # fresh against a 2h threshold.
        fake_container = self._reload_status(
            marker_created_at=datetime.now(timezone.utc) - timedelta(hours=3),
            marker_completed_at=datetime.now(timezone.utc) - timedelta(minutes=30),
        )

        with patch.object(backup, "_blob_container_client", return_value=fake_container), contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertTrue(backup.run_status())

        self.assertIn("Status: FRESH", stdout.getvalue())

    def test_missing_marker_is_silent(self):
        self._reload_status(marker_created_at=datetime.now(timezone.utc))
        fake_container = MagicMock()
        fake_container.download_blob.side_effect = backup.ResourceNotFoundError("missing")

        with patch.object(backup, "_blob_container_client", return_value=fake_container), self.assertNoLogs("hriv-backup", level="ERROR"):
            self.assertIsNone(backup._read_last_success_marker())


class AtomicWriteTestCase(unittest.TestCase):
    """Concurrency behaviour of the atomic write helper."""

    def test_concurrent_writers_do_not_collide(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "BACKUP_STATE.json"
            errors: list[Exception] = []
            barrier = threading.Barrier(2)

            def writer(payload: bytes) -> None:
                barrier.wait()
                for _ in range(200):
                    try:
                        backup._atomic_write_bytes(target, payload)
                    except Exception as exc:  # pragma: no cover - failure path
                        errors.append(exc)

            threads = [
                threading.Thread(target=writer, args=(b'{"writer": "a"}',)),
                threading.Thread(target=writer, args=(b'{"writer": "b"}',)),
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

            self.assertEqual(errors, [])
            self.assertIn(target.read_bytes(), (b'{"writer": "a"}', b'{"writer": "b"}'))
            self.assertEqual([p.name for p in Path(tmpdir).iterdir()], [target.name])


def _section(**overrides) -> dict:
    section = {
        "run_id": None,
        "started_at": None,
        "completed_at": None,
        "success": None,
        "duration_seconds": None,
        "size_bytes": None,
        "archive_key": None,
        "last_success_started_at": None,
        "last_success_completed_at": None,
        "last_success_duration_seconds": None,
        "last_success_size_bytes": None,
        "last_success_archive_key": None,
    }
    section.update(overrides)
    return section


def _attempt(run_id: str, started: str, completed: str | None, *, success=None, archive_key=None) -> dict:
    section = _section(
        run_id=run_id,
        started_at=started,
        completed_at=completed,
        success=success,
        archive_key=archive_key,
    )
    if success:
        section["last_success_started_at"] = started
        section["last_success_completed_at"] = completed
        section["last_success_archive_key"] = archive_key
    return section


def _state(run_id: str, *, database: dict | None = None, filesystem: dict | None = None, snapshot_name="snap") -> dict:
    return {
        "schema_version": 2,
        "run_id": run_id,
        "snapshot_name": snapshot_name,
        "backup_mode": "production",
        "tiles_excluded": True,
        "storage_prefix": "hriv-backups",
        "database": database or _section(),
        "filesystem": filesystem or _section(),
    }


class BackupStateMergeTestCase(unittest.TestCase):
    """Ordering rules for concurrent updates to the shared backup state."""

    def test_older_completion_cannot_overwrite_newer_attempt(self):
        newer = _state(
            "newer",
            snapshot_name="snap-newer",
            database=_attempt("newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True, archive_key="new-key"),
        )
        older = _state(
            "older",
            snapshot_name="snap-older",
            database=_attempt("older", "2026-08-01T09:00:00+00:00", "2026-08-01T10:03:00+00:00", success=True, archive_key="old-key"),
        )

        merged = backup._merge_backup_state(newer, older)

        self.assertEqual(merged["database"]["run_id"], "newer")
        self.assertEqual(merged["database"]["archive_key"], "new-key")
        self.assertEqual(merged["database"]["last_success_archive_key"], "new-key")
        self.assertEqual(merged["snapshot_name"], "snap-newer")

    def test_newer_completion_advances_state(self):
        older = _state(
            "older",
            database=_attempt("older", "2026-08-01T09:00:00+00:00", "2026-08-01T09:05:00+00:00", success=True, archive_key="old-key"),
        )
        newer = _state(
            "newer",
            snapshot_name="snap-newer",
            database=_attempt("newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True, archive_key="new-key"),
        )

        merged = backup._merge_backup_state(older, newer)

        self.assertEqual(merged["database"]["run_id"], "newer")
        self.assertEqual(merged["database"]["last_success_archive_key"], "new-key")
        self.assertEqual(merged["snapshot_name"], "snap-newer")

    def test_same_run_can_enrich_its_own_attempt_record(self):
        # The database archive key is only known once the filesystem archive
        # exists, so the owning run re-commits an attempt whose timestamps are
        # already final.
        attempt = _attempt(
            "run-1", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True
        )
        stored = backup._merge_backup_state(None, _state("run-1", database=attempt))

        enriched = copy.deepcopy(attempt)
        enriched["archive_key"] = "snap.tar.gz"
        enriched["last_success_archive_key"] = "snap.tar.gz"
        merged = backup._merge_backup_state(stored, _state("run-1", database=enriched))

        self.assertEqual(merged["database"]["archive_key"], "snap.tar.gz")
        self.assertEqual(merged["database"]["last_success_archive_key"], "snap.tar.gz")

    def test_same_run_enrichment_also_updates_its_history_entry(self):
        attempt = _attempt(
            "run-1", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True
        )
        stored = backup._merge_backup_state(None, _state("run-1", database=attempt))

        enriched = copy.deepcopy(attempt)
        enriched["archive_key"] = "snap.tar.gz"
        merged = backup._merge_backup_state(stored, _state("run-1", database=enriched))

        entries = [entry for entry in merged["attempts"] if entry["backup_type"] == "database"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["archive_key"], "snap.tar.gz")

    def test_late_finishing_older_failure_cannot_regress_newer_success(self):
        newer_success = _state(
            "newer",
            filesystem=_attempt("newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True, archive_key="new-key"),
        )
        # An older run that started first but only failed afterwards.
        older_failure = _state(
            "older",
            filesystem=_attempt("older", "2026-08-01T09:00:00+00:00", "2026-08-01T10:09:00+00:00", success=False),
        )

        merged = backup._merge_backup_state(newer_success, older_failure)

        # The failure is newer, so it becomes the current attempt …
        self.assertIs(merged["filesystem"]["success"], False)
        self.assertEqual(merged["filesystem"]["run_id"], "older")
        # … but the newer success history survives.
        self.assertEqual(merged["filesystem"]["last_success_completed_at"], "2026-08-01T10:05:00+00:00")
        self.assertEqual(merged["filesystem"]["last_success_archive_key"], "new-key")

    def test_older_failure_does_not_replace_newer_attempt(self):
        newer_success = _state(
            "newer",
            filesystem=_attempt("newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True, archive_key="new-key"),
        )
        older_failure = _state(
            "older",
            filesystem=_attempt("older", "2026-08-01T09:00:00+00:00", "2026-08-01T09:30:00+00:00", success=False),
        )

        merged = backup._merge_backup_state(newer_success, older_failure)

        self.assertIs(merged["filesystem"]["success"], True)
        self.assertEqual(merged["filesystem"]["run_id"], "newer")

    def test_in_progress_attempt_does_not_displace_finished_attempt(self):
        finished = _state(
            "finished",
            database=_attempt("finished", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True),
        )
        in_progress = _state(
            "running",
            database=_section(run_id="running", started_at="2026-08-01T10:02:00+00:00"),
        )

        merged = backup._merge_backup_state(finished, in_progress)

        self.assertEqual(merged["database"]["run_id"], "finished")
        self.assertIs(merged["database"]["success"], True)

    def test_types_are_merged_independently(self):
        existing = _state(
            "a",
            database=_attempt("a", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True, archive_key="a-key"),
            filesystem=_attempt("a", "2026-08-01T10:05:00+00:00", "2026-08-01T10:30:00+00:00", success=False),
        )
        incoming = _state(
            "b",
            database=_attempt("b", "2026-08-01T09:00:00+00:00", "2026-08-01T09:05:00+00:00", success=True, archive_key="b-key"),
            filesystem=_attempt("b", "2026-08-01T09:05:00+00:00", "2026-08-01T10:40:00+00:00", success=True, archive_key="b-fs"),
        )

        merged = backup._merge_backup_state(existing, incoming)

        self.assertEqual(merged["database"]["last_success_archive_key"], "a-key")
        self.assertEqual(merged["filesystem"]["last_success_archive_key"], "b-fs")

    def test_missing_or_legacy_state_is_replaced(self):
        incoming = _state("only")
        self.assertEqual(backup._merge_backup_state(None, incoming)["run_id"], "only")
        self.assertEqual(backup._merge_backup_state({"schema_version": 1}, incoming)["run_id"], "only")
        self.assertEqual(backup._merge_backup_state("garbage", incoming)["run_id"], "only")

    def test_attempt_history_retains_losing_run(self):
        existing = _state(
            "newer",
            database=_attempt("newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True),
        )
        existing["attempts"] = backup._merge_attempt_history(None, existing)
        older = _state(
            "older",
            database=_attempt("older", "2026-08-01T09:00:00+00:00", "2026-08-01T09:05:00+00:00", success=False),
        )

        merged = backup._merge_backup_state(existing, older)

        run_ids = [entry["run_id"] for entry in merged["attempts"]]
        self.assertIn("newer", run_ids)
        self.assertIn("older", run_ids)
        self.assertLessEqual(len(merged["attempts"]), backup._MAX_ATTEMPT_HISTORY)

    def test_attempt_history_is_bounded(self):
        state = None
        for index in range(backup._MAX_ATTEMPT_HISTORY + 5):
            incoming = _state(
                f"run-{index:02d}",
                database=_attempt(
                    f"run-{index:02d}",
                    f"2026-08-01T{index:02d}:00:00+00:00",
                    f"2026-08-01T{index:02d}:05:00+00:00",
                    success=True,
                ),
            )
            state = backup._merge_backup_state(state, incoming)

        self.assertEqual(len(state["attempts"]), backup._MAX_ATTEMPT_HISTORY)
        self.assertEqual(state["attempts"][0]["run_id"], f"run-{backup._MAX_ATTEMPT_HISTORY + 4:02d}")


class LastSuccessMarkerMergeTestCase(unittest.TestCase):
    """Ordering rules for the LAST_SUCCESS marker."""

    def _marker(self, run_id, created, completed, *, types=None):
        return {
            "snapshot_name": f"snap-{run_id}",
            "created_at": created,
            "completed_at": completed,
            "archive_size": 10,
            "backup_mode": "production",
            "tiles_excluded": True,
            "run_id": run_id,
            "types": types or {},
        }

    def test_newest_completion_wins(self):
        newer = self._marker("newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00")
        older = self._marker("older", "2026-08-01T09:00:00+00:00", "2026-08-01T10:03:00+00:00")

        self.assertEqual(backup._merge_last_success_marker(newer, older)["run_id"], "newer")
        self.assertEqual(backup._merge_last_success_marker(older, newer)["run_id"], "newer")

    def test_legacy_marker_without_completed_at_is_ordered_by_created_at(self):
        legacy = {"snapshot_name": "snap-legacy", "created_at": "2026-08-01T08:00:00+00:00"}
        newer = self._marker("newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00")

        self.assertEqual(backup._merge_last_success_marker(legacy, newer)["run_id"], "newer")
        self.assertEqual(backup._merge_last_success_marker(newer, legacy)["run_id"], "newer")

    def test_per_type_entries_keep_newest_of_each_type(self):
        existing = self._marker(
            "a",
            "2026-08-01T10:00:00+00:00",
            "2026-08-01T10:05:00+00:00",
            types={
                "database": {"run_id": "a", "created_at": "2026-08-01T10:00:00+00:00", "completed_at": "2026-08-01T10:02:00+00:00"},
            },
        )
        incoming = self._marker(
            "b",
            "2026-08-01T09:00:00+00:00",
            "2026-08-01T10:03:00+00:00",
            types={
                "filesystem": {"run_id": "b", "created_at": "2026-08-01T09:00:00+00:00", "completed_at": "2026-08-01T10:03:00+00:00"},
            },
        )

        merged = backup._merge_last_success_marker(existing, incoming)

        self.assertEqual(merged["run_id"], "a")
        self.assertEqual(merged["types"]["database"]["run_id"], "a")
        self.assertEqual(merged["types"]["filesystem"]["run_id"], "b")


class RestoreStateMergeTestCase(unittest.TestCase):
    """Ordering rules for the shared restore state."""

    def _restore_state(self, run_id, purpose, started, completed, success):
        blank = {
            "run_id": None,
            "started_at": None,
            "completed_at": None,
            "success": None,
            "duration_seconds": None,
            "archive_name": None,
            "last_success_started_at": None,
            "last_success_completed_at": None,
            "last_success_duration_seconds": None,
            "last_success_archive_name": None,
        }
        section = dict(blank, run_id=run_id, started_at=started, completed_at=completed, success=success)
        if success:
            section["last_success_started_at"] = started
            section["last_success_completed_at"] = completed
            section["last_success_archive_name"] = f"{run_id}.tar.gz"
        state = {
            "schema_version": 1,
            "run_id": run_id,
            "operator": {"database": dict(blank), "filesystem": dict(blank)},
            "test": {"database": dict(blank), "filesystem": dict(blank)},
        }
        state[purpose]["database"] = section
        return state

    def test_older_restore_failure_preserves_newer_success(self):
        newer = self._restore_state("newer", "operator", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", True)
        older = self._restore_state("older", "operator", "2026-08-01T09:00:00+00:00", "2026-08-01T10:09:00+00:00", False)

        merged = backup._merge_restore_state(newer, older)

        self.assertIs(merged["operator"]["database"]["success"], False)
        self.assertEqual(merged["operator"]["database"]["last_success_archive_name"], "newer.tar.gz")

    def test_purposes_do_not_clobber_each_other(self):
        operator = self._restore_state("op", "operator", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", True)
        test_run = self._restore_state("test", "test", "2026-08-01T11:00:00+00:00", "2026-08-01T11:05:00+00:00", True)

        merged = backup._merge_restore_state(operator, test_run)

        self.assertEqual(merged["operator"]["database"]["run_id"], "op")
        self.assertEqual(merged["test"]["database"]["run_id"], "test")


class LocalStateCommitTestCase(_BackupTestCase):
    """Local (PVC) read-merge-write behaviour, including the sidecar lock."""

    def setUp(self):
        super().setUp()
        self._reload({"BACKUP_MODE": "production"})
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.local_dir = Path(self._tmpdir.name) / "backups"
        self.local_dir.mkdir()
        patcher = patch.object(backup, "_local_backup_dir", return_value=self.local_dir)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _write_state(self, state):
        backup._commit_shared_json(
            local_path=backup._backup_state_path(),
            blob_name=backup._backup_state_blob_name(),
            incoming=state,
            merge=backup._merge_backup_state,
            label="test state",
        )

    def _read_state(self):
        return json.loads((self.local_dir / "BACKUP_STATE.json").read_text())

    def test_out_of_order_writers_converge_on_newest_result(self):
        newer = _state(
            "newer",
            database=_attempt("newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True, archive_key="new-key"),
        )
        older = _state(
            "older",
            database=_attempt("older", "2026-08-01T09:00:00+00:00", "2026-08-01T10:04:00+00:00", success=True, archive_key="old-key"),
        )

        self._write_state(newer)
        self._write_state(older)

        state = self._read_state()
        self.assertEqual(state["database"]["run_id"], "newer")
        self.assertEqual(state["database"]["last_success_archive_key"], "new-key")

    def test_lock_file_is_created_on_the_backups_volume(self):
        self._write_state(_state("only"))

        lock_path = self.local_dir / backup.STATE_LOCK_FILENAME
        self.assertTrue(lock_path.exists())
        self.assertEqual(backup._state_lock_path(), lock_path)

    def test_lock_sidecar_is_invisible_to_list_and_retention(self):
        self._reload({"BACKUP_MODE": "production", "BACKUP_RETENTION_COUNT": "1"})
        with patch.object(backup, "_local_backup_dir", return_value=self.local_dir):
            self._write_state(_state("only"))
            for name in ("hriv-backup-20260101-020000.tar.gz", "hriv-backup-20260102-020000.tar.gz"):
                (self.local_dir / name).write_bytes(b"archive")

            names = [snapshot["name"] for snapshot in backup.list_snapshots()]
            backup._enforce_local_retention()

        self.assertEqual(names, ["hriv-backup-20260102-020000.tar.gz", "hriv-backup-20260101-020000.tar.gz"])
        self.assertTrue((self.local_dir / backup.STATE_LOCK_FILENAME).exists())
        self.assertTrue((self.local_dir / "hriv-backup-20260102-020000.tar.gz").exists())
        self.assertFalse((self.local_dir / "hriv-backup-20260101-020000.tar.gz").exists())

    def test_corrupt_state_file_is_replaced(self):
        (self.local_dir / "BACKUP_STATE.json").write_text("{not json")

        with self.assertLogs("hriv-backup", level="ERROR"):
            self._write_state(_state("fresh"))

        self.assertEqual(self._read_state()["run_id"], "fresh")

    def test_concurrent_threads_preserve_both_successes(self):
        barrier = threading.Barrier(2)
        errors: list[Exception] = []

        def writer(run_id: str, backup_type: str, hour: int) -> None:
            state = _state(
                run_id,
                **{
                    backup_type: _attempt(
                        run_id,
                        f"2026-08-01T{hour:02d}:00:00+00:00",
                        f"2026-08-01T{hour:02d}:05:00+00:00",
                        success=True,
                        archive_key=f"{run_id}-key",
                    )
                },
            )
            barrier.wait()
            for _ in range(50):
                try:
                    self._write_state(copy.deepcopy(state))
                except Exception as exc:  # pragma: no cover - failure path
                    errors.append(exc)

        threads = [
            threading.Thread(target=writer, args=("db-run", "database", 10)),
            threading.Thread(target=writer, args=("fs-run", "filesystem", 11)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        state = self._read_state()
        self.assertEqual(state["database"]["last_success_archive_key"], "db-run-key")
        self.assertEqual(state["filesystem"]["last_success_archive_key"], "fs-run-key")


class StateLockProcessTestCase(unittest.TestCase):
    """Cross-process and crash behaviour of the shared state lock."""

    BACKUP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.local_dir = Path(self._tmpdir.name) / "backups"
        self.local_dir.mkdir()
        self.flag = self.local_dir / "holding"

    def _spawn_holder(self, hold_seconds: float) -> subprocess.Popen:
        script = (
            "import pathlib, sys, time\n"
            f"sys.path.insert(0, {self.BACKUP_DIR!r})\n"
            "import backup\n"
            f"backup._local_backup_dir = lambda: pathlib.Path({str(self.local_dir)!r})\n"
            "with backup._state_lock() as acquired:\n"
            f"    pathlib.Path({str(self.flag)!r}).write_text('1' if acquired else '0')\n"
            f"    time.sleep({hold_seconds})\n"
        )
        process = subprocess.Popen([sys.executable, "-c", script])
        self.addCleanup(self._terminate, process)

        deadline = time.monotonic() + 30
        while not self.flag.exists():
            if time.monotonic() > deadline:  # pragma: no cover - failure path
                self.fail("Lock holder subprocess never acquired the lock")
            time.sleep(0.02)
        self.assertEqual(self.flag.read_text(), "1")
        return process

    def _terminate(self, process: subprocess.Popen) -> None:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=30)

    def test_lock_is_exclusive_across_processes(self):
        holder = self._spawn_holder(1.0)

        with patch.object(backup, "_local_backup_dir", return_value=self.local_dir):
            started = time.monotonic()
            with backup._state_lock() as acquired:
                waited = time.monotonic() - started
                self.assertTrue(acquired)

        self.assertGreaterEqual(waited, 0.5)
        holder.wait(timeout=30)

    def test_killed_writer_releases_the_lock(self):
        holder = self._spawn_holder(120.0)
        holder.kill()
        holder.wait(timeout=30)

        with patch.object(backup, "_local_backup_dir", return_value=self.local_dir):
            started = time.monotonic()
            with backup._state_lock() as acquired:
                self.assertTrue(acquired)
            self.assertLess(time.monotonic() - started, 5.0)

    def test_wedged_lock_holder_skips_the_update_instead_of_racing(self):
        self._spawn_holder(120.0)
        (self.local_dir / "BACKUP_STATE.json").write_text(json.dumps(_state("earlier")))

        with (
            patch.object(backup, "_local_backup_dir", return_value=self.local_dir),
            patch.object(backup, "_STATE_LOCK_TIMEOUT_SECONDS", 0.2),
            self.assertLogs("hriv-backup", level="WARNING") as logs,
        ):
            backup._commit_shared_json(
                local_path=backup._backup_state_path(),
                blob_name=backup._backup_state_blob_name(),
                incoming=_state("blocked"),
                merge=backup._merge_backup_state,
                label="test state",
            )

        self.assertTrue(any("Skipping" in message for message in logs.output))
        state = json.loads((self.local_dir / "BACKUP_STATE.json").read_text())
        self.assertEqual(state["run_id"], "earlier")


class _FakeBlobStore:
    """Minimal Azure container stub with ETag semantics."""

    def __init__(self):
        self.blobs: dict[str, bytes] = {}
        self.etags: dict[str, str] = {}
        self.calls: list[tuple[str, bool, str | None]] = []
        self.match_conditions: list[object] = []
        self.before_upload = None

    def _put(self, name: str, payload: bytes) -> None:
        self.blobs[name] = payload
        self.etags[name] = f"etag-{len(self.calls)}-{len(payload)}"

    def seed(self, name: str, document: dict) -> None:
        self._put(name, json.dumps(document).encode())

    def download_blob(self, name: str):
        if name not in self.blobs:
            raise backup.ResourceNotFoundError("missing")
        payload = self.blobs[name]
        return SimpleNamespace(
            properties=SimpleNamespace(etag=self.etags[name]),
            readall=lambda: payload,
        )

    def upload_blob(self, name, data, overwrite=True, etag=None, match_condition=None):
        payload = data.read()
        self.calls.append((name, overwrite, etag))
        if self.before_upload is not None:
            hook, self.before_upload = self.before_upload, None
            hook(self)
        if not overwrite:
            if name in self.blobs:
                raise backup.ResourceExistsError("blob already exists")
        elif etag is not None:
            self.match_conditions.append(match_condition)
            if self.etags.get(name) != etag:
                raise backup.ResourceModifiedError("blob was modified")
        self._put(name, payload)


class AzureStateCommitTestCase(_BackupTestCase):
    """Azure ETag compare-and-set behaviour for shared state blobs."""

    def setUp(self):
        super().setUp()
        self._reload(
            {
                "BACKUP_MODE": "production",
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
                "AZURE_BLOB_PREFIX": "hriv-backups",
            }
        )
        self.store = _FakeBlobStore()
        patcher = patch.object(backup, "_blob_container_client", return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.blob_name = "hriv-backups/BACKUP_STATE.json"

    def _write_state(self, state):
        backup._commit_shared_json(
            local_path=Path("/nonexistent/BACKUP_STATE.json"),
            blob_name=self.blob_name,
            incoming=state,
            merge=backup._merge_backup_state,
            label="test state",
        )

    def _stored(self):
        return json.loads(self.store.blobs[self.blob_name].decode())

    def test_first_write_creates_the_blob_without_an_etag(self):
        self._write_state(_state("first"))

        self.assertEqual(self.store.calls, [(self.blob_name, False, None)])
        self.assertEqual(self._stored()["run_id"], "first")

    def test_second_write_is_conditional_on_the_etag(self):
        self._write_state(_state("first"))
        self._write_state(_state("second"))

        name, overwrite, etag = self.store.calls[-1]
        self.assertEqual((name, overwrite), (self.blob_name, True))
        self.assertIsNotNone(etag)
        self.assertEqual(self.store.match_conditions, [backup.MatchConditions.IfNotModified])

    def test_interleaved_writer_forces_a_re_merge(self):
        competitor = _state(
            "competitor",
            filesystem=_attempt("competitor", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00", success=True, archive_key="competitor-key"),
        )
        self._write_state(_state("base"))

        def steal(store):
            store.seed(self.blob_name, competitor)

        self.store.before_upload = steal
        self._write_state(
            _state(
                "mine",
                database=_attempt("mine", "2026-08-01T10:10:00+00:00", "2026-08-01T10:12:00+00:00", success=True, archive_key="my-key"),
            )
        )

        stored = self._stored()
        self.assertEqual(stored["database"]["last_success_archive_key"], "my-key")
        self.assertEqual(stored["filesystem"]["last_success_archive_key"], "competitor-key")

    def test_persistent_contention_gives_up_without_raising(self):
        self._write_state(_state("first"))

        def always_conflict(name, data, overwrite=True, etag=None, match_condition=None):
            data.read()
            if overwrite and etag is not None:
                raise backup.ResourceModifiedError("blob was modified")
            raise backup.ResourceExistsError("blob already exists")

        with patch.object(self.store, "upload_blob", side_effect=always_conflict), self.assertLogs(
            "hriv-backup", level="WARNING"
        ) as logs:
            self._write_state(_state("loser"))

        self.assertTrue(any("Gave up" in message for message in logs.output))
        self.assertEqual(self._stored()["run_id"], "first")

    def test_unparseable_blob_is_replaced_conditionally(self):
        self.store.blobs[self.blob_name] = b"{not json"
        self.store.etags[self.blob_name] = "etag-corrupt"

        with self.assertLogs("hriv-backup", level="WARNING"):
            self._write_state(_state("repaired"))

        self.assertEqual(self._stored()["run_id"], "repaired")
        self.assertEqual(self.store.calls[-1][2], "etag-corrupt")

    def test_failed_read_retries_instead_of_replacing_newer_state(self):
        newer = _state(
            "newer",
            filesystem=_attempt(
                "newer",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
                archive_key="newer-key",
            ),
        )
        self.store.seed(self.blob_name, newer)

        reads = {"count": 0}
        real_download = self.store.download_blob

        def flaky_download(name):
            reads["count"] += 1
            if reads["count"] == 1:
                raise RuntimeError("transient read failure")
            return real_download(name)

        with patch.object(self.store, "download_blob", side_effect=flaky_download):
            self._write_state(
                _state(
                    "mine",
                    database=_attempt(
                        "mine",
                        "2026-08-01T09:00:00+00:00",
                        "2026-08-01T09:02:00+00:00",
                        success=True,
                        archive_key="my-key",
                    ),
                )
            )

        stored = self._stored()
        self.assertEqual(stored["filesystem"]["last_success_archive_key"], "newer-key")
        self.assertEqual(stored["database"]["last_success_archive_key"], "my-key")

    def test_unreadable_blob_gives_up_without_clobbering(self):
        self.store.seed(self.blob_name, _state("existing"))

        with (
            patch.object(self.store, "download_blob", side_effect=RuntimeError("unreadable")),
            self.assertLogs("hriv-backup", level="WARNING") as logs,
        ):
            self._write_state(_state("mine"))

        self.assertTrue(any("Gave up" in message for message in logs.output))
        self.assertEqual(self.store.calls, [])
        self.assertEqual(self._stored()["run_id"], "existing")


if __name__ == "__main__":
    unittest.main()
