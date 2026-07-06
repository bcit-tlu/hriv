"""Unit tests for the HRIV backup service."""

import contextlib
import io
import importlib
import json
import os
import shutil
import sys
import tarfile
import tempfile
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
            self.assertTrue(backup._restore_from_archive(archive))
        self.assertTrue(
            any("mismatch" in msg.lower() for msg in cm.output),
            f"Expected mismatch warning, got: {cm.output}",
        )


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
        self.assertIn(marker_blob, uploads)
        marker = json.loads(uploads[marker_blob].decode())
        self.assertEqual(marker["snapshot_name"], result.name.removesuffix(".tar.gz"))
        self.assertEqual(marker["backup_mode"], "production")
        self.assertTrue(marker["tiles_excluded"])
        self.assertGreater(marker["archive_size"], 0)


class StatusTestCase(_BackupTestCase):
    """Tests for the backup health/status command."""

    def _reload_status(self, *, marker_created_at: datetime | None):
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
        fake_container.list_blobs.return_value = [
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
        if marker_payload is None:
            fake_container.download_blob.side_effect = RuntimeError("missing")
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


if __name__ == "__main__":
    unittest.main()
