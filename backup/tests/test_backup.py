"""Unit tests for the HRIV backup service."""

import contextlib
import io
import importlib
import json
import logging
import os
import shutil
import sys
import tarfile
import tempfile
import threading
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
        "BACKUP_STAGING_DIR",
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

        def fake_upload_blob(blob_name, data, overwrite=True):
            payload = data.read()
            uploads[blob_name] = payload
            if blob_name.endswith(".tar.gz"):
                uploaded_path.write_bytes(payload)

        fake_container = MagicMock()
        fake_container.upload_blob = fake_upload_blob
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

    def _reload_status(self, *, marker_created_at: datetime | None, snapshots: list | None = None):
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
            marker_payload = json.dumps(
                {
                    "snapshot_name": "hriv-backup-20260101-020000",
                    "created_at": marker_created_at.isoformat(),
                    "archive_size": 1234,
                    "backup_mode": "production",
                    "tiles_excluded": True,
                }
            ).encode()

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

    def test_missing_marker_is_silent(self):
        self._reload_status(marker_created_at=datetime.now(timezone.utc))
        fake_container = MagicMock()
        fake_container.download_blob.side_effect = backup.ResourceNotFoundError("missing")

        with patch.object(backup, "_blob_container_client", return_value=fake_container), self.assertNoLogs("hriv-backup", level="ERROR"):
            self.assertIsNone(backup._read_last_success_marker())


class SnapshotIdentityTestCase(_BackupTestCase):
    """Collision-resistant snapshot naming and ordering."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.local_dir = Path(self._tmpdir.name) / "backups"
        self.local_dir.mkdir()

    def test_new_name_keeps_timestamp_prefix_and_adds_random_suffix(self):
        self._reload({})
        created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        with patch.object(backup, "_local_backup_dir", return_value=self.local_dir):
            names = {backup._new_snapshot_name(created_at) for _ in range(5)}

        self.assertEqual(len(names), 5)
        for name in names:
            self.assertRegex(name, r"^hriv-backup-20260102-030405-[0-9a-f]{8}$")

    def test_new_name_rerolls_when_candidate_already_exists(self):
        self._reload({})
        created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        (self.local_dir / "hriv-backup-20260102-030405-aaaaaaaa.tar.gz").write_bytes(b"")
        fakes = [
            SimpleNamespace(hex="aaaaaaaa" + "0" * 24),
            SimpleNamespace(hex="bbbbbbbb" + "0" * 24),
        ]

        with (
            patch.object(backup, "_local_backup_dir", return_value=self.local_dir),
            patch.object(backup.uuid, "uuid4", side_effect=fakes),
        ):
            name = backup._new_snapshot_name(created_at)

        self.assertEqual(name, "hriv-backup-20260102-030405-bbbbbbbb")

    def test_sort_key_orders_legacy_and_suffixed_names_chronologically(self):
        self._reload({})
        names = [
            "hriv-backup-20260102-030405-ffffffff.tar.gz",
            "hriv-backup-20260101-000000.tar.gz",
            "hriv-backup-20260102-030405-00000000.tar.gz",
            "hriv-backup-20260103-000000.tar.gz",
        ]
        self.assertEqual(
            sorted(names, key=backup._snapshot_sort_key),
            [
                "hriv-backup-20260101-000000.tar.gz",
                "hriv-backup-20260102-030405-00000000.tar.gz",
                "hriv-backup-20260102-030405-ffffffff.tar.gz",
                "hriv-backup-20260103-000000.tar.gz",
            ],
        )

    def test_resolve_snapshot_name_accepts_exact_stem_and_unique_prefix(self):
        self._reload({})
        available = [
            "hriv-backup-20260101-000000.tar.gz",
            "hriv-backup-20260102-030405-aaaaaaaa.tar.gz",
        ]
        self.assertEqual(
            backup._resolve_snapshot_name("hriv-backup-20260101-000000.tar.gz", available),
            "hriv-backup-20260101-000000.tar.gz",
        )
        self.assertEqual(
            backup._resolve_snapshot_name("hriv-backup-20260101-000000", available),
            "hriv-backup-20260101-000000.tar.gz",
        )
        self.assertEqual(
            backup._resolve_snapshot_name("hriv-backup-20260102-030405", available),
            "hriv-backup-20260102-030405-aaaaaaaa.tar.gz",
        )
        self.assertIsNone(backup._resolve_snapshot_name("hriv-backup-20260104-000000", available))

    def test_resolve_snapshot_name_rejects_ambiguous_prefix(self):
        self._reload({})
        available = [
            "hriv-backup-20260102-030405-aaaaaaaa.tar.gz",
            "hriv-backup-20260102-030405-bbbbbbbb.tar.gz",
        ]
        with self.assertLogs("hriv-backup", level="ERROR"):
            self.assertIsNone(
                backup._resolve_snapshot_name("hriv-backup-20260102-030405", available)
            )


class _FrozenDatetime(datetime):
    """datetime whose now() is pinned so backups share a single second."""

    _now = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls._now


def _fake_pg_dump_run(cmd, **_kwargs):
    if cmd[0] == "pg_dump":
        Path(cmd[cmd.index("-f") + 1]).write_text("dump")
    return MagicMock(returncode=0)


class SameSecondBackupTestCase(_BackupTestCase):
    """Two backups started in the same second must not collide."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmp = Path(self._tmpdir.name)
        self.data_dir = self.tmp / "data"
        (self.data_dir / "source_images").mkdir(parents=True)
        (self.data_dir / "source_images" / "img.jpg").write_bytes(b"source")
        self.local_dir = self.tmp / "backups"
        self.local_dir.mkdir()

    def test_concurrent_local_backups_produce_distinct_archives(self):
        self._reload({"DATA_DIR": str(self.data_dir), "BACKUP_RETENTION_COUNT": "5"})
        results: list[Path] = []
        errors: list[Exception] = []
        barrier = threading.Barrier(2)

        def worker() -> None:
            barrier.wait()
            try:
                result = backup.run_backup()
                if result is not None:
                    results.append(result)
            except Exception as exc:  # pragma: no cover - failure path
                errors.append(exc)

        with (
            patch.object(backup, "datetime", _FrozenDatetime),
            patch.object(backup, "_local_backup_dir", return_value=self.local_dir),
            patch.object(backup.subprocess, "run", side_effect=_fake_pg_dump_run),
        ):
            threads = [threading.Thread(target=worker) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertEqual(len({p.name for p in results}), 2)
        for archive in results:
            self.assertTrue(archive.exists())
            with tarfile.open(archive, "r:gz") as tar:
                names = tar.getnames()
            self.assertTrue(any(n.endswith("data/source_images/img.jpg") for n in names))
            sidecar = self.local_dir / f"{archive.name.removesuffix('.tar.gz')}.manifest.json"
            payload = json.loads(sidecar.read_text())
            self.assertEqual(payload["snapshot_name"], archive.name.removesuffix(".tar.gz"))

    def test_same_second_azure_backups_do_not_overwrite_each_other(self):
        self._reload(
            {
                "DATA_DIR": str(self.data_dir),
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
            }
        )
        uploads: dict[str, bytes] = {}

        def fake_upload_blob(blob_name, data, overwrite=True):
            if not overwrite and blob_name in uploads:
                raise RuntimeError(f"blob already exists: {blob_name}")
            uploads[blob_name] = data.read()

        fake_container = MagicMock()
        fake_container.upload_blob = fake_upload_blob
        fake_container.list_blobs.return_value = []

        with (
            patch.object(backup, "datetime", _FrozenDatetime),
            patch.object(backup, "_local_backup_dir", return_value=self.local_dir),
            patch.object(backup, "_blob_container_client", return_value=fake_container),
            patch.object(backup.subprocess, "run", side_effect=_fake_pg_dump_run),
        ):
            first = backup.run_backup()
            second = backup.run_backup()

        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertNotEqual(first.name, second.name)
        for archive in (first, second):
            stem = archive.name.removesuffix(".tar.gz")
            self.assertIn(f"hriv-backups/{stem}.tar.gz", uploads)
            self.assertIn(f"hriv-backups/{stem}.manifest.json", uploads)


class StagingTestCase(_BackupTestCase):
    """Archives are staged on the backups volume, not pod-local /tmp."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmp = Path(self._tmpdir.name)
        self.local_dir = self.tmp / "backups"
        self.local_dir.mkdir()

    def test_staging_root_defaults_to_backups_volume(self):
        self._reload({})
        with patch.object(backup, "_local_backup_dir", return_value=self.local_dir):
            root = backup._staging_root()
        self.assertEqual(root, self.local_dir / ".staging")
        self.assertTrue(root.is_dir())
        self.assertEqual(list(root.iterdir()), [])

    def test_staging_root_honours_override(self):
        override = self.tmp / "elsewhere"
        self._reload({"BACKUP_STAGING_DIR": str(override)})
        self.assertEqual(backup._staging_root(), override)

    def test_staging_root_falls_back_when_unwritable(self):
        self._reload({"BACKUP_STAGING_DIR": "/proc/hriv-staging"})
        with self.assertLogs("hriv-backup", level="WARNING"):
            self.assertIsNone(backup._staging_root())

    def test_run_backup_stages_on_backups_volume(self):
        data_dir = self.tmp / "data"
        data_dir.mkdir()
        self._reload({"DATA_DIR": str(data_dir)})
        real_temporary_directory = tempfile.TemporaryDirectory
        staging_dirs: list[str | None] = []

        def recording_temporary_directory(*args, **kwargs):
            if kwargs.get("prefix") == backup._STAGING_PREFIX:
                staging_dirs.append(kwargs.get("dir"))
            return real_temporary_directory(*args, **kwargs)

        with (
            patch.object(backup, "_local_backup_dir", return_value=self.local_dir),
            patch.object(backup.tempfile, "TemporaryDirectory", recording_temporary_directory),
            patch.object(backup.subprocess, "run", side_effect=_fake_pg_dump_run),
        ):
            result = backup.run_backup()
            snapshots = backup.list_snapshots()

        self.assertIsNotNone(result)
        self.assertEqual(staging_dirs, [str(self.local_dir / ".staging")])
        self.assertEqual(list((self.local_dir / ".staging").iterdir()), [])
        self.assertEqual([s["name"] for s in snapshots], [result.name])

    def test_sweep_stale_staging_removes_only_old_directories(self):
        self._reload({})
        root = self.local_dir / ".staging"
        root.mkdir()
        stale = root / f"{backup._STAGING_PREFIX}stale"
        fresh = root / f"{backup._STAGING_PREFIX}fresh"
        for directory in (stale, fresh):
            directory.mkdir()
            (directory / "archive.tar.gz").write_bytes(b"partial")
        old = (datetime.now(timezone.utc) - timedelta(hours=48)).timestamp()
        os.utime(stale, (old, old))

        backup._sweep_stale_staging(root)

        self.assertFalse(stale.exists())
        self.assertTrue(fresh.exists())


class NameDerivedRetentionTestCase(_BackupTestCase):
    """Retention orders snapshots by the timestamp in their name."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.local_dir = Path(self._tmpdir.name) / "backups"
        self.local_dir.mkdir()

    def test_azure_retention_ignores_misleading_last_modified(self):
        self._reload(
            {
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
                "BACKUP_RETENTION_COUNT": "1",
            }
        )
        blobs = [
            SimpleNamespace(
                name="hriv-backups/hriv-backup-20260101-000000.tar.gz",
                last_modified=datetime(2026, 3, 1, tzinfo=timezone.utc),
            ),
            SimpleNamespace(
                name="hriv-backups/hriv-backup-20260202-000000-aaaaaaaa.tar.gz",
                last_modified=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ),
        ]
        fake_container = MagicMock()
        fake_container.list_blobs.return_value = blobs

        backup._enforce_retention(fake_container)

        deleted = [call.args[0] for call in fake_container.delete_blob.call_args_list]
        self.assertIn("hriv-backups/hriv-backup-20260101-000000.tar.gz", deleted)
        self.assertNotIn("hriv-backups/hriv-backup-20260202-000000-aaaaaaaa.tar.gz", deleted)

    def test_local_retention_keeps_newest_same_second_snapshots(self):
        self._reload({"BACKUP_RETENTION_COUNT": "2"})
        for name in (
            "hriv-backup-20260101-000000.tar.gz",
            "hriv-backup-20260202-030405-aaaaaaaa.tar.gz",
            "hriv-backup-20260202-030405-bbbbbbbb.tar.gz",
        ):
            (self.local_dir / name).write_bytes(b"archive")

        with patch.object(backup, "_local_backup_dir", return_value=self.local_dir):
            backup._enforce_local_retention()

        self.assertEqual(
            sorted(p.name for p in self.local_dir.glob("hriv-backup-*.tar.gz")),
            [
                "hriv-backup-20260202-030405-aaaaaaaa.tar.gz",
                "hriv-backup-20260202-030405-bbbbbbbb.tar.gz",
            ],
        )


class LegacySnapshotRestoreTestCase(_BackupTestCase):
    """Restore keeps working for old timestamp-only snapshot names."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.local_dir = Path(self._tmpdir.name) / "backups"
        self.local_dir.mkdir()
        for name in (
            "hriv-backup-20260101-000000.tar.gz",
            "hriv-backup-20260202-030405-aaaaaaaa.tar.gz",
        ):
            (self.local_dir / name).write_bytes(b"archive")

    def _restore(self, snapshot_name):
        restored: list[Path] = []

        def fake_restore_from_archive(archive_path, **_kwargs):
            restored.append(archive_path)
            return True

        with (
            patch.object(backup, "_local_backup_dir", return_value=self.local_dir),
            patch.object(backup, "_restore_from_archive", side_effect=fake_restore_from_archive),
        ):
            ok = backup._run_restore_inner(snapshot_name=snapshot_name)
        return ok, [p.name for p in restored]

    def test_restore_accepts_legacy_name(self):
        self._reload({})
        ok, restored = self._restore("hriv-backup-20260101-000000")
        self.assertTrue(ok)
        self.assertEqual(restored, ["hriv-backup-20260101-000000.tar.gz"])

    def test_restore_accepts_suffixed_name_and_timestamp_prefix(self):
        self._reload({})
        for requested in (
            "hriv-backup-20260202-030405-aaaaaaaa.tar.gz",
            "hriv-backup-20260202-030405",
        ):
            ok, restored = self._restore(requested)
            self.assertTrue(ok)
            self.assertEqual(restored, ["hriv-backup-20260202-030405-aaaaaaaa.tar.gz"])

    def test_restore_uses_newest_snapshot_by_name_when_unspecified(self):
        self._reload({})
        ok, restored = self._restore(None)
        self.assertTrue(ok)
        self.assertEqual(restored, ["hriv-backup-20260202-030405-aaaaaaaa.tar.gz"])


class LastSuccessMarkerOrderingTestCase(_BackupTestCase):
    """A slower older backup must not regress the last-success marker."""

    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.local_dir = Path(self._tmpdir.name) / "backups"
        self.local_dir.mkdir()

    def test_older_backup_does_not_overwrite_newer_marker(self):
        self._reload({})
        newer = {
            "snapshot_name": "hriv-backup-20260202-030406-bbbbbbbb",
            "created_at": "2026-02-02T03:04:06+00:00",
        }
        (self.local_dir / "LAST_SUCCESS.json").write_text(json.dumps(newer))

        with patch.object(backup, "_local_backup_dir", return_value=self.local_dir):
            backup._write_last_success_marker(
                "hriv-backup-20260202-030405-aaaaaaaa",
                created_at=datetime(2026, 2, 2, 3, 4, 5, tzinfo=timezone.utc),
                archive_size=1,
            )
            marker = backup._read_last_success_marker()

        self.assertEqual(marker["snapshot_name"], newer["snapshot_name"])


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


if __name__ == "__main__":
    unittest.main()
