"""Unit tests for the HRIV backup service."""

import contextlib
import copy
import hashlib
import hmac
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
        "BACKUP_TIMEZONE",
        "BACKUP_MUTATION_DRAIN_SECONDS",
        "BACKUP_INVENTORY_TIMEOUT_SECONDS",
        "BACKUP_WAL_FENCE_TIMEOUT_SECONDS",
        "BACKUP_WAL_FENCE_POLL_SECONDS",
        "BACKUP_RETENTION_COUNT",
        "AZURE_STORAGE_CONNECTION_STRING",
        "AZURE_STORAGE_CONTAINER",
        "AZURE_READ_SAS_URL",
        "AZURE_BLOB_PREFIX",
        "VALIDATION_MIN_SAS_VALIDITY_SECONDS",
        "BACKUP_STALE_HOURS",
        "BACKUP_STAGING_DIR",
        "DATABASE_URL",
        "CNPG_CLUSTER_NAME",
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
        os.environ["BACKUP_MUTATION_DRAIN_SECONDS"] = "0"
        os.environ["BACKUP_WAL_FENCE_TIMEOUT_SECONDS"] = "600"
        os.environ["BACKUP_WAL_FENCE_POLL_SECONDS"] = "0.001"
        for key, value in env.items():
            os.environ[key] = value
        importlib.reload(backup)

    def _seed_prior_publication(self, local_dir):
        started = datetime(2026, 1, 1, tzinfo=timezone.utc)
        completed = started + timedelta(minutes=1)
        state = backup._new_backup_state("prior", "prior-run")
        for backup_type in ("database", "filesystem"):
            backup._mark_attempt_started(state, backup_type, started_at=started)
            backup._mark_attempt_finished(
                state,
                backup_type,
                started_at=started,
                completed_at=completed,
                success=True,
                size_bytes=1,
                archive_key=f"prior-{backup_type}",
            )
        marker = {
            "snapshot_name": "prior",
            "created_at": started.isoformat(),
            "completed_at": completed.isoformat(),
            "run_id": "prior-run",
            "types": {},
        }
        (local_dir / "BACKUP_STATE.json").write_text(json.dumps(state))
        (local_dir / "LAST_SUCCESS.json").write_text(json.dumps(marker))
        return state, marker


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

    def test_production_cnpg_cluster_defaults_and_override(self):
        self._reload({"BACKUP_MODE": "production"})
        self.assertEqual(backup.CNPG_CLUSTER_NAME, "pg-core")
        self._reload({"BACKUP_MODE": "production", "CNPG_CLUSTER_NAME": "hriv-db"})
        self.assertEqual(backup.CNPG_CLUSTER_NAME, "hriv-db")

    def test_invalid_mode_exits(self):
        with self.assertRaises(SystemExit):
            self._reload({"BACKUP_MODE": "invalid"})

    def test_default_schedule_uses_unambiguous_utc_timezone(self):
        self._reload({})
        self.assertEqual(backup.BACKUP_CRON_SCHEDULE, "0 10 * * *")
        self.assertEqual(backup.BACKUP_TIMEZONE, "UTC")
        self.assertEqual(backup._BACKUP_TZ.key, "UTC")

    def test_invalid_timezone_exits(self):
        with self.assertRaises(SystemExit):
            self._reload({"BACKUP_TIMEZONE": "not/a-timezone"})

    def test_negative_mutation_drain_exits(self):
        with self.assertRaises(SystemExit):
            self._reload({"BACKUP_MUTATION_DRAIN_SECONDS": "-1"})

    def test_inventory_timeout_default_and_validation(self):
        self._reload({})
        self.assertEqual(backup.BACKUP_INVENTORY_TIMEOUT_SECONDS, 120)
        for value in ("0", "-1", "nan", "inf", "invalid"):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                self._reload({"BACKUP_INVENTORY_TIMEOUT_SECONDS": value})

    def test_wal_fence_settings_defaults_and_validation(self):
        self._reload({})
        os.environ.pop("BACKUP_WAL_FENCE_TIMEOUT_SECONDS")
        os.environ.pop("BACKUP_WAL_FENCE_POLL_SECONDS")
        importlib.reload(backup)
        self.assertEqual(backup.BACKUP_WAL_FENCE_TIMEOUT_SECONDS, 600)
        self.assertEqual(backup.BACKUP_WAL_FENCE_POLL_SECONDS, 5)
        for env in (
            {"BACKUP_WAL_FENCE_TIMEOUT_SECONDS": "0"},
            {"BACKUP_WAL_FENCE_POLL_SECONDS": "0"},
            {
                "BACKUP_WAL_FENCE_TIMEOUT_SECONDS": "1",
                "BACKUP_WAL_FENCE_POLL_SECONDS": "2",
            },
            {"BACKUP_WAL_FENCE_TIMEOUT_SECONDS": "invalid"},
            {"BACKUP_WAL_FENCE_POLL_SECONDS": "nan"},
        ):
            with self.subTest(env=env), self.assertRaises(SystemExit):
                self._reload(env)


class MaintenanceScopeTestCase(_BackupTestCase):
    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.data_dir = Path(self._tmpdir.name) / "data"
        self._reload({"DATA_DIR": str(self.data_dir)})

    def test_scope_removes_only_its_own_flag(self):
        with backup._maintenance_scope():
            self.assertTrue(backup._maintenance_flag_path().exists())
        self.assertFalse(backup._maintenance_flag_path().exists())

        backup._maintenance_flag_path().touch()
        with backup._maintenance_scope():
            self.assertTrue(backup._maintenance_flag_path().exists())
        self.assertTrue(backup._maintenance_flag_path().exists())


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
                if isinstance(handler, logging.StreamHandler)
                and handler is not otel_handler
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
        (self.data_dir / "source_images" / "existing.jpg").write_bytes(
            b"existing source"
        )
        (self.data_dir / "tiles").mkdir()
        (self.data_dir / "tiles" / "existing.dzi").write_bytes(b"existing tiles")

    def _build_archive(self, data_subtree, backup_mode="development"):
        snapshot_dir = self.tmp / "snapshot"
        snapshot_dir.mkdir()
        (snapshot_dir / "db.sql").write_text("dump")
        shutil.copytree(data_subtree, snapshot_dir / "data")
        files = {}
        for path in snapshot_dir.rglob("*"):
            if path.is_file():
                files[path.relative_to(snapshot_dir).as_posix()] = {
                    "size": path.stat().st_size,
                    "sha256": backup._sha256(path),
                }
        manifest = {
            "snapshot_name": snapshot_dir.name,
            "created_at": "2026-01-01T00:00:00+00:00",
            "backup_mode": backup_mode,
            "tiles_excluded": backup_mode == "production",
            "files": files,
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
        (archive_data / "source_images" / "restored.jpg").write_bytes(
            b"restored source"
        )
        (archive_data / "tiles").mkdir()
        (archive_data / "tiles" / "restored.dzi").write_bytes(b"restored tiles")
        archive = self._build_archive(archive_data, backup_mode="development")

        with patch.object(
            backup, "_local_backup_dir", return_value=self.tmp / "backups"
        ):
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
        restore_state = json.loads(
            (self.tmp / "backups" / "RESTORE_STATE.json").read_text()
        )
        self.assertTrue(restore_state["operator"]["database"]["success"])
        self.assertTrue(restore_state["operator"]["filesystem"]["success"])

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_production_restore_preserves_tiles(self, _mock_run):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "archive_data"
        archive_data.mkdir()
        (archive_data / "source_images").mkdir()
        (archive_data / "source_images" / "restored.jpg").write_bytes(
            b"restored source"
        )
        (archive_data / "tiles").mkdir()
        (archive_data / "tiles" / "restored.dzi").write_bytes(b"restored tiles")
        archive = self._build_archive(archive_data, backup_mode="development")

        with patch.object(
            backup, "_local_backup_dir", return_value=self.tmp / "backups"
        ):
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
        (archive_data / "source_images" / "restored.jpg").write_bytes(
            b"restored source"
        )
        archive = self._build_archive(archive_data, backup_mode="development")

        with self.assertLogs("hriv-backup", level="WARNING") as cm:
            with patch.object(
                backup, "_local_backup_dir", return_value=self.tmp / "backups"
            ):
                self.assertTrue(backup._restore_from_archive(archive))
        self.assertTrue(
            any("mismatch" in msg.lower() for msg in cm.output),
            f"Expected mismatch warning, got: {cm.output}",
        )

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_restore_returns_false_when_archive_has_no_restorable_components(
        self, _mock_run
    ):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        snapshot_dir = self.tmp / "empty_snapshot"
        snapshot_dir.mkdir()
        (snapshot_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "snapshot_name": "empty_snapshot",
                    "created_at": "2026-01-01T00:00:00+00:00",
                }
            )
        )
        archive = self.tmp / "empty-backup.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(snapshot_dir, arcname="empty_snapshot")

        with patch.object(
            backup, "_local_backup_dir", return_value=self.tmp / "backups"
        ):
            self.assertFalse(backup._restore_from_archive(archive))

    @patch("backup.subprocess.run", return_value=MagicMock(returncode=0))
    def test_restore_persists_state_for_operator_restore(self, _mock_run):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "archive_state"
        archive_data.mkdir()
        (archive_data / "source_images").mkdir()
        (archive_data / "source_images" / "restored.jpg").write_bytes(
            b"restored source"
        )
        archive = self._build_archive(archive_data, backup_mode="development")

        with patch.object(
            backup, "_local_backup_dir", return_value=self.tmp / "backups"
        ):
            self.assertTrue(backup._restore_from_archive(archive))

        state = json.loads((self.tmp / "backups" / "RESTORE_STATE.json").read_text())
        self.assertEqual(state["schema_version"], 1)
        self.assertEqual(state["operator"]["database"]["archive_name"], archive.name)
        self.assertTrue(state["operator"]["database"]["success"])
        self.assertTrue(state["operator"]["filesystem"]["success"])
        self.assertIsNone(state["test"]["database"]["started_at"])

    def test_combined_restore_preflight_requires_both_components_local_and_stream(self):
        archives = []
        for missing in ("database", "filesystem"):
            snapshot = self.tmp / f"missing-{missing}"
            snapshot.mkdir()
            files = {}
            if missing != "database":
                image = snapshot / "data" / "source_images" / "image.jpg"
                image.parent.mkdir(parents=True)
                image.write_bytes(b"image")
                files["data/source_images/image.jpg"] = {
                    "size": image.stat().st_size,
                    "sha256": backup._sha256(image),
                }
            if missing != "filesystem":
                dump = snapshot / "db.sql"
                dump.write_bytes(b"dump")
                files["db.sql"] = {
                    "size": dump.stat().st_size,
                    "sha256": backup._sha256(dump),
                }
            (snapshot / "manifest.json").write_text(json.dumps({"files": files}))
            archive = self.tmp / f"missing-{missing}.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                tar.add(snapshot, arcname=snapshot.name)
            archives.append(archive)

        local_dir = self.tmp / "preflight-state"
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup, "_restore_database_dump") as restore_database,
            patch.object(backup, "_promote_streamed_filesystem") as promote,
        ):
            for archive in archives:
                self.assertFalse(
                    backup._restore_from_archive(
                        archive, components="all", data_dir=str(self.data_dir)
                    )
                )
                self.assertFalse(
                    backup._restore_from_stream(
                        io.BytesIO(archive.read_bytes()),
                        archive.name,
                        purpose="operator",
                        database_url=backup.DATABASE_URL,
                        data_dir=str(self.data_dir),
                        components="all",
                    )
                )
        restore_database.assert_not_called()
        promote.assert_not_called()

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
        (archive_data / "source_images" / "restored.jpg").write_bytes(
            b"restored source"
        )
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

    def test_run_restore_test_requires_only_selected_target_configuration(self):
        database_url = "postgresql://restore:test@db:5432/restore_test"
        data_dir = str(self.tmp / "filesystem-test")
        cases = (
            (
                "filesystem",
                {"RESTORE_TEST_DATA_DIR": data_dir},
                {"database_url": "", "data_dir": data_dir},
            ),
            (
                "database",
                {"RESTORE_TEST_DATABASE_URL": database_url},
                {"database_url": database_url, "data_dir": ""},
            ),
        )
        for components, env, expected in cases:
            with self.subTest(components=components):
                self._reload(env)
                with patch.object(backup, "run_restore", return_value=True) as restore:
                    self.assertTrue(
                        backup.run_restore_test("snapshot", components=components)
                    )
                restore.assert_called_once_with(
                    "snapshot",
                    purpose="test",
                    database_url=expected["database_url"],
                    data_dir=expected["data_dir"],
                    maintenance=False,
                    components=components,
                )
        for env in (
            {"RESTORE_TEST_DATABASE_URL": database_url},
            {"RESTORE_TEST_DATA_DIR": data_dir},
        ):
            self._reload(env)
            with patch.object(backup, "run_restore") as restore:
                self.assertFalse(backup.run_restore_test(components="all"))
            restore.assert_not_called()

    def test_run_restore_inner_does_not_resolve_unselected_production_target(self):
        self._reload({"DATABASE_URL": "production-db", "DATA_DIR": "/production-data"})
        with patch.object(backup, "_local_backup_dir", return_value=self.tmp):
            archive = self.tmp / "hriv-backup-20260101-000000.tar.gz"
            archive.write_bytes(b"unused")
            with patch.object(
                backup, "_restore_from_archive", return_value=True
            ) as restore:
                self.assertTrue(
                    backup._run_restore_inner(
                        archive.name,
                        database_url="test-db",
                        components="database",
                    )
                )
                self.assertEqual(restore.call_args.kwargs["data_dir"], "")
                self.assertTrue(
                    backup._run_restore_inner(
                        archive.name,
                        data_dir="test-data",
                        components="filesystem",
                    )
                )
                self.assertEqual(restore.call_args.kwargs["database_url"], "")

    def test_run_restore_preserves_preexisting_maintenance(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        backup._maintenance_flag_path().touch()
        with patch.object(backup, "_run_restore_inner", return_value=True) as restore:
            self.assertTrue(backup.run_restore("snapshot", components="filesystem"))
        self.assertTrue(backup._maintenance_flag_path().exists())
        restore.assert_called_once_with(
            "snapshot",
            purpose="operator",
            database_url=None,
            data_dir=None,
            components="filesystem",
        )

    def test_cli_restore_filesystem_selects_only_filesystem(self):
        with (
            patch.object(
                sys,
                "argv",
                [
                    "backup.py",
                    "restore-filesystem",
                    "snapshot",
                    "--data-dir",
                    "/restore-target",
                ],
            ),
            patch.object(backup, "run_restore", return_value=True) as restore,
            self.assertRaises(SystemExit) as exited,
        ):
            backup.main()
        self.assertEqual(exited.exception.code, 0)
        restore.assert_called_once_with(
            "snapshot",
            components="filesystem",
            data_dir="/restore-target",
        )

    def test_filesystem_only_restore_never_runs_psql(self):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "filesystem_only"
        (archive_data / "source_images").mkdir(parents=True)
        (archive_data / "source_images" / "restored.jpg").write_bytes(b"restored")
        archive = self._build_archive(archive_data)
        with (
            patch.object(
                backup, "_local_backup_dir", return_value=self.tmp / "backups"
            ),
            patch.object(backup.subprocess, "run") as run,
        ):
            self.assertTrue(
                backup._restore_from_archive(
                    archive, components="filesystem", data_dir=str(self.data_dir)
                )
            )
        run.assert_not_called()

    def test_database_only_restore_does_not_mutate_filesystem(self):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "database_only"
        (archive_data / "source_images").mkdir(parents=True)
        (archive_data / "source_images" / "restored.jpg").write_bytes(b"restored")
        archive = self._build_archive(archive_data)
        with (
            patch.object(
                backup, "_local_backup_dir", return_value=self.tmp / "backups"
            ),
            patch.object(
                backup.subprocess, "run", return_value=MagicMock(returncode=0)
            ),
        ):
            self.assertTrue(
                backup._restore_from_archive(archive, components="database")
            )
        self.assertTrue((self.data_dir / "source_images" / "existing.jpg").exists())
        self.assertFalse((self.data_dir / "source_images" / "restored.jpg").exists())

    def test_failed_logical_database_restore_requires_maintenance(self):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        archive_data = self.tmp / "failed_database"
        archive_data.mkdir()
        archive = self._build_archive(archive_data)
        with (
            patch.object(
                backup, "_local_backup_dir", return_value=self.tmp / "backups"
            ),
            patch.object(backup, "_restore_database_dump", return_value=False),
            self.assertRaises(backup.RestoreSafetyError),
        ):
            backup._restore_from_archive(archive, components="database")

    def test_restore_rejects_unsafe_link_before_side_effects(self):
        self._reload({"DATA_DIR": str(self.data_dir)})
        archive = self.tmp / "unsafe.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            link = tarfile.TarInfo("snapshot/data/source_images/link")
            link.type = tarfile.SYMTYPE
            link.linkname = "/etc/passwd"
            tar.addfile(link)
        local_dir = self.tmp / "backups"
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run") as run,
        ):
            self.assertFalse(
                backup._restore_from_archive(
                    archive, components="filesystem", data_dir=str(self.data_dir)
                )
            )
        run.assert_not_called()
        state = json.loads((local_dir / "RESTORE_STATE.json").read_text())
        self.assertFalse(state["operator"]["filesystem"]["success"])

    def test_restore_rejects_manifest_version_and_checksum(self):
        self._reload({"DATA_DIR": str(self.data_dir)})
        snapshot = self.tmp / "versioned"
        (snapshot / "data" / "source_images").mkdir(parents=True)
        image = snapshot / "data" / "source_images" / "image.jpg"
        image.write_bytes(b"actual")
        for version, digest in ((99, backup._sha256(image)), (2, "0" * 64)):
            (snapshot / "manifest.json").write_text(
                json.dumps(
                    {
                        "schema_version": version,
                        "files": {
                            "data/source_images/image.jpg": {
                                "size": 6,
                                "sha256": digest,
                            }
                        },
                    }
                )
            )
            archive = self.tmp / f"invalid-{version}-{digest[0]}.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                tar.add(snapshot, arcname="snapshot")
            with patch.object(
                backup, "_local_backup_dir", return_value=self.tmp / "backups"
            ):
                self.assertFalse(
                    backup._restore_from_archive(
                        archive, components="filesystem", data_dir=str(self.data_dir)
                    )
                )
        state = json.loads((self.tmp / "backups" / "RESTORE_STATE.json").read_text())
        self.assertFalse(state["operator"]["filesystem"]["success"])
        self.assertTrue((self.data_dir / "source_images" / "existing.jpg").exists())

    def test_azure_chunk_reader_treats_empty_chunk_as_eof(self):
        downloader = SimpleNamespace(chunks=lambda: iter([b""]))
        reader = backup._AzureChunkReader(downloader)
        self.assertEqual(reader.read(1), b"")

    def test_azure_streaming_filesystem_restore_validates_before_promotion(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        payload = b"streamed image"
        manifest = {
            "format_version": 2,
            "schema_version": 2,
            "file_count": 1,
            "total_bytes": len(payload),
            "files": {
                "data/source_images/restored.jpg": {
                    "size": len(payload),
                    "sha256": __import__("hashlib").sha256(payload).hexdigest(),
                }
            },
        }
        archive_bytes = io.BytesIO()
        with tarfile.open(fileobj=archive_bytes, mode="w:gz") as tar:
            for name, content in (
                ("snapshot/data/source_images/restored.jpg", payload),
                ("snapshot/manifest.json", json.dumps(manifest).encode()),
            ):
                info = tarfile.TarInfo(name)
                info.size = len(content)
                tar.addfile(info, io.BytesIO(content))

        class Downloader:
            def chunks(self):
                raw = archive_bytes.getvalue()
                for offset in range(0, len(raw), 17):
                    yield raw[offset : offset + 17]

        real_temporary_directory = tempfile.TemporaryDirectory
        staging_roots = []

        def temporary_directory(*args, **kwargs):
            staging_roots.append(kwargs.get("dir"))
            return real_temporary_directory(*args, **kwargs)

        with (
            patch.object(
                backup, "_local_backup_dir", return_value=self.tmp / "backups"
            ),
            patch.object(
                backup.tempfile, "TemporaryDirectory", side_effect=temporary_directory
            ),
            patch.object(backup.subprocess, "run") as run,
        ):
            self.assertTrue(
                backup._restore_from_stream(
                    backup._AzureChunkReader(Downloader()),
                    "snapshot.tar.gz",
                    purpose="operator",
                    database_url=backup.DATABASE_URL,
                    data_dir=str(self.data_dir),
                    components="filesystem",
                )
            )
        run.assert_not_called()
        self.assertEqual(staging_roots, [str(self.data_dir)])
        self.assertEqual(list(self.data_dir.glob(f"{backup._RESTORE_PREFIX}*")), [])
        self.assertEqual(
            (self.data_dir / "source_images" / "restored.jpg").read_bytes(), payload
        )
        quarantines = list(
            self.data_dir.glob(".restore-orphans-*/source_images/existing.jpg")
        )
        self.assertEqual(len(quarantines), 1)

    def test_current_production_archive_requires_cnpg_for_database_selection(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        snapshot = self.tmp / "production-source-only"
        (snapshot / "data" / "source_images").mkdir(parents=True)
        image = snapshot / "data" / "source_images" / "restored.jpg"
        image.write_bytes(b"restored")
        metadata = {"size": image.stat().st_size, "sha256": backup._sha256(image)}
        (snapshot / "manifest.json").write_text(
            json.dumps(
                {
                    "format_version": 2,
                    "schema_version": 2,
                    "file_count": 1,
                    "total_bytes": image.stat().st_size,
                    "files": {"data/source_images/restored.jpg": metadata},
                    "database_recovery": {
                        "provider": "cloudnative-pg",
                        "cluster": "pg-core",
                        "target_time": "2026-01-01T00:00:00+00:00",
                        "logical_dump_role": "not-included",
                    },
                }
            )
        )
        archive = self.tmp / "production-source-only.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(snapshot, arcname="production-source-only")

        for components in ("database", "all"):
            with (
                patch.object(
                    backup, "_local_backup_dir", return_value=self.tmp / "backups"
                ),
                patch.object(backup.subprocess, "run") as run,
                self.assertLogs("hriv-backup", level="ERROR") as logs,
            ):
                self.assertFalse(
                    backup._restore_from_archive(archive, components=components)
                )
            run.assert_not_called()
            self.assertTrue(
                any("CloudNativePG recovery" in line for line in logs.output)
            )
            self.assertTrue((self.data_dir / "source_images" / "existing.jpg").exists())
            self.assertFalse(
                (self.data_dir / "source_images" / "restored.jpg").exists()
            )

    def test_manifestless_local_and_stream_restore_fail_before_side_effects(self):
        snapshot = self.tmp / "manifestless"
        (snapshot / "data" / "source_images").mkdir(parents=True)
        (snapshot / "data" / "source_images" / "new.jpg").write_bytes(b"new")
        archive = self.tmp / "manifestless.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(snapshot, arcname="manifestless")
        local_dir = self.tmp / "backups"
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run") as run,
        ):
            self.assertFalse(
                backup._restore_from_archive(
                    archive, components="filesystem", data_dir=str(self.data_dir)
                )
            )
            self.assertFalse(
                backup._restore_from_stream(
                    io.BytesIO(archive.read_bytes()),
                    archive.name,
                    purpose="operator",
                    database_url=backup.DATABASE_URL,
                    data_dir=str(self.data_dir),
                    components="filesystem",
                )
            )
        run.assert_not_called()
        state = json.loads((local_dir / "RESTORE_STATE.json").read_text())
        self.assertFalse(state["operator"]["filesystem"]["success"])
        self.assertIsNotNone(state["operator"]["filesystem"]["completed_at"])
        self.assertTrue((self.data_dir / "source_images" / "existing.jpg").exists())
        self.assertFalse((self.data_dir / "source_images" / "new.jpg").exists())

    def test_empty_v2_recovery_set_restores_empty_source_images_local_and_stream(self):
        manifest = {
            "format_version": 2,
            "schema_version": 2,
            "file_count": 0,
            "total_bytes": 0,
            "files": {},
            "source_images": {"file_count": 0, "total_bytes": 0, "files": {}},
        }
        snapshot = self.tmp / "empty-v2"
        snapshot.mkdir()
        (snapshot / "manifest.json").write_text(json.dumps(manifest))
        archive = self.tmp / "empty-v2.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(snapshot, arcname="empty-v2")

        with patch.object(
            backup, "_local_backup_dir", return_value=self.tmp / "backups"
        ):
            self.assertTrue(
                backup._restore_from_archive(
                    archive, components="filesystem", data_dir=str(self.data_dir)
                )
            )
        self.assertEqual(list((self.data_dir / "source_images").iterdir()), [])
        self.assertEqual(
            len(
                list(
                    self.data_dir.glob(".restore-orphans-*/source_images/existing.jpg")
                )
            ),
            1,
        )

        (self.data_dir / "source_images" / "again.jpg").write_bytes(b"again")
        self.assertTrue(
            backup._restore_from_stream(
                io.BytesIO(archive.read_bytes()),
                archive.name,
                purpose="operator",
                database_url=backup.DATABASE_URL,
                data_dir=str(self.data_dir),
                components="filesystem",
            )
        )
        self.assertEqual(list((self.data_dir / "source_images").iterdir()), [])
        self.assertEqual(
            len(list(self.data_dir.glob(".restore-orphans-*/source_images/again.jpg"))),
            1,
        )

    def test_combined_local_restore_keeps_maintenance_after_database_commit(self):
        archive_data = self.tmp / "mixed-local"
        (archive_data / "source_images").mkdir(parents=True)
        (archive_data / "source_images" / "new.jpg").write_bytes(b"new")
        archive = self._build_archive(archive_data)
        local_dir = self.tmp / "backups"
        local_dir.mkdir()
        shutil.copy2(archive, local_dir / archive.name)
        self._reload({"DATA_DIR": str(self.data_dir)})

        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(
                backup.subprocess, "run", return_value=MagicMock(returncode=0)
            ),
            patch.object(
                backup,
                "_promote_streamed_filesystem",
                side_effect=OSError("promotion failed"),
            ),
        ):
            with self.assertRaises(backup.RestoreSafetyError):
                backup.run_restore(archive.name, components="all")
        self.assertTrue(backup._maintenance_flag_path().exists())
        state = json.loads((local_dir / "RESTORE_STATE.json").read_text())
        self.assertTrue(state["operator"]["database"]["success"])
        self.assertFalse(state["operator"]["filesystem"]["success"])

    def test_combined_stream_restore_is_safety_error_after_database_commit(self):
        archive_data = self.tmp / "mixed-stream"
        (archive_data / "source_images").mkdir(parents=True)
        (archive_data / "source_images" / "new.jpg").write_bytes(b"new")
        archive = self._build_archive(archive_data)
        local_dir = self.tmp / "backups"
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(
                backup.subprocess, "run", return_value=MagicMock(returncode=0)
            ),
            patch.object(
                backup,
                "_promote_streamed_filesystem",
                side_effect=OSError("promotion failed"),
            ),
        ):
            with self.assertRaises(backup.RestoreSafetyError):
                backup._restore_from_stream(
                    io.BytesIO(archive.read_bytes()),
                    archive.name,
                    purpose="operator",
                    database_url=backup.DATABASE_URL,
                    data_dir=str(self.data_dir),
                    components="all",
                )
        state = json.loads((local_dir / "RESTORE_STATE.json").read_text())
        self.assertTrue(state["operator"]["database"]["success"])
        self.assertFalse(state["operator"]["filesystem"]["success"])

    def test_promotion_quarantines_all_active_unmatched_entries_and_preserves_exceptions(
        self,
    ):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        target = self.tmp / "promotion-complete"
        workspace = target / f"{backup._RESTORE_PREFIX}active"
        staged = workspace / "data"
        (staged / "source_images").mkdir(parents=True)
        (staged / "source_images" / "new.jpg").write_bytes(b"new")
        (target / "source_images").mkdir(parents=True)
        (target / "source_images" / "old.jpg").write_bytes(b"old")
        (target / "unmatched-dir").mkdir()
        (target / "unmatched-dir" / "value").write_text("old dir")
        (target / "unmatched.txt").write_text("old file")
        (target / backup._MAINTENANCE_FILENAME).touch()
        (target / "tiles").mkdir()
        (target / "tiles" / "keep").write_text("tile")
        prior_quarantine = target / ".restore-orphans-prior"
        prior_quarantine.mkdir()
        (prior_quarantine / "keep").write_text("prior")

        backup._promote_streamed_filesystem(staged, str(target), "current")

        quarantine = target / ".restore-orphans-current"
        self.assertTrue((quarantine / "source_images" / "old.jpg").exists())
        self.assertTrue((quarantine / "unmatched-dir" / "value").exists())
        self.assertTrue((quarantine / "unmatched.txt").exists())
        self.assertEqual((target / "source_images" / "new.jpg").read_bytes(), b"new")
        self.assertTrue((target / backup._MAINTENANCE_FILENAME).exists())
        self.assertTrue((target / "tiles" / "keep").exists())
        self.assertTrue((workspace).exists())
        self.assertTrue((prior_quarantine / "keep").exists())

    def test_promotion_failure_rolls_back_all_prior_moves(self):
        staged = self.tmp / "staged"
        target = self.tmp / "promotion-target"
        for root, prefix in ((staged, "new"), (target, "old")):
            for name in ("a", "b"):
                (root / name).mkdir(parents=True, exist_ok=True)
                (root / name / "value").write_text(f"{prefix}-{name}")
        real_replace = os.replace
        calls = 0

        def fail_second_promotion(source, destination):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise OSError("second promotion failed")
            return real_replace(source, destination)

        with patch.object(backup.os, "replace", side_effect=fail_second_promotion):
            with self.assertRaisesRegex(OSError, "second promotion failed"):
                backup._promote_streamed_filesystem(staged, str(target), "rollback")
        for name in ("a", "b"):
            self.assertEqual((target / name / "value").read_text(), f"old-{name}")
            self.assertEqual((staged / name / "value").read_text(), f"new-{name}")

    def test_rollback_failure_is_critical_and_keeps_maintenance(self):
        staged = self.tmp / "critical-staged"
        target = self.tmp / "critical-target"
        for root, prefix in ((staged, "new"), (target, "old")):
            for name in ("a", "b"):
                (root / name).mkdir(parents=True, exist_ok=True)
                (root / name / "value").write_text(f"{prefix}-{name}")
        real_replace = os.replace
        calls = 0

        def fail_promotion_and_rollback(source, destination):
            nonlocal calls
            calls += 1
            if calls in (4, 5):
                raise OSError(f"replace failure {calls}")
            return real_replace(source, destination)

        with patch.object(
            backup.os, "replace", side_effect=fail_promotion_and_rollback
        ):
            with self.assertRaises(backup.RestoreSafetyError):
                backup._promote_streamed_filesystem(staged, str(target), "critical")

        self._reload({"DATA_DIR": str(self.data_dir)})
        with patch.object(
            backup,
            "_run_restore_inner",
            side_effect=backup.RestoreSafetyError("target safety unknown"),
        ):
            with self.assertRaises(backup.RestoreSafetyError):
                backup.run_restore(components="filesystem")
        self.assertTrue(backup._maintenance_flag_path().exists())


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

    def test_local_publication_state_or_marker_failure_restores_prior_documents(self):
        for failure in ("state", "marker"):
            with self.subTest(failure=failure):
                local_dir = self.tmp / f"backups-{failure}"
                local_dir.mkdir()
                prior_state, prior_marker = self._seed_prior_publication(local_dir)
                self._reload(
                    {"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)}
                )
                inventory_run, _commands = _production_inventory_run(self.data_dir)
                real_write_state = backup._write_backup_state

                def write_state(state):
                    if (
                        failure == "state"
                        and state["filesystem"].get("success") is True
                    ):
                        return False
                    return real_write_state(state)

                def write_marker(*args, **kwargs):
                    if failure == "marker":
                        return False
                    return backup._commit_shared_json(
                        local_path=backup._last_success_marker_path(),
                        blob_name=backup._last_success_marker_blob_name(),
                        incoming={
                            "snapshot_name": args[0],
                            "created_at": kwargs["created_at"].isoformat(),
                            "completed_at": kwargs["completed_at"].isoformat(),
                            "run_id": kwargs["run_id"],
                            "types": backup._marker_types_from_state(
                                kwargs["state"], args[0]
                            ),
                        },
                        merge=backup._merge_last_success_marker,
                        label="last-success marker",
                    )

                with (
                    patch.object(backup, "_local_backup_dir", return_value=local_dir),
                    patch.object(backup.subprocess, "run", side_effect=inventory_run),
                    patch.object(
                        backup, "_write_backup_state", side_effect=write_state
                    ),
                    patch.object(
                        backup, "_write_last_success_marker", side_effect=write_marker
                    ),
                ):
                    self.assertIsNone(backup.run_backup())
                restored_state = json.loads(
                    (local_dir / "BACKUP_STATE.json").read_text()
                )
                self.assertEqual(restored_state, prior_state)
                self.assertEqual(
                    json.loads((local_dir / "LAST_SUCCESS.json").read_text()),
                    prior_marker,
                )
                self.assertEqual(list(local_dir.glob("*.tar.gz")), [])
                self.assertEqual(list(local_dir.glob("*.manifest.json")), [])

    def test_publication_rollback_does_not_overwrite_newer_owner(self):
        local_dir = self.tmp / "ownership"
        local_dir.mkdir()
        current = {"run_id": "newer", "value": 2}
        (local_dir / "BACKUP_STATE.json").write_text(json.dumps(current))
        with patch.object(backup, "_local_backup_dir", return_value=local_dir):
            self.assertFalse(
                backup._rollback_shared_json_if_owned(
                    local_path=backup._backup_state_path(),
                    blob_name=backup._backup_state_blob_name(),
                    previous={"run_id": "older", "value": 1},
                    run_id="failed-run",
                    label="backup state",
                )
            )
        self.assertEqual(
            json.loads((local_dir / "BACKUP_STATE.json").read_text()), current
        )

    def test_azure_publish_failure_deletes_candidate_and_rolls_back_documents(self):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "DATA_DIR": str(self.data_dir),
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
            }
        )
        local_dir = self.tmp / "publish-failure"
        blob = MagicMock()
        container = MagicMock()
        container.get_blob_client.return_value = blob
        container.list_blobs.return_value = []
        inventory_run, _commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup, "_blob_container_client", return_value=container),
            patch.object(backup, "_read_backup_state", return_value=None),
            patch.object(backup, "_read_last_success_marker", return_value=None),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
            patch.object(backup, "_write_backup_state", return_value=True),
            patch.object(backup, "_write_last_success_marker", return_value=True),
            patch.object(backup, "_documents_owned_by_run", return_value=(True, True)),
            patch.object(
                backup._StagedBlockWriter,
                "publish",
                side_effect=RuntimeError("publish failed"),
            ),
            patch.object(backup, "_rollback_publication_documents") as rollback,
        ):
            self.assertIsNone(backup.run_backup())
        blob.delete_blob.assert_called_once_with()
        self.assertTrue(
            any(
                call.args[0].endswith(".manifest.json")
                for call in container.delete_blob.call_args_list
            )
        )
        rollback.assert_called_once()

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

        def fake_upload_blob(
            blob_name, data, overwrite=True, etag=None, match_condition=None
        ):
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

        staged: dict[str, list[bytes]] = {}
        commit_conditions = []
        published_metadata = []

        class FakeBlobClient:
            def __init__(self, name):
                self.name = name

            def stage_block(self, block_id, data, length):
                staged.setdefault(self.name, []).append(data.read())

            def commit_block_list(self, block_ids, if_none_match=None, metadata=None):
                commit_conditions.append((if_none_match, metadata))
                payload = b"".join(staged[self.name])
                uploads[self.name] = payload
                uploaded_path.write_bytes(payload)

            def set_blob_metadata(self, metadata):
                self.metadata = metadata
                published_metadata.append(metadata)

            def delete_blob(self):
                uploads.pop(self.name, None)

        fake_container = MagicMock()
        fake_container.upload_blob = fake_upload_blob
        fake_container.download_blob = fake_download_blob
        fake_container.get_blob_client.side_effect = FakeBlobClient
        fake_container.list_blobs.return_value = []
        fake_container.delete_blob.side_effect = lambda name, **_kwargs: uploads.pop(
            name, None
        )

        local_dir = self.tmp / "backups"
        inventory_run, commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup, "_blob_container_client", return_value=fake_container),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
        ):
            result = backup.run_backup()
        self.assertTrue(any(cmd[0] == "psql" for cmd in commands))
        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))
        self.assertIsNotNone(result)
        self.assertTrue(uploaded_path.exists())
        self.assertEqual(list(local_dir.glob("*.tar.gz")), [])
        with tarfile.open(uploaded_path, "r:gz") as tar:
            names = tar.getnames()
        self.assertTrue(any("data/source_images/img.jpg" in n for n in names))
        self.assertFalse(any("data/tiles" in n for n in names))
        self.assertFalse(any(name.endswith("db.sql") for name in names))
        marker_blob = "hriv-backups/LAST_SUCCESS.json"
        state_blob = "hriv-backups/BACKUP_STATE.json"
        self.assertIn(marker_blob, uploads)
        self.assertIn(state_blob, uploads)
        sidecar_blob = (
            f"hriv-backups/{result.name.removesuffix('.tar.gz')}.manifest.json"
        )
        self.assertIn(sidecar_blob, uploads)
        self.assertFalse(any("/.publication-" in name for name in uploads))
        archive_blob = f"hriv-backups/{result.name}"
        upload_order = list(uploads)
        self.assertEqual(
            commit_conditions,
            [("*", {"hriv_publication_state": "candidate"})],
        )
        self.assertEqual(
            published_metadata,
            [{"hriv_publication_state": "published"}],
        )
        self.assertLess(
            upload_order.index(archive_blob), upload_order.index(sidecar_blob)
        )
        self.assertLess(
            upload_order.index(sidecar_blob), upload_order.index(marker_blob)
        )
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
        self.assertTrue(
            state["database"]["last_success_archive_key"].startswith(
                "cnpg://pg-core?target_time="
            )
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

        inventory_run, commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
        ):
            result = backup.run_backup()
        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))

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
        self.assertTrue(
            state["database"]["last_success_archive_key"].startswith(
                "cnpg://pg-core?target_time="
            )
        )

    def test_run_backup_marker_records_completion_and_per_type_success(self):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "DATA_DIR": str(self.data_dir),
            }
        )
        local_dir = self.tmp / "backups"
        local_dir.mkdir()

        inventory_run, commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
        ):
            result = backup.run_backup()
        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))

        marker = json.loads((local_dir / "LAST_SUCCESS.json").read_text())
        state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
        self.assertEqual(marker["snapshot_name"], result.name.removesuffix(".tar.gz"))
        self.assertGreaterEqual(marker["completed_at"], marker["created_at"])
        self.assertEqual(marker["run_id"], state["run_id"])
        self.assertEqual(sorted(marker["types"]), ["database", "filesystem"])
        self.assertEqual(
            marker["types"]["filesystem"]["archive_key"], str(local_dir / result.name)
        )
        self.assertEqual(state["database"]["run_id"], state["run_id"])
        self.assertEqual(
            sorted(entry["backup_type"] for entry in state["attempts"]),
            ["database", "filesystem"],
        )

    def test_development_pg_dump_failure_updates_backup_state(self):
        self._reload(
            {
                "BACKUP_MODE": "development",
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

    def test_development_archive_keeps_logical_dump(self):
        self._reload({"BACKUP_MODE": "development", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "backups"
        commands = []

        def tracked_dump(cmd, **kwargs):
            commands.append(cmd)
            return _fake_pg_dump_run(cmd, **kwargs)

        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=tracked_dump),
        ):
            result = backup.run_backup()
        self.assertFalse(any(cmd[0] == "psql" for cmd in commands))
        with tarfile.open(result, "r:gz") as tar:
            self.assertTrue(any(name.endswith("/db.sql") for name in tar.getnames()))
        manifest = json.loads(
            (
                local_dir / f"{result.name.removesuffix('.tar.gz')}.manifest.json"
            ).read_text()
        )
        self.assertEqual(manifest["database_recovery"]["provider"], "logical-dump")
        self.assertEqual(manifest["database_recovery"]["logical_dump_role"], "primary")

    def test_backup_state_preserves_previous_success_history_on_filesystem_failure(
        self,
    ):
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

        inventory_run, commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
            patch.object(
                backup.tarfile, "open", side_effect=RuntimeError("tar failed")
            ),
        ):
            result = backup.run_backup()

        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))
        self.assertIsNone(result)
        state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
        self.assertFalse(state["database"]["success"])
        self.assertFalse(state["filesystem"]["success"])
        self.assertEqual(state["database"]["last_success_archive_key"], "old-db")
        self.assertEqual(
            state["filesystem"]["last_success_completed_at"],
            "2026-07-11T08:09:00+00:00",
        )
        self.assertEqual(state["filesystem"]["last_success_archive_key"], "old-fs")

    def test_mutation_leaves_azure_blocks_uncommitted_and_no_sidecar_or_marker(self):
        self._reload(
            {
                "BACKUP_MODE": "production",
                "DATA_DIR": str(self.data_dir),
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
            }
        )
        local_dir = self.tmp / "backups"
        events = []

        class Blob:
            def stage_block(self, block_id, data, length):
                events.append("stage")

            def commit_block_list(self, block_ids, if_none_match=None, metadata=None):
                events.append("commit")

            def set_blob_metadata(self, metadata):
                events.append("publish")

            def delete_blob(self):
                events.append("delete")

        container = MagicMock()
        container.get_blob_client.return_value = Blob()
        container.list_blobs.return_value = []
        container.download_blob.side_effect = backup.ResourceNotFoundError("missing")
        container.upload_blob.side_effect = (
            lambda name, *_args, **_kwargs: events.append(name)
        )
        real_add = backup._add_streamed_file

        def disappear(tar, snapshot_name, entry):
            if entry["archive_path"].startswith("data/"):
                entry["path"].unlink()
            return real_add(tar, snapshot_name, entry)

        inventory_run, commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup, "_blob_container_client", return_value=container),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
            patch.object(backup, "_add_streamed_file", side_effect=disappear),
        ):
            self.assertIsNone(backup.run_backup())
        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))
        self.assertNotIn("commit", events)
        self.assertFalse(any(str(event).endswith(".manifest.json") for event in events))
        self.assertFalse(
            any(str(event).endswith("LAST_SUCCESS.json") for event in events)
        )

    def test_inventory_boundary_released_before_stream_and_excludes_new_files(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "backups"
        real_add = backup._add_streamed_file
        maintenance_during_stream = []

        def observe(tar, snapshot_name, entry):
            maintenance_during_stream.append(backup._maintenance_flag_path().exists())
            if entry["archive_path"].startswith("data/"):
                (self.data_dir / "source_images" / "late.jpg").write_bytes(b"late")
            return real_add(tar, snapshot_name, entry)

        inventory_run, commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
            patch.object(backup, "_add_streamed_file", side_effect=observe),
        ):
            result = backup.run_backup()
        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))
        self.assertTrue(result)
        self.assertEqual(maintenance_during_stream, [False])
        with tarfile.open(result, "r:gz") as tar:
            self.assertFalse(any(name.endswith("late.jpg") for name in tar.getnames()))

    def test_production_manifest_declares_cnpg_primary_and_authoritative_inventory(
        self,
    ):
        (self.data_dir / "admin").mkdir()
        (self.data_dir / "admin" / "scratch.jpg").write_bytes(b"scratch")
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "backups"
        inventory_run, commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
        ):
            result = backup.run_backup()
        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))
        manifest = json.loads(
            (
                local_dir / f"{result.stem.removesuffix('.tar')}.manifest.json"
            ).read_text()
        )
        self.assertEqual(manifest["format_version"], 2)
        self.assertEqual(manifest["schema_version"], 2)
        self.assertEqual(
            manifest["recovery_set_id"], result.name.removesuffix(".tar.gz")
        )
        self.assertEqual(manifest["database_recovery"]["provider"], "cloudnative-pg")
        self.assertEqual(manifest["database_recovery"]["cluster"], "pg-core")
        self.assertEqual(
            manifest["database_recovery"]["logical_dump_role"], "not-included"
        )
        self.assertEqual(manifest["file_count"], 1)
        self.assertEqual(manifest["total_bytes"], len(b"source"))
        self.assertIn("data/source_images/img.jpg", manifest["files"])
        self.assertNotIn("db.sql", manifest["files"])
        self.assertNotIn("data/admin/scratch.jpg", manifest["files"])
        self.assertEqual(manifest["source_images"]["file_count"], 1)
        self.assertEqual(manifest["source_images"]["total_bytes"], len(b"source"))
        self.assertTrue(manifest["capture_started_at"])
        self.assertTrue(manifest["capture_boundary_at"])
        self.assertEqual(manifest["capture_boundary_lsn"], "0/5000000")
        self.assertTrue(manifest["completed_at"])
        recovery = manifest["database_recovery"]
        self.assertEqual(recovery["target_lsn"], "0/5000000")
        self.assertEqual(recovery["archive_timeout_seconds"], 300)
        self.assertEqual(recovery["wal_fence_file"], "000000010000000000000006")
        self.assertEqual(
            recovery["wal_fence_committed_at"], "2026-01-02T03:04:06+00:00"
        )
        self.assertEqual(recovery["wal_fence_archived_at"], "2026-01-02T03:04:07+00:00")
        psql_commands = [cmd for cmd in commands if cmd[0] == "psql"]
        self.assertTrue(all("--quiet" in cmd for cmd in psql_commands))
        psql_queries = [cmd[-1] for cmd in psql_commands]
        self.assertIn("archive_timeout", psql_queries[0])
        inventory_query = psql_queries[1]
        self.assertLess(
            inventory_query.index("BEGIN;"),
            inventory_query.index("SET LOCAL lock_timeout"),
        )
        self.assertLess(
            inventory_query.index("SET LOCAL lock_timeout"),
            inventory_query.index("SET LOCAL statement_timeout"),
        )
        self.assertLess(
            inventory_query.index("SET LOCAL statement_timeout"),
            inventory_query.index("LOCK TABLE"),
        )
        self.assertLess(
            inventory_query.index("LOCK TABLE"), inventory_query.index("COPY (")
        )
        self.assertIn("SET LOCAL lock_timeout = '120000ms'", inventory_query)
        self.assertIn("SET LOCAL statement_timeout = '120000ms'", inventory_query)
        self.assertLess(
            inventory_query.index("COPY ("), inventory_query.index("COMMIT;")
        )
        self.assertIn("LOCK TABLE public.source_images IN SHARE MODE", inventory_query)
        self.assertIn("AT TIME ZONE 'UTC'", inventory_query)
        self.assertIn("UPDATE public.backup_recovery_wal_fence", psql_queries[2])
        self.assertIn("generation = generation + 1", psql_queries[2])
        self.assertIn("fenced_at = CURRENT_TIMESTAMP", psql_queries[2])
        self.assertIn("TO STDOUT WITH (FORMAT csv, HEADER true)", psql_queries[2])
        self.assertIn("pg_walfile_name", psql_queries[3])
        self.assertIn("AT TIME ZONE 'UTC'", psql_queries[3])
        self.assertIn("pg_stat_archiver", psql_queries[4])
        self.assertIn("AT TIME ZONE 'UTC'", psql_queries[4])


class AzurePublicationTestCase(_BackupTestCase):
    def setUp(self):
        super().setUp()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmp = Path(self._tmpdir.name)
        self.data_dir = self.tmp / "data"
        (self.data_dir / "source_images").mkdir(parents=True)
        (self.data_dir / "source_images" / "img.jpg").write_bytes(b"source")
        (self.data_dir / "tiles").mkdir()
        (self.data_dir / "tiles" / "img.dzi").write_bytes(b"tiles")

    def test_hashing_reader_accepts_zero_length_read(self):
        reader = backup._HashingReader(io.BytesIO(b"payload"), len(b"payload"))
        self.assertEqual(reader.read(0), b"")
        self.assertEqual(reader.remaining, len(b"payload"))

    def test_candidate_archives_are_not_selectable(self):
        candidate = SimpleNamespace(metadata={"hriv_publication_state": "candidate"})
        published = SimpleNamespace(metadata={"hriv_publication_state": "published"})
        unknown = SimpleNamespace(metadata={"hriv_publication_state": "future"})
        legacy_empty = SimpleNamespace(metadata={})
        legacy_absent = SimpleNamespace(metadata=None)

        self.assertFalse(backup._archive_is_selectable(candidate))
        self.assertFalse(backup._archive_is_selectable(unknown))
        self.assertTrue(backup._archive_is_selectable(published))
        self.assertTrue(backup._archive_is_selectable(legacy_empty))
        self.assertTrue(backup._archive_is_selectable(legacy_absent))

    def test_explicit_unknown_state_is_hidden_from_list_retention_and_status(self):
        self._reload(
            {
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
                "BACKUP_RETENTION_COUNT": "1",
            }
        )
        now = datetime.now(timezone.utc)
        blobs = [
            SimpleNamespace(
                name=f"hriv-backups/{name}.tar.gz",
                metadata=metadata,
                last_modified=now + timedelta(minutes=index),
                size=1,
            )
            for index, (name, metadata) in enumerate(
                (
                    ("hriv-backup-20260101-000000-legacy", None),
                    (
                        "hriv-backup-20260102-000000-published",
                        {"hriv_publication_state": "published"},
                    ),
                    (
                        "hriv-backup-20260103-000000-candidate",
                        {"hriv_publication_state": "candidate"},
                    ),
                    (
                        "hriv-backup-20260104-000000-future",
                        {"hriv_publication_state": "future"},
                    ),
                )
            )
        ]
        container = MagicMock()
        container.list_blobs.return_value = blobs
        container.download_blob.side_effect = backup.ResourceNotFoundError("missing")
        with patch.object(backup, "_blob_container_client", return_value=container):
            snapshots = backup.list_snapshots()
            backup._enforce_retention(container)
            with (
                patch.object(
                    backup,
                    "_read_last_success_marker",
                    return_value={
                        "snapshot_name": "hriv-backup-20260104-000000-future",
                        "created_at": now.isoformat(),
                        "completed_at": now.isoformat(),
                    },
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertFalse(backup.run_status())
        self.assertEqual(
            [snapshot["name"] for snapshot in snapshots],
            [
                "hriv-backup-20260102-000000-published.tar.gz",
                "hriv-backup-20260101-000000-legacy.tar.gz",
            ],
        )
        deleted = [call.args[0] for call in container.delete_blob.call_args_list]
        self.assertIn("hriv-backups/hriv-backup-20260101-000000-legacy.tar.gz", deleted)
        self.assertFalse(
            any(
                "candidate.tar.gz" in name or "future.tar.gz" in name
                for name in deleted
            )
        )

    def test_empty_azure_writer_cannot_commit(self):
        with self.assertRaisesRegex(RuntimeError, "empty Azure archive"):
            backup._StagedBlockWriter(MagicMock()).commit()

    def test_committed_unpublished_candidate_can_be_discarded(self):
        blob = MagicMock()
        writer = backup._StagedBlockWriter(blob, block_size=4)
        writer.write(b"payload")
        writer.commit()
        writer.discard_candidate()

        blob.commit_block_list.assert_called_once_with(
            writer.block_ids,
            if_none_match="*",
            metadata={"hriv_publication_state": "candidate"},
        )
        blob.delete_blob.assert_called_once_with()

    def test_local_journal_reconciliation_handles_final_rename_crash_points(self):
        self._reload({})
        for crash_after in ("sidecar", "archive"):
            with self.subTest(crash_after=crash_after):
                root = self.tmp / f"local-{crash_after}"
                root.mkdir()
                snapshot = f"snapshot-{crash_after}"
                candidate_archive = root / f".{snapshot}.tar.gz.run.candidate"
                candidate_sidecar = root / f".{snapshot}.manifest.json.run.candidate"
                final_archive = root / f"{snapshot}.tar.gz"
                final_sidecar = root / f"{snapshot}.manifest.json"
                if crash_after == "sidecar":
                    candidate_archive.write_bytes(b"archive")
                    final_sidecar.write_bytes(b"manifest")
                else:
                    final_archive.write_bytes(b"archive")
                    final_sidecar.write_bytes(b"manifest")
                journal = {
                    "schema_version": 1,
                    "snapshot_name": snapshot,
                    "run_id": "run",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "phase": "marker_written",
                    "archive_name": candidate_archive.name,
                    "sidecar_name": candidate_sidecar.name,
                    "final_archive_name": final_archive.name,
                    "final_sidecar_name": final_sidecar.name,
                    "prior_backup_state": None,
                    "prior_last_success": None,
                }
                journal_path = root / f".publication-{snapshot}.json"
                journal_path.write_text(json.dumps(journal))
                with (
                    patch.object(backup, "_local_backup_dir", return_value=root),
                    patch.object(
                        backup, "_documents_owned_by_run", return_value=(True, True)
                    ),
                ):
                    backup._reconcile_local_publications()
                self.assertTrue(final_archive.exists())
                self.assertTrue(final_sidecar.exists())
                self.assertFalse(journal_path.exists())
                self.assertFalse(candidate_archive.exists())
                self.assertFalse(candidate_sidecar.exists())

    def test_local_partial_journal_rollback_removes_all_artifact_paths(self):
        self._reload({})
        root = self.tmp / "local-partial"
        root.mkdir()
        snapshot = "snapshot-partial"
        names = {
            "archive_name": f".{snapshot}.tar.gz.run.candidate",
            "sidecar_name": f".{snapshot}.manifest.json.run.candidate",
            "final_archive_name": f"{snapshot}.tar.gz",
            "final_sidecar_name": f"{snapshot}.manifest.json",
        }
        for name in names.values():
            (root / name).write_bytes(b"partial")
        journal = {
            "schema_version": 1,
            "snapshot_name": snapshot,
            "run_id": "run",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "phase": "state_written",
            **names,
            "prior_backup_state": {"run_id": "prior"},
            "prior_last_success": {"run_id": "prior"},
        }
        journal_path = root / f".publication-{snapshot}.json"
        journal_path.write_text(json.dumps(journal))
        with (
            patch.object(backup, "_local_backup_dir", return_value=root),
            patch.object(backup, "_documents_owned_by_run", return_value=(True, False)),
            patch.object(backup, "_rollback_publication_documents") as rollback,
        ):
            backup._reconcile_local_publications()
        rollback.assert_called_once()
        self.assertFalse(journal_path.exists())
        self.assertFalse(any((root / name).exists() for name in names.values()))

    def _journal_fixture(self):
        snapshot = "hriv-backup-20260101-000000-journal"
        archive = f"hriv-backups/{snapshot}.tar.gz"
        sidecar = f"hriv-backups/{snapshot}.manifest.json"
        journal_name = f"hriv-backups/.publication-{snapshot}.json"
        created = datetime.now(timezone.utc) - timedelta(hours=1)
        journal = {
            "schema_version": 1,
            "snapshot_name": snapshot,
            "run_id": "journal-run",
            "created_at": created.isoformat(),
            "phase": "marker_written",
            "archive_name": archive,
            "sidecar_name": sidecar,
            "prior_backup_state": {"run_id": "prior-state"},
            "prior_last_success": {"run_id": "prior-marker"},
        }
        blobs = [
            SimpleNamespace(
                name=archive,
                metadata={"hriv_publication_state": "candidate"},
                last_modified=created,
            ),
            SimpleNamespace(name=sidecar, metadata=None, last_modified=created),
            SimpleNamespace(name=journal_name, metadata=None, last_modified=created),
        ]
        container = MagicMock()
        container.list_blobs.return_value = blobs
        container.download_blob.return_value = SimpleNamespace(
            readall=lambda: json.dumps(journal).encode()
        )
        archive_client = MagicMock()
        container.get_blob_client.return_value = archive_client
        return container, archive_client, journal, journal_name

    def test_reconcile_skips_while_an_active_run_holds_the_lock(self):
        with (
            patch.object(
                backup, "_run_lock", return_value=contextlib.nullcontext(False)
            ),
            patch.object(backup, "_reconcile_local_publications") as reconcile,
        ):
            backup._reconcile_publications()
        reconcile.assert_not_called()

    def test_reconcile_finishes_candidate_owned_by_state_and_marker(self):
        container, archive_client, journal, journal_name = self._journal_fixture()
        with patch.object(backup, "_documents_owned_by_run", return_value=(True, True)):
            backup._reconcile_azure_publications(container)

        archive_client.set_blob_metadata.assert_called_once_with(
            {"hriv_publication_state": "published"}
        )
        container.delete_blob.assert_called_once_with(journal_name)

    def test_reconcile_removes_journal_after_archive_was_published(self):
        container, archive_client, _journal, journal_name = self._journal_fixture()
        container.list_blobs.return_value[0].metadata = {
            "hriv_publication_state": "published"
        }

        backup._reconcile_azure_publications(container)

        archive_client.set_blob_metadata.assert_not_called()
        container.delete_blob.assert_called_once_with(journal_name)

    def test_reconcile_partial_publication_rolls_back_and_removes_artifacts(self):
        container, _archive_client, journal, journal_name = self._journal_fixture()
        with (
            patch.object(backup, "_documents_owned_by_run", return_value=(True, False)),
            patch.object(backup, "_rollback_publication_documents") as rollback,
        ):
            backup._reconcile_azure_publications(container)

        rollback.assert_called_once_with(
            journal["prior_backup_state"],
            journal["prior_last_success"],
            journal["run_id"],
        )
        self.assertEqual(
            [call.args[0] for call in container.delete_blob.call_args_list],
            [journal["archive_name"], journal["sidecar_name"], journal_name],
        )

    def test_cleanup_deletes_only_stale_candidates_and_matching_sidecar(self):
        now = datetime.now(timezone.utc)
        blobs = [
            SimpleNamespace(
                name="hriv-backups/hriv-backup-20260101-000000-old.tar.gz",
                metadata={"hriv_publication_state": "candidate"},
                last_modified=now - timedelta(hours=25),
            ),
            SimpleNamespace(
                name="hriv-backups/hriv-backup-20260102-000000-fresh.tar.gz",
                metadata={"hriv_publication_state": "candidate"},
                last_modified=now - timedelta(hours=23),
            ),
            SimpleNamespace(
                name="hriv-backups/hriv-backup-20260103-000000-published.tar.gz",
                metadata={"hriv_publication_state": "published"},
                last_modified=now - timedelta(days=3),
            ),
            SimpleNamespace(
                name="hriv-backups/hriv-backup-20260104-000000-legacy.tar.gz",
                metadata={},
                last_modified=now - timedelta(days=3),
            ),
        ]
        container = MagicMock()
        container.list_blobs.return_value = blobs

        backup._cleanup_stale_candidates(container)

        self.assertEqual(
            [call.args[0] for call in container.delete_blob.call_args_list],
            [
                blobs[0].name,
                "hriv-backups/hriv-backup-20260101-000000-old.manifest.json",
            ],
        )

    def test_production_inventory_reports_missing_orphan_and_unsafe_rows(self):
        orphan = self.data_dir / "source_images" / "orphan.jpg"
        orphan.write_bytes(b"orphan")
        incomplete = self.data_dir / "source_images" / "upload.part"
        incomplete.write_bytes(b"partial")
        mixed_suffix = self.data_dir / "source_images" / "mixed.PaRt"
        mixed_suffix.write_bytes(b"partial")
        mixed_segment = self.data_dir / "source_images" / ".StAgInG" / "file.jpg"
        mixed_segment.parent.mkdir()
        mixed_segment.write_bytes(b"partial")
        pending = self.data_dir / "source_images" / "pending.jpg"
        pending.write_bytes(b"pending")
        rows = [
            ("1", str(self.data_dir / "source_images" / "img.jpg"), "completed"),
            ("2", str(self.data_dir / "source_images" / "missing.jpg"), "completed"),
            ("3", "../outside.jpg", "completed"),
            ("4", str(pending), "processing"),
        ]
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "backups"
        inventory_run, commands = _production_inventory_run(self.data_dir, rows)

        def checked_inventory(cmd, **kwargs):
            if cmd[0] == "psql" and any(
                token in cmd[-1]
                for token in (
                    "source_images",
                    "UPDATE public.backup_recovery_wal_fence",
                    "pg_walfile_name",
                )
            ):
                self.assertTrue(backup._maintenance_flag_path().exists())
            if cmd[0] == "psql" and "pg_stat_archiver" in cmd[-1]:
                self.assertFalse(backup._maintenance_flag_path().exists())
            return inventory_run(cmd, **kwargs)

        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=checked_inventory),
        ):
            result = backup.run_backup()

        self.assertTrue(result)
        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))
        with tarfile.open(result, "r:gz") as tar:
            names = tar.getnames()
        self.assertTrue(
            any(name.endswith("data/source_images/img.jpg") for name in names)
        )
        self.assertFalse(any(name.endswith("orphan.jpg") for name in names))
        self.assertTrue(any(name.endswith("pending.jpg") for name in names))
        self.assertFalse(any(name.endswith("upload.part") for name in names))
        manifest = json.loads(
            (
                local_dir / f"{result.name.removesuffix('.tar.gz')}.manifest.json"
            ).read_text()
        )
        source_images = manifest["source_images"]
        self.assertEqual(source_images["database_row_count"], 4)
        self.assertEqual(source_images["included_row_count"], 2)
        self.assertEqual(source_images["included_file_count"], 2)
        self.assertEqual(source_images["missing_or_skipped_count"], 2)
        self.assertEqual(source_images["orphan_count"], 1)
        reasons = {
            entry["reason"] for entry in manifest["validation"]["missing_sources"]
        }
        self.assertEqual(reasons, {"missing_source", "unsafe_or_out_of_root"})
        self.assertEqual(
            manifest["validation"]["orphan_sources"],
            [
                {
                    "path": "data/source_images/orphan.jpg",
                    "reason": "no_database_row",
                    "policy": "quarantined_by_policy",
                }
            ],
        )
        self.assertEqual(
            {
                entry["path"]
                for entry in manifest["validation"]["excluded_incomplete_artifacts"]
            },
            {
                "data/source_images/.StAgInG/file.jpg",
                "data/source_images/mixed.PaRt",
                "data/source_images/upload.part",
                "data/tiles",
            },
        )
        self.assertTrue(manifest["validation"]["accepted"])
        self.assertTrue(orphan.exists())
        self.assertTrue(pending.exists())
        self.assertTrue(incomplete.exists())

    def test_database_snapshot_boundary_governs_files_appearing_after_query(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "backups"
        late = self.data_dir / "source_images" / "late.jpg"

        def commit_after_snapshot():
            late.write_bytes(b"committed after snapshot")

        inventory_run, _commands = _production_inventory_run(
            self.data_dir,
            boundary="2026-02-03T04:05:06.000000Z",
            after_boundary=commit_after_snapshot,
        )
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
        ):
            result = backup.run_backup()

        manifest = json.loads(
            (
                local_dir / f"{result.name.removesuffix('.tar.gz')}.manifest.json"
            ).read_text()
        )
        self.assertEqual(
            manifest["database_recovery"]["target_time"],
            "2026-02-03T04:05:06+00:00",
        )
        self.assertNotIn("data/source_images/late.jpg", manifest["files"])
        self.assertEqual(
            manifest["validation"]["orphan_sources"],
            [
                {
                    "path": "data/source_images/late.jpg",
                    "reason": "no_database_row",
                    "policy": "quarantined_by_policy",
                }
            ],
        )
        self.assertTrue(late.exists())

    def test_database_timestamps_require_canonical_utc_csv_format(self):
        parsed = backup._parse_utc_sql_timestamp("2026-01-02T03:04:05.123456Z")
        self.assertEqual(parsed.isoformat(), "2026-01-02T03:04:05.123456+00:00")
        for value in (
            "2026-01-02T03:04:05Z",
            "2026-01-02T03:04:05.123456+00:00",
            "2026-02-30T03:04:05.123456Z",
            None,
        ):
            with self.subTest(value=value):
                self.assertIsNone(backup._parse_utc_sql_timestamp(value))

    def test_inventory_boundary_rejects_invalid_time_and_lsn(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        for kwargs, error in (
            ({"boundary": "not-a-time"}, "invalid boundary time"),
            (
                {"boundary": "2026-01-02T03:04:05+00:00"},
                "invalid boundary time",
            ),
            ({"target_lsn": "not-an-lsn"}, "invalid boundary LSN"),
        ):
            with self.subTest(kwargs=kwargs):
                inventory_run, _commands = _production_inventory_run(
                    self.data_dir, **kwargs
                )
                with (
                    patch.object(backup.subprocess, "run", side_effect=inventory_run),
                    self.assertRaisesRegex(RuntimeError, error),
                ):
                    backup._query_source_image_rows(
                        backup._parse_db_url(backup.DATABASE_URL),
                        self.tmp / "inventory.csv",
                    )

    def test_inventory_boundary_rejects_non_strict_csv_columns(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})

        def invalid_csv(_cmd, **kwargs):
            kwargs["stdout"].write(b"record_type,boundary_time,id\nboundary,now,\n")
            return MagicMock(returncode=0, stderr=b"")

        with (
            patch.object(backup.subprocess, "run", side_effect=invalid_csv),
            self.assertRaisesRegex(RuntimeError, "invalid CSV columns"),
        ):
            backup._query_source_image_rows(
                backup._parse_db_url(backup.DATABASE_URL), self.tmp / "inventory.csv"
            )

    def test_inventory_timeouts_fail_closed_and_preserve_prior_success(self):
        for failure in ("subprocess", "database"):
            with self.subTest(failure=failure):
                self._reload(
                    {"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)}
                )
                local_dir = self.tmp / f"inventory-timeout-{failure}"
                local_dir.mkdir()
                _prior_state, prior_marker = self._seed_prior_publication(local_dir)
                inventory_run, commands = _production_inventory_run(
                    self.data_dir, returncode=1 if failure == "database" else 0
                )
                observed_timeout = []

                def timeout_run(cmd, **kwargs):
                    if cmd[0] == "psql" and "source_images" in cmd[-1]:
                        observed_timeout.append(kwargs.get("timeout"))
                        if failure == "subprocess":
                            raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])
                        commands.append(cmd)
                        return MagicMock(
                            returncode=1,
                            stderr=b"canceling statement due to lock timeout",
                        )
                    return inventory_run(cmd, **kwargs)

                with (
                    patch.object(backup, "_local_backup_dir", return_value=local_dir),
                    patch.object(backup.subprocess, "run", side_effect=timeout_run),
                    self.assertLogs("hriv-backup", level="ERROR") as captured_logs,
                ):
                    self.assertIsNone(backup.run_backup())

                expected_error = (
                    "subprocess exceeded 125 seconds"
                    if failure == "subprocess"
                    else "canceling statement due to lock timeout"
                )
                self.assertIn(expected_error, "\n".join(captured_logs.output))
                self.assertEqual(observed_timeout, [125])
                self.assertFalse(backup._maintenance_flag_path().exists())
                state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
                self.assertFalse(state["database"]["success"])
                self.assertFalse(state["filesystem"]["success"])
                self.assertEqual(
                    state["database"]["last_success_archive_key"], "prior-database"
                )
                self.assertEqual(
                    state["filesystem"]["last_success_archive_key"],
                    "prior-filesystem",
                )
                self.assertEqual(
                    json.loads((local_dir / "LAST_SUCCESS.json").read_text()),
                    prior_marker,
                )
                self.assertEqual(list(local_dir.glob("*.tar.gz")), [])
                self.assertEqual(list(local_dir.glob("*.manifest.json")), [])
                self.assertEqual(list(local_dir.glob(".publication-*.json")), [])
                inventory_queries = [
                    cmd[-1]
                    for cmd in commands
                    if cmd[0] == "psql" and "source_images" in cmd[-1]
                ]
                if failure == "subprocess":
                    self.assertEqual(inventory_queries, [])
                else:
                    self.assertEqual(len(inventory_queries), 1)

    def test_archive_timeout_precondition_rejects_invalid_values_without_publication(
        self,
    ):
        for archive_timeout in ("0", "600", "601", "malformed"):
            with self.subTest(archive_timeout=archive_timeout):
                self._reload(
                    {"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)}
                )
                local_dir = self.tmp / f"archive-timeout-{archive_timeout}"
                local_dir.mkdir()
                _prior_state, prior_marker = self._seed_prior_publication(local_dir)
                inventory_run, commands = _production_inventory_run(
                    self.data_dir, archive_timeout=archive_timeout
                )
                with (
                    patch.object(backup, "_local_backup_dir", return_value=local_dir),
                    patch.object(backup.subprocess, "run", side_effect=inventory_run),
                ):
                    self.assertIsNone(backup.run_backup())
                state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
                self.assertFalse(state["database"]["success"])
                self.assertFalse(state["filesystem"]["success"])
                self.assertEqual(
                    state["database"]["last_success_archive_key"], "prior-database"
                )
                self.assertEqual(
                    json.loads((local_dir / "LAST_SUCCESS.json").read_text()),
                    prior_marker,
                )
                self.assertEqual(list(local_dir.glob("*.tar.gz")), [])
                self.assertEqual(list(local_dir.glob("*.manifest.json")), [])
                psql_queries = [cmd[-1] for cmd in commands if cmd[0] == "psql"]
                self.assertEqual(len(psql_queries), 1)
                self.assertIn("archive_timeout", psql_queries[0])

    def test_wal_fence_update_requires_exactly_one_positive_generation_row(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        db = backup._parse_db_url(backup.DATABASE_URL)
        for payload in (
            "generation\n",
            "generation\n0\n",
            "generation\ninvalid\n",
            "generation\n1\n2\n",
            "wrong_column\n1\n",
        ):
            with self.subTest(payload=payload):
                commands = []

                def invalid_update(cmd, **_kwargs):
                    commands.append(cmd)
                    return MagicMock(returncode=0, stdout=payload, stderr="")

                with (
                    patch.object(backup.subprocess, "run", side_effect=invalid_update),
                    self.assertRaises(RuntimeError),
                ):
                    backup._emit_wal_fence(db)
                self.assertEqual(len(commands), 1)
                self.assertIn(
                    "UPDATE public.backup_recovery_wal_fence", commands[0][-1]
                )

    def test_wal_fence_wait_polls_until_same_timeline_file_is_archived(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        fence = "000000010000000000000006"
        inventory_run, _commands = _production_inventory_run(
            self.data_dir,
            archived_files=[
                "000000020000000000000006",
                "00000002.history",
                "000000010000000000000006.backup",
                None,
                "000000010000000000000005",
                f"{fence}.partial",
            ],
        )
        with (
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
            patch.object(backup.time, "sleep") as sleep,
        ):
            archived_at = backup._wait_for_wal_fence_archive(
                backup._parse_db_url(backup.DATABASE_URL), fence
            )
        self.assertEqual(archived_at.isoformat(), "2026-01-02T03:04:07+00:00")
        self.assertEqual(sleep.call_count, 5)
        sleep.assert_called_with(backup.BACKUP_WAL_FENCE_POLL_SECONDS)

    def test_wal_fence_wait_times_out_fail_closed(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        fence = "000000010000000000000006"
        inventory_run, _commands = _production_inventory_run(
            self.data_dir, archived_files=["000000010000000000000005"]
        )
        with (
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
            patch.object(backup.time, "monotonic", side_effect=[0, 601]),
            self.assertRaisesRegex(
                RuntimeError,
                "expected timeline 00000001, last archive-status timeline 00000001",
            ),
        ):
            backup._wait_for_wal_fence_archive(
                backup._parse_db_url(backup.DATABASE_URL), fence
            )

    def test_zero_source_rows_still_return_snapshot_boundary(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "backups"
        inventory_run, _commands = _production_inventory_run(
            self.data_dir,
            rows=[],
            boundary="2026-03-04T05:06:07.000000Z",
        )
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
        ):
            result = backup.run_backup()

        manifest = json.loads(
            (
                local_dir / f"{result.name.removesuffix('.tar.gz')}.manifest.json"
            ).read_text()
        )
        self.assertEqual(manifest["source_images"]["database_row_count"], 0)
        self.assertEqual(manifest["source_images"]["file_count"], 0)
        self.assertEqual(
            manifest["database_recovery"]["target_time"],
            "2026-03-04T05:06:07+00:00",
        )
        self.assertEqual(
            manifest["validation"]["orphan_sources"][0]["path"],
            "data/source_images/img.jpg",
        )

    def test_fence_subprocess_failure_publishes_nothing_and_preserves_prior_success(
        self,
    ):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "fence-failure"
        local_dir.mkdir()
        prior_state, prior_marker = self._seed_prior_publication(local_dir)
        inventory_run, _commands = _production_inventory_run(self.data_dir)

        def fail_fence(cmd, **kwargs):
            if (
                cmd[0] == "psql"
                and "UPDATE public.backup_recovery_wal_fence" in cmd[-1]
            ):
                return MagicMock(returncode=1, stdout="", stderr="permission denied")
            return inventory_run(cmd, **kwargs)

        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=fail_fence),
        ):
            self.assertIsNone(backup.run_backup())
        state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
        self.assertFalse(state["database"]["success"])
        self.assertFalse(state["filesystem"]["success"])
        self.assertEqual(
            state["database"]["last_success_archive_key"], "prior-database"
        )
        self.assertEqual(
            state["filesystem"]["last_success_archive_key"], "prior-filesystem"
        )
        self.assertEqual(
            json.loads((local_dir / "LAST_SUCCESS.json").read_text()), prior_marker
        )
        self.assertEqual(list(local_dir.glob("*.tar.gz")), [])
        self.assertEqual(list(local_dir.glob("*.manifest.json")), [])
        self.assertNotEqual(state, prior_state)

    def test_fence_archive_timeout_publishes_nothing_and_preserves_prior_success(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "fence-timeout"
        local_dir.mkdir()
        _prior_state, prior_marker = self._seed_prior_publication(local_dir)
        inventory_run, _commands = _production_inventory_run(self.data_dir)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
            patch.object(
                backup,
                "_wait_for_wal_fence_archive",
                side_effect=RuntimeError("timed out waiting for WAL fence"),
            ),
        ):
            self.assertIsNone(backup.run_backup())
        state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
        self.assertFalse(state["database"]["success"])
        self.assertEqual(
            state["database"]["last_success_archive_key"], "prior-database"
        )
        self.assertEqual(
            json.loads((local_dir / "LAST_SUCCESS.json").read_text()), prior_marker
        )
        self.assertEqual(list(local_dir.glob("*.tar.gz")), [])
        self.assertEqual(list(local_dir.glob("*.manifest.json")), [])
        self.assertEqual(list(local_dir.glob(".publication-*.json")), [])

    def test_production_inventory_query_failure_rejects_without_publication(self):
        self._reload({"BACKUP_MODE": "production", "DATA_DIR": str(self.data_dir)})
        local_dir = self.tmp / "backups"
        inventory_run, commands = _production_inventory_run(self.data_dir, returncode=1)
        with (
            patch.object(backup, "_local_backup_dir", return_value=local_dir),
            patch.object(backup.subprocess, "run", side_effect=inventory_run),
        ):
            result = backup.run_backup()

        self.assertIsNone(result)
        self.assertTrue(any(cmd[0] == "psql" for cmd in commands))
        inventory_query = next(
            cmd[-1]
            for cmd in commands
            if cmd[0] == "psql" and "source_images" in cmd[-1]
        )
        self.assertLess(
            inventory_query.index("BEGIN;"),
            inventory_query.index("SET LOCAL lock_timeout"),
        )
        self.assertLess(
            inventory_query.index("SET LOCAL lock_timeout"),
            inventory_query.index("SET LOCAL statement_timeout"),
        )
        self.assertLess(
            inventory_query.index("SET LOCAL statement_timeout"),
            inventory_query.index("LOCK TABLE"),
        )
        self.assertLess(
            inventory_query.index("LOCK TABLE"), inventory_query.index("COPY (")
        )
        self.assertIn("SET LOCAL lock_timeout = '120000ms'", inventory_query)
        self.assertIn("SET LOCAL statement_timeout = '120000ms'", inventory_query)
        self.assertLess(
            inventory_query.index("COPY ("), inventory_query.index("COMMIT;")
        )
        self.assertFalse(any(cmd[0] == "pg_dump" for cmd in commands))
        self.assertEqual(list(local_dir.glob("*.tar.gz")), [])
        self.assertEqual(list(local_dir.glob("*.manifest.json")), [])
        self.assertFalse((local_dir / "LAST_SUCCESS.json").exists())
        state = json.loads((local_dir / "BACKUP_STATE.json").read_text())
        self.assertFalse(state["database"]["success"])
        self.assertFalse(state["filesystem"]["success"])


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
            fake_container.download_blob.side_effect = backup.ResourceNotFoundError(
                "missing"
            )
        else:
            fake_container.download_blob.return_value = _Download(marker_payload)
        return fake_container

    def test_status_reports_fresh(self):
        marker_created_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        fake_container = self._reload_status(marker_created_at=marker_created_at)

        with (
            patch.object(backup, "_blob_container_client", return_value=fake_container),
            contextlib.redirect_stdout(io.StringIO()) as stdout,
        ):
            self.assertTrue(backup.run_status())

        output = stdout.getvalue()
        self.assertIn("Status: FRESH", output)
        self.assertIn("Last successful backup:", output)
        self.assertIn("Newest snapshot: hriv-backup-20260102-020000.tar.gz", output)
        self.assertIn("Snapshot count: 2", output)

    def test_status_reports_stale(self):
        marker_created_at = datetime.now(timezone.utc) - timedelta(hours=3)
        fake_container = self._reload_status(marker_created_at=marker_created_at)

        with (
            patch.object(backup, "_blob_container_client", return_value=fake_container),
            contextlib.redirect_stdout(io.StringIO()) as stdout,
        ):
            self.assertFalse(backup.run_status())

        output = stdout.getvalue()
        self.assertIn("Status: STALE", output)
        self.assertIn("Age:", output)

    def test_status_fails_when_marker_missing(self):
        fake_container = self._reload_status(marker_created_at=None)

        with (
            patch.object(backup, "_blob_container_client", return_value=fake_container),
            contextlib.redirect_stdout(io.StringIO()) as stdout,
        ):
            self.assertFalse(backup.run_status())

        output = stdout.getvalue()
        self.assertIn("Status: MISSING", output)
        self.assertIn("Last successful backup: (missing)", output)

    def test_status_rejects_missing_marker_snapshot(self):
        marker_created_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        fake_container = self._reload_status(
            marker_created_at=marker_created_at, snapshots=[]
        )

        with (
            patch.object(backup, "_blob_container_client", return_value=fake_container),
            contextlib.redirect_stdout(io.StringIO()) as stdout,
        ):
            self.assertFalse(backup.run_status())

        output = stdout.getvalue()
        self.assertIn("Status: MARKER_SNAPSHOT_MISSING", output)
        self.assertIn("Snapshot count: 0", output)

    def test_status_measures_age_from_completion_time(self):
        # A long-running backup that started 3h ago but finished 30m ago is
        # fresh against a 2h threshold.
        fake_container = self._reload_status(
            marker_created_at=datetime.now(timezone.utc) - timedelta(hours=3),
            marker_completed_at=datetime.now(timezone.utc) - timedelta(minutes=30),
        )

        with (
            patch.object(backup, "_blob_container_client", return_value=fake_container),
            contextlib.redirect_stdout(io.StringIO()) as stdout,
        ):
            self.assertTrue(backup.run_status())

        self.assertIn("Status: FRESH", stdout.getvalue())

    def test_missing_marker_is_silent(self):
        self._reload_status(marker_created_at=datetime.now(timezone.utc))
        fake_container = MagicMock()
        fake_container.download_blob.side_effect = backup.ResourceNotFoundError(
            "missing"
        )

        with (
            patch.object(backup, "_blob_container_client", return_value=fake_container),
            self.assertNoLogs("hriv-backup", level="ERROR"),
        ):
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
        (self.local_dir / "hriv-backup-20260102-030405-aaaaaaaa.tar.gz").write_bytes(
            b""
        )
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
            backup._resolve_snapshot_name(
                "hriv-backup-20260101-000000.tar.gz", available
            ),
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
        self.assertIsNone(
            backup._resolve_snapshot_name("hriv-backup-20260104-000000", available)
        )

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


def _production_inventory_run(
    data_dir,
    rows=None,
    *,
    returncode=0,
    boundary="2026-01-02T03:04:05.000000Z",
    target_lsn="0/5000000",
    archive_timeout="300",
    fence_file="000000010000000000000006",
    archived_files=None,
    after_boundary=None,
):
    commands = []
    if rows is None:
        rows = [("1", str(Path(data_dir) / "source_images" / "img.jpg"), "completed")]
    archived = iter(archived_files or [fence_file])

    def run(cmd, **kwargs):
        commands.append(cmd)
        if cmd[0] == "pg_dump":
            raise AssertionError("production backup invoked pg_dump")
        if cmd[0] != "psql":
            return MagicMock(returncode=0)
        query = cmd[-1]
        if "pg_settings" in query and "archive_timeout" in query:
            return MagicMock(
                returncode=0,
                stdout=("archive_timeout_seconds\n" f"{archive_timeout}\n"),
                stderr="",
            )
        if returncode != 0 and "source_images" in query:
            return MagicMock(returncode=returncode, stderr=b"inventory failed")
        if "source_images" in query:
            lines = ["record_type,boundary_time,boundary_lsn,id,stored_path,status"]
            lines.append(f"boundary,{boundary},{target_lsn},,,")
            lines.extend(f"source,,,{','.join(row)}" for row in rows)
            kwargs["stdout"].write(("\n".join(lines) + "\n").encode())
            if after_boundary:
                after_boundary()
            return MagicMock(returncode=0, stderr=b"")
        if "UPDATE public.backup_recovery_wal_fence" in query:
            return MagicMock(
                returncode=0,
                stdout="generation\n1\n",
                stderr="",
            )
        if "pg_walfile_name" in query:
            return MagicMock(
                returncode=0,
                stdout=(
                    "wal_fence_file,wal_fence_committed_at\n"
                    f"{fence_file},2026-01-02T03:04:06.000000Z\n"
                ),
                stderr="",
            )
        if "pg_stat_archiver" in query:
            archived_file = next(archived, fence_file)
            archived_at = "2026-01-02T03:04:07.000000Z" if archived_file else ""
            return MagicMock(
                returncode=0,
                stdout=(
                    "last_archived_wal,last_archived_time\n"
                    f"{archived_file or ''},{archived_at}\n"
                ),
                stderr="",
            )
        raise AssertionError(f"unexpected psql query: {query}")

    return run, commands


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

    def test_concurrent_local_backups_are_serialized_by_run_lock(self):
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
        self.assertEqual(len(results), 1)
        self.assertEqual(len(list(self.local_dir.glob("*.tar.gz"))), 1)
        for archive in results:
            self.assertTrue(archive.exists())
            with tarfile.open(archive, "r:gz") as tar:
                names = tar.getnames()
            self.assertTrue(
                any(n.endswith("data/source_images/img.jpg") for n in names)
            )
            sidecar = (
                self.local_dir / f"{archive.name.removesuffix('.tar.gz')}.manifest.json"
            )
            payload = json.loads(sidecar.read_text())
            self.assertEqual(
                payload["snapshot_name"], archive.name.removesuffix(".tar.gz")
            )
        state = json.loads((self.local_dir / "BACKUP_STATE.json").read_text())
        self.assertEqual(state["run_id"], state["database"]["run_id"])
        overlap_attempts = [
            attempt
            for attempt in state["attempts"]
            if attempt.get("failure_reason") == "overlapping_backup_run"
        ]
        self.assertEqual(
            sorted(attempt["backup_type"] for attempt in overlap_attempts),
            ["database", "filesystem"],
        )

    def test_same_second_azure_backups_do_not_overwrite_each_other(self):
        self._reload(
            {
                "DATA_DIR": str(self.data_dir),
                "AZURE_STORAGE_CONNECTION_STRING": "fake",
                "AZURE_STORAGE_CONTAINER": "fake",
            }
        )
        uploads: dict[str, bytes] = {}
        staged: dict[str, list[bytes]] = {}

        def fake_upload_blob(blob_name, data, overwrite=True, **_kwargs):
            if not overwrite and blob_name in uploads:
                raise RuntimeError(f"blob already exists: {blob_name}")
            uploads[blob_name] = data.read()

        def fake_download_blob(blob_name):
            if blob_name not in uploads:
                raise backup.ResourceNotFoundError("missing")
            payload = uploads[blob_name]
            return SimpleNamespace(
                properties=SimpleNamespace(etag=f"etag-{len(payload)}"),
                readall=lambda: payload,
            )

        class FakeBlobClient:
            def __init__(self, name):
                self.name = name

            def stage_block(self, block_id, data, length):
                staged.setdefault(self.name, []).append(data.read())

            def commit_block_list(self, block_ids, if_none_match=None, metadata=None):
                if self.name in uploads:
                    raise RuntimeError(f"blob already exists: {self.name}")
                uploads[self.name] = b"".join(staged[self.name])

            def set_blob_metadata(self, metadata):
                self.metadata = metadata

            def delete_blob(self):
                uploads.pop(self.name, None)

        fake_container = MagicMock()
        fake_container.upload_blob = fake_upload_blob
        fake_container.download_blob.side_effect = fake_download_blob
        fake_container.get_blob_client.side_effect = FakeBlobClient
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
            patch.object(
                backup.tempfile, "TemporaryDirectory", recording_temporary_directory
            ),
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
        os.utime(stale / "archive.tar.gz", (old, old))
        os.utime(stale, (old, old))

        backup._sweep_stale_staging(root)

        self.assertFalse(stale.exists())
        self.assertTrue(fresh.exists())

    def test_filesystem_restore_extracts_on_target_volume(self):
        data_dir = self.tmp / "restore-target"
        (data_dir / "source_images").mkdir(parents=True)
        (data_dir / "source_images" / "old.jpg").write_bytes(b"old")
        self._reload({"DATA_DIR": str(data_dir)})
        archive = self.local_dir / "hriv-backup-20260101-000000.tar.gz"
        snapshot = self.tmp / "hriv-backup-20260101-000000"
        (snapshot / "data" / "source_images").mkdir(parents=True)
        image = snapshot / "data" / "source_images" / "img.jpg"
        image.write_bytes(b"source")
        dump = snapshot / "db.sql"
        dump.write_text("dump")
        (snapshot / "manifest.json").write_text(
            json.dumps(
                {
                    "files": {
                        "db.sql": {
                            "size": dump.stat().st_size,
                            "sha256": backup._sha256(dump),
                        },
                        "data/source_images/img.jpg": {
                            "size": image.stat().st_size,
                            "sha256": backup._sha256(image),
                        },
                    }
                }
            )
        )
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(snapshot, arcname=snapshot.name)
        real_temporary_directory = tempfile.TemporaryDirectory
        restore_dirs: list[str | None] = []

        def recording_temporary_directory(*args, **kwargs):
            if kwargs.get("prefix") == backup._RESTORE_PREFIX:
                restore_dirs.append(kwargs.get("dir"))
            return real_temporary_directory(*args, **kwargs)

        with (
            patch.object(backup, "_local_backup_dir", return_value=self.local_dir),
            patch.object(
                backup.tempfile, "TemporaryDirectory", recording_temporary_directory
            ),
            patch.object(
                backup.subprocess, "run", return_value=MagicMock(returncode=0)
            ),
        ):
            ok = backup._run_restore_inner(snapshot_name=archive.name)

        self.assertTrue(ok)
        self.assertEqual(restore_dirs, [str(data_dir)])
        self.assertEqual(
            (data_dir / "source_images" / "img.jpg").read_bytes(), b"source"
        )
        quarantined = list(data_dir.glob(".restore-orphans-*/source_images/old.jpg"))
        self.assertEqual(len(quarantined), 1)

    def test_sweep_stale_staging_removes_stale_restore_directories(self):
        self._reload({})
        root = self.local_dir / ".staging"
        root.mkdir()
        stale = root / f"{backup._RESTORE_PREFIX}stale"
        stale.mkdir()
        (stale / "archive.tar.gz").write_bytes(b"partial download")
        old = (datetime.now(timezone.utc) - timedelta(hours=48)).timestamp()
        os.utime(stale / "archive.tar.gz", (old, old))
        os.utime(stale, (old, old))

        backup._sweep_stale_staging(root)

        self.assertFalse(stale.exists())

    def test_sweep_stale_staging_keeps_directory_with_recent_contents(self):
        self._reload({})
        root = self.local_dir / ".staging"
        root.mkdir()
        active = root / f"{backup._STAGING_PREFIX}active"
        active.mkdir()
        (active / "archive.tar.gz").write_bytes(b"still being written")
        old = (datetime.now(timezone.utc) - timedelta(hours=48)).timestamp()
        os.utime(active, (old, old))

        backup._sweep_stale_staging(root)

        self.assertTrue(active.exists())


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
        self.assertNotIn(
            "hriv-backups/hriv-backup-20260202-000000-aaaaaaaa.tar.gz", deleted
        )

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
            patch.object(
                backup, "_restore_from_archive", side_effect=fake_restore_from_archive
            ),
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

    def test_restore_reports_available_snapshots_when_prefix_is_ambiguous(self):
        self._reload({})
        (self.local_dir / "hriv-backup-20260202-030405-bbbbbbbb.tar.gz").write_bytes(
            b"archive"
        )
        with self.assertLogs("hriv-backup", level="ERROR") as logs:
            ok, restored = self._restore("hriv-backup-20260202-030405")
        self.assertFalse(ok)
        self.assertEqual(restored, [])
        self.assertTrue(any("is ambiguous" in line for line in logs.output))
        self.assertTrue(any("not found. Available" in line for line in logs.output))
        self.assertFalse(any("Snapshot file not found" in line for line in logs.output))

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
                completed_at=datetime(2026, 2, 2, 3, 4, 5, tzinfo=timezone.utc),
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


def _attempt(
    run_id: str, started: str, completed: str | None, *, success=None, archive_key=None
) -> dict:
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


def _state(
    run_id: str,
    *,
    database: dict | None = None,
    filesystem: dict | None = None,
    snapshot_name="snap",
) -> dict:
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
            database=_attempt(
                "newer",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
                archive_key="new-key",
            ),
        )
        older = _state(
            "older",
            snapshot_name="snap-older",
            database=_attempt(
                "older",
                "2026-08-01T09:00:00+00:00",
                "2026-08-01T10:03:00+00:00",
                success=True,
                archive_key="old-key",
            ),
        )

        merged = backup._merge_backup_state(newer, older)

        self.assertEqual(merged["database"]["run_id"], "newer")
        self.assertEqual(merged["database"]["archive_key"], "new-key")
        self.assertEqual(merged["database"]["last_success_archive_key"], "new-key")
        self.assertEqual(merged["snapshot_name"], "snap-newer")

    def test_newer_completion_advances_state(self):
        older = _state(
            "older",
            database=_attempt(
                "older",
                "2026-08-01T09:00:00+00:00",
                "2026-08-01T09:05:00+00:00",
                success=True,
                archive_key="old-key",
            ),
        )
        newer = _state(
            "newer",
            snapshot_name="snap-newer",
            database=_attempt(
                "newer",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
                archive_key="new-key",
            ),
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
            "run-1",
            "2026-08-01T10:00:00+00:00",
            "2026-08-01T10:05:00+00:00",
            success=True,
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
            "run-1",
            "2026-08-01T10:00:00+00:00",
            "2026-08-01T10:05:00+00:00",
            success=True,
        )
        stored = backup._merge_backup_state(None, _state("run-1", database=attempt))

        enriched = copy.deepcopy(attempt)
        enriched["archive_key"] = "snap.tar.gz"
        merged = backup._merge_backup_state(stored, _state("run-1", database=enriched))

        entries = [
            entry for entry in merged["attempts"] if entry["backup_type"] == "database"
        ]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["archive_key"], "snap.tar.gz")

    def test_late_finishing_older_failure_cannot_regress_newer_success(self):
        newer_success = _state(
            "newer",
            filesystem=_attempt(
                "newer",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
                archive_key="new-key",
            ),
        )
        # An older run that started first but only failed afterwards.
        older_failure = _state(
            "older",
            filesystem=_attempt(
                "older",
                "2026-08-01T09:00:00+00:00",
                "2026-08-01T10:09:00+00:00",
                success=False,
            ),
        )

        merged = backup._merge_backup_state(newer_success, older_failure)

        # The failure is newer, so it becomes the current attempt …
        self.assertIs(merged["filesystem"]["success"], False)
        self.assertEqual(merged["filesystem"]["run_id"], "older")
        # … but the newer success history survives.
        self.assertEqual(
            merged["filesystem"]["last_success_completed_at"],
            "2026-08-01T10:05:00+00:00",
        )
        self.assertEqual(merged["filesystem"]["last_success_archive_key"], "new-key")

    def test_older_failure_does_not_replace_newer_attempt(self):
        newer_success = _state(
            "newer",
            filesystem=_attempt(
                "newer",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
                archive_key="new-key",
            ),
        )
        older_failure = _state(
            "older",
            filesystem=_attempt(
                "older",
                "2026-08-01T09:00:00+00:00",
                "2026-08-01T09:30:00+00:00",
                success=False,
            ),
        )

        merged = backup._merge_backup_state(newer_success, older_failure)

        self.assertIs(merged["filesystem"]["success"], True)
        self.assertEqual(merged["filesystem"]["run_id"], "newer")

    def test_in_progress_attempt_does_not_displace_finished_attempt(self):
        finished = _state(
            "finished",
            database=_attempt(
                "finished",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
            ),
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
            database=_attempt(
                "a",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
                archive_key="a-key",
            ),
            filesystem=_attempt(
                "a",
                "2026-08-01T10:05:00+00:00",
                "2026-08-01T10:30:00+00:00",
                success=False,
            ),
        )
        incoming = _state(
            "b",
            database=_attempt(
                "b",
                "2026-08-01T09:00:00+00:00",
                "2026-08-01T09:05:00+00:00",
                success=True,
                archive_key="b-key",
            ),
            filesystem=_attempt(
                "b",
                "2026-08-01T09:05:00+00:00",
                "2026-08-01T10:40:00+00:00",
                success=True,
                archive_key="b-fs",
            ),
        )

        merged = backup._merge_backup_state(existing, incoming)

        self.assertEqual(merged["database"]["last_success_archive_key"], "a-key")
        self.assertEqual(merged["filesystem"]["last_success_archive_key"], "b-fs")

    def test_missing_or_legacy_state_is_replaced(self):
        incoming = _state("only")
        self.assertEqual(backup._merge_backup_state(None, incoming)["run_id"], "only")
        self.assertEqual(
            backup._merge_backup_state({"schema_version": 1}, incoming)["run_id"],
            "only",
        )
        self.assertEqual(
            backup._merge_backup_state("garbage", incoming)["run_id"], "only"
        )

    def test_attempt_history_retains_losing_run(self):
        existing = _state(
            "newer",
            database=_attempt(
                "newer",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
            ),
        )
        existing["attempts"] = backup._merge_attempt_history(None, existing)
        older = _state(
            "older",
            database=_attempt(
                "older",
                "2026-08-01T09:00:00+00:00",
                "2026-08-01T09:05:00+00:00",
                success=False,
            ),
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
        self.assertEqual(
            state["attempts"][0]["run_id"], f"run-{backup._MAX_ATTEMPT_HISTORY + 4:02d}"
        )


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
        newer = self._marker(
            "newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00"
        )
        older = self._marker(
            "older", "2026-08-01T09:00:00+00:00", "2026-08-01T10:03:00+00:00"
        )

        self.assertEqual(
            backup._merge_last_success_marker(newer, older)["run_id"], "newer"
        )
        self.assertEqual(
            backup._merge_last_success_marker(older, newer)["run_id"], "newer"
        )

    def test_equal_timestamps_use_serialized_incoming_marker(self):
        existing = self._marker(
            "z-existing",
            "2026-08-01T10:00:00+00:00",
            "2026-08-01T10:05:00+00:00",
        )
        incoming = self._marker(
            "a-incoming",
            "2026-08-01T10:00:00+00:00",
            "2026-08-01T10:05:00+00:00",
        )

        self.assertEqual(
            backup._merge_last_success_marker(existing, incoming)["run_id"],
            "a-incoming",
        )

    def test_legacy_marker_without_completed_at_is_ordered_by_created_at(self):
        legacy = {
            "snapshot_name": "snap-legacy",
            "created_at": "2026-08-01T08:00:00+00:00",
        }
        newer = self._marker(
            "newer", "2026-08-01T10:00:00+00:00", "2026-08-01T10:05:00+00:00"
        )

        self.assertEqual(
            backup._merge_last_success_marker(legacy, newer)["run_id"], "newer"
        )
        self.assertEqual(
            backup._merge_last_success_marker(newer, legacy)["run_id"], "newer"
        )

    def test_per_type_entries_keep_newest_of_each_type(self):
        existing = self._marker(
            "a",
            "2026-08-01T10:00:00+00:00",
            "2026-08-01T10:05:00+00:00",
            types={
                "database": {
                    "run_id": "a",
                    "created_at": "2026-08-01T10:00:00+00:00",
                    "completed_at": "2026-08-01T10:02:00+00:00",
                },
            },
        )
        incoming = self._marker(
            "b",
            "2026-08-01T09:00:00+00:00",
            "2026-08-01T10:03:00+00:00",
            types={
                "filesystem": {
                    "run_id": "b",
                    "created_at": "2026-08-01T09:00:00+00:00",
                    "completed_at": "2026-08-01T10:03:00+00:00",
                },
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
        section = dict(
            blank,
            run_id=run_id,
            started_at=started,
            completed_at=completed,
            success=success,
        )
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
        newer = self._restore_state(
            "newer",
            "operator",
            "2026-08-01T10:00:00+00:00",
            "2026-08-01T10:05:00+00:00",
            True,
        )
        older = self._restore_state(
            "older",
            "operator",
            "2026-08-01T09:00:00+00:00",
            "2026-08-01T10:09:00+00:00",
            False,
        )

        merged = backup._merge_restore_state(newer, older)

        self.assertIs(merged["operator"]["database"]["success"], False)
        self.assertEqual(
            merged["operator"]["database"]["last_success_archive_name"], "newer.tar.gz"
        )

    def test_purposes_do_not_clobber_each_other(self):
        operator = self._restore_state(
            "op",
            "operator",
            "2026-08-01T10:00:00+00:00",
            "2026-08-01T10:05:00+00:00",
            True,
        )
        test_run = self._restore_state(
            "test",
            "test",
            "2026-08-01T11:00:00+00:00",
            "2026-08-01T11:05:00+00:00",
            True,
        )

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
            database=_attempt(
                "newer",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
                archive_key="new-key",
            ),
        )
        older = _state(
            "older",
            database=_attempt(
                "older",
                "2026-08-01T09:00:00+00:00",
                "2026-08-01T10:04:00+00:00",
                success=True,
                archive_key="old-key",
            ),
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
            for name in (
                "hriv-backup-20260101-020000.tar.gz",
                "hriv-backup-20260102-020000.tar.gz",
            ):
                (self.local_dir / name).write_bytes(b"archive")

            names = [snapshot["name"] for snapshot in backup.list_snapshots()]
            backup._enforce_local_retention()

        self.assertEqual(
            names,
            [
                "hriv-backup-20260102-020000.tar.gz",
                "hriv-backup-20260101-020000.tar.gz",
            ],
        )
        self.assertTrue((self.local_dir / backup.STATE_LOCK_FILENAME).exists())
        self.assertTrue(
            (self.local_dir / "hriv-backup-20260102-020000.tar.gz").exists()
        )
        self.assertFalse(
            (self.local_dir / "hriv-backup-20260101-020000.tar.gz").exists()
        )

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
        patcher = patch.object(
            backup, "_blob_container_client", return_value=self.store
        )
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
        self.assertEqual(
            self.store.match_conditions, [backup.MatchConditions.IfNotModified]
        )

    def test_interleaved_writer_forces_a_re_merge(self):
        competitor = _state(
            "competitor",
            filesystem=_attempt(
                "competitor",
                "2026-08-01T10:00:00+00:00",
                "2026-08-01T10:05:00+00:00",
                success=True,
                archive_key="competitor-key",
            ),
        )
        self._write_state(_state("base"))

        def steal(store):
            store.seed(self.blob_name, competitor)

        self.store.before_upload = steal
        self._write_state(
            _state(
                "mine",
                database=_attempt(
                    "mine",
                    "2026-08-01T10:10:00+00:00",
                    "2026-08-01T10:12:00+00:00",
                    success=True,
                    archive_key="my-key",
                ),
            )
        )

        stored = self._stored()
        self.assertEqual(stored["database"]["last_success_archive_key"], "my-key")
        self.assertEqual(
            stored["filesystem"]["last_success_archive_key"], "competitor-key"
        )

    def test_persistent_contention_gives_up_without_raising(self):
        self._write_state(_state("first"))

        def always_conflict(
            name, data, overwrite=True, etag=None, match_condition=None
        ):
            data.read()
            if overwrite and etag is not None:
                raise backup.ResourceModifiedError("blob was modified")
            raise backup.ResourceExistsError("blob already exists")

        with (
            patch.object(self.store, "upload_blob", side_effect=always_conflict),
            self.assertLogs("hriv-backup", level="WARNING") as logs,
        ):
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
            patch.object(
                self.store, "download_blob", side_effect=RuntimeError("unreadable")
            ),
            self.assertLogs("hriv-backup", level="WARNING") as logs,
        ):
            self._write_state(_state("mine"))

        self.assertTrue(any("Gave up" in message for message in logs.output))
        self.assertEqual(self.store.calls, [])
        self.assertEqual(self._stored()["run_id"], "existing")


class _ReadBlobItemFake:
    __slots__ = ("name", "metadata", "size", "etag", "last_modified")

    def __init__(
        self,
        *,
        name,
        metadata,
        size=None,
        etag=None,
        last_modified=None,
    ):
        self.name = name
        self.metadata = metadata
        self.size = size
        self.etag = etag
        self.last_modified = last_modified


class _ReadBlobPropertiesFake:
    __slots__ = ("size", "etag", "metadata")

    def __init__(self, *, size, etag, metadata):
        self.size = size
        self.etag = etag
        self.metadata = metadata


class ReadOnlyValidationTestCase(_BackupTestCase):
    def _sas(self, **overrides):
        values = {
            "sv": "2023-11-03",
            "sr": "c",
            "sp": "rl",
            "sig": "secret-signature",
            "se": (datetime.now(timezone.utc) + timedelta(hours=7)).isoformat().replace(
                "+00:00", "Z"
            ),
        }
        values.update(overrides)
        query = "&".join(f"{key}={value}" for key, value in values.items())
        return f"https://account.blob.core.windows.net/backups?{query}"

    def test_read_sas_validation_accepts_only_container_read_list(self):
        value = self._sas()
        self.assertEqual(backup._validate_read_sas_url(value), value)
        for expected, value in (
            ("READ_SAS_MISSING", ""),
            ("READ_SAS_SCOPE_INVALID", self._sas().replace("/backups?", "/a/b?")),
            ("READ_SAS_SCOPE_INVALID", self._sas().replace("/backups?", "/Bad_Name?")),
            ("READ_SAS_SCOPE_INVALID", self._sas(sr="b")),
            ("READ_SAS_FIELDS_INVALID", self._sas(sig="")),
            ("READ_SAS_SCOPE_INVALID", self._sas().replace("https://", "http://")),
            (
                "READ_SAS_SCOPE_INVALID",
                self._sas().replace("account.blob.core.windows.net", "evil.example"),
            ),
            (
                "READ_SAS_SCOPE_INVALID",
                self._sas().replace("account.blob.core.windows.net", "account.blob.core.windows.net:443"),
            ),
            (
                "READ_SAS_SCOPE_INVALID",
                self._sas().replace("account.blob.core.windows.net", "user@account.blob.core.windows.net"),
            ),
            ("READ_SAS_PERMISSIONS_INVALID", self._sas(sp="r")),
            ("READ_SAS_PERMISSIONS_INVALID", self._sas(sp="rrll")),
            ("READ_SAS_PERMISSIONS_INVALID", self._sas(sp="rlw")),
            ("READ_SAS_MALFORMED", self._sas() + "&sp=rl"),
            ("READ_SAS_FIELDS_INVALID", self._sas(unknown="value")),
            ("READ_SAS_FIELDS_INVALID", self._sas(ss="b", srt="co")),
            ("READ_SAS_FIELDS_INVALID", self._sas(spr="https,http")),
            ("READ_SAS_FIELDS_INVALID", self._sas(spr="http")),
            ("READ_SAS_EXPIRY_INVALID", self._sas(se="2026-01-01 00:00:00Z")),
            ("READ_SAS_EXPIRY_INVALID", self._sas(se="2026-01-01T00:00:00+01:00")),
            (
                "READ_SAS_EXPIRED",
                self._sas(se="2020-01-01T00:00:00Z"),
            ),
            (
                "READ_SAS_NOT_YET_VALID",
                self._sas(st="2099-01-01T00:00:00Z"),
            ),
        ):
            with self.subTest(expected=expected), self.assertRaises(
                backup.ValidationFailure
            ) as raised:
                backup._validate_read_sas_url(value)
            self.assertEqual(raised.exception.code, expected)
            self.assertNotIn("secret-signature", str(raised.exception))
        service_sas = self._sas(spr="https", sip="10.0.0.1")
        self.assertEqual(backup._validate_read_sas_url(service_sas), service_sas)
        user_delegation = self._sas(
            skoid="11111111-1111-1111-1111-111111111111",
            sktid="22222222-2222-2222-2222-222222222222",
            skt="2026-01-01T00:00:00Z",
            ske="2027-01-01T00:00:00Z",
            sks="b",
            skv="2023-11-03",
            suoid="33333333-3333-3333-3333-333333333333",
        )
        self.assertEqual(backup._validate_read_sas_url(user_delegation), user_delegation)

    def test_read_sas_requires_enough_remaining_restore_time(self):
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup._validate_read_sas_url(
                self._sas(
                    se=(datetime.now(timezone.utc) + timedelta(hours=5))
                    .isoformat()
                    .replace("+00:00", "Z")
                )
            )
        self.assertEqual(raised.exception.code, "READ_SAS_EXPIRING")
        with patch.object(backup, "VALIDATION_MIN_SAS_VALIDITY_SECONDS", "60"):
            value = self._sas(
                se=(datetime.now(timezone.utc) + timedelta(minutes=2))
                .isoformat()
                .replace("+00:00", "Z")
            )
            self.assertEqual(backup._validate_read_sas_url(value), value)

    def test_read_sas_minimum_lifetime_starts_at_future_start_boundary(self):
        now = _FrozenDatetime._now
        start = now + timedelta(minutes=5)
        minimum = timedelta(seconds=backup._validation_min_sas_validity_seconds())
        with patch.object(backup, "datetime", _FrozenDatetime):
            accepted = self._sas(
                st=start.isoformat().replace("+00:00", "Z"),
                se=(start + minimum).isoformat().replace("+00:00", "Z"),
            )
            self.assertEqual(backup._validate_read_sas_url(accepted), accepted)
            with self.assertRaises(backup.ValidationFailure) as raised:
                backup._validate_read_sas_url(
                    self._sas(
                        st=start.isoformat().replace("+00:00", "Z"),
                        se=(start + minimum - timedelta(seconds=1))
                        .isoformat()
                        .replace("+00:00", "Z"),
                    )
                )
        self.assertEqual(raised.exception.code, "READ_SAS_EXPIRING")

    def test_minimum_sas_validity_configuration_is_lazy_finite_positive_and_bounded(self):
        self._reload({})
        self.assertEqual(backup.VALIDATION_MIN_SAS_VALIDITY_SECONDS, "21600")
        self.assertEqual(backup._validation_min_sas_validity_seconds(), 21600.0)
        for value in ("bad", "0", "-1", "nan", "inf", "86401"):
            with self.subTest(value=value):
                self._reload({"VALIDATION_MIN_SAS_VALIDITY_SECONDS": value})
                with self.assertRaises(backup.ValidationFailure) as raised:
                    backup._validation_min_sas_validity_seconds()
                self.assertEqual(raised.exception.code, "VALIDATION_CONFIG_INVALID")

    def test_read_client_uses_sas_while_write_client_keeps_connection_string(self):
        self._reload(
            {
                "AZURE_STORAGE_CONNECTION_STRING": "write-secret",
                "AZURE_STORAGE_CONTAINER": "backups",
                "AZURE_READ_SAS_URL": self._sas(),
            }
        )
        with (
            patch.object(backup.ContainerClient, "from_container_url") as read_factory,
            patch.object(
                backup.BlobServiceClient, "from_connection_string"
            ) as write_factory,
        ):
            backup._read_blob_container_client()
            backup._blob_container_client()
        read_factory.assert_called_once_with(backup.AZURE_READ_SAS_URL)
        write_factory.assert_called_once_with("write-secret")

    def test_generic_snapshot_list_remains_write_client_backed(self):
        self._reload(
            {
                "AZURE_STORAGE_CONNECTION_STRING": "write-secret",
                "AZURE_STORAGE_CONTAINER": "backups",
                "AZURE_READ_SAS_URL": self._sas(),
            }
        )
        container = SimpleNamespace(
            list_blobs=lambda **_kwargs: [
                SimpleNamespace(
                    name="hriv-backups/hriv-backup-20260101-020000-11111111.tar.gz",
                    metadata={"hriv_publication_state": "published"},
                    size=123,
                    last_modified=datetime(2026, 1, 1, tzinfo=timezone.utc),
                ),
                SimpleNamespace(
                    name="hriv-backups/hriv-backup-20260102-020000-22222222.tar.gz",
                    metadata={},
                    size=456,
                    last_modified=datetime(2026, 1, 2, tzinfo=timezone.utc),
                ),
            ]
        )
        with (
            patch.object(backup, "_read_blob_container_client", side_effect=AssertionError("read SAS")),
            patch.object(backup, "_blob_container_client", return_value=container) as write_client,
            patch.object(backup, "_reconcile_publications"),
            patch.object(backup, "_cleanup_stale_candidates"),
        ):
            snapshots = backup.list_snapshots()
        write_client.assert_called_once_with()
        self.assertEqual(
            [snapshot["name"] for snapshot in snapshots],
            [
                "hriv-backup-20260102-020000-22222222.tar.gz",
                "hriv-backup-20260101-020000-11111111.tar.gz",
            ],
        )

    def test_read_sas_validation_does_not_require_write_credentials(self):
        value = self._sas()
        self._reload({"AZURE_READ_SAS_URL": value, "AZURE_BLOB_PREFIX": "hriv-backups"})
        with patch.object(backup.ContainerClient, "from_container_url") as factory:
            backup._read_blob_container_client()
        factory.assert_called_once_with(value)
        for invalid in (
            value.replace("sr=c&", ""),
            value.replace("sig=secret-signature&", ""),
        ):
            with self.assertRaises(backup.ValidationFailure):
                backup._validate_read_sas_url(invalid)

    def test_read_sas_container_must_match_configured_container(self):
        self._reload({"AZURE_STORAGE_CONTAINER": "other", "AZURE_READ_SAS_URL": self._sas()})
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup._validate_read_sas_url()
        self.assertEqual(raised.exception.code, "READ_SAS_SCOPE_INVALID")

    def _validation_list_container(self, blobs=None, error=None):
        calls = []

        class ReadContainer:
            __slots__ = ()

            def list_blobs(self, **kwargs):
                calls.append(kwargs)
                if error is not None:
                    raise error
                yield from blobs or []

        return ReadContainer(), calls

    def test_azure_etag_canonicalization_accepts_only_strong_safe_tokens(self):
        for value, expected in (
            ("0x8DF0E2716DD645B", '"0x8DF0E2716DD645B"'),
            ("safe-token_1.2:3", '"safe-token_1.2:3"'),
            ('"0x8DF0E2716DD645B"', '"0x8DF0E2716DD645B"'),
        ):
            with self.subTest(value=value):
                self.assertEqual(
                    backup._canonical_azure_etag(value, "ETAG_INVALID", "etag"),
                    expected,
                )
        for value in (
            'W/"0x8DF0E2716DD645B"',
            "W/0x8DF0E2716DD645B",
            '"0x8DF0E2716DD645B',
            '0x8DF0E2716DD645B"',
            '""0x8DF0E2716DD645B""',
            "unsafe value",
            "unsafe\nvalue",
            "x" * 129,
            "",
            None,
        ):
            with (
                self.subTest(value=value),
                self.assertRaises(backup.ValidationFailure) as raised,
            ):
                backup._canonical_azure_etag(value, "ETAG_INVALID", "etag")
            self.assertEqual(
                (raised.exception.code, raised.exception.stage),
                ("ETAG_INVALID", "etag"),
            )

    def test_validation_list_returns_only_published_exact_snapshots_newest_first(self):
        modified = datetime(2026, 1, 3, tzinfo=timezone.utc)
        names = (
            "hriv-backup-20260101-020000-11111111",
            "hriv-backup-20260103-020000-33333333",
            "hriv-backup-20260102-020000-22222222",
        )
        blobs = [
            _ReadBlobItemFake(
                name=f"hriv-backups/{name}.tar.gz",
                metadata={"hriv_publication_state": "published", "harmless": "value"},
                size=index + 1,
                etag=f"etag-{index}",
                last_modified=modified - timedelta(days=index),
            )
            for index, name in enumerate(names)
        ]
        blobs.extend(
            [
                _ReadBlobItemFake(
                    name="hriv-backups/hriv-backup-20260104-020000-44444444.tar.gz",
                    metadata={"hriv_publication_state": "candidate"},
                ),
                _ReadBlobItemFake(
                    name="hriv-backups/hriv-backup-20260105-020000-55555555.tar.gz",
                    metadata={"hriv_publication_state": "unknown"},
                ),
                _ReadBlobItemFake(
                    name="hriv-backups/hriv-backup-20260106-020000-66666666.tar.gz",
                    metadata={},
                ),
                _ReadBlobItemFake(
                    name="hriv-backups/hriv-backup-20260107-020000-77777777.tar.gz",
                    metadata=None,
                ),
            ]
        )
        container, calls = self._validation_list_container(blobs)
        result = backup.validation_list(container=container)
        self.assertEqual(
            [entry["snapshot_name"] for entry in result["snapshots"]],
            [names[1], names[2], names[0]],
        )
        self.assertEqual(
            [entry["archive_etag"] for entry in result["snapshots"]],
            ['"etag-1"', '"etag-2"', '"etag-0"'],
        )
        self.assertEqual(
            set(result), {"schema_version", "operation", "success", "snapshots"}
        )
        self.assertEqual(result["operation"], "validation-list")
        self.assertEqual(
            set(result["snapshots"][0]),
            {
                "snapshot_name",
                "archive_blob",
                "archive_size",
                "archive_etag",
                "last_modified",
            },
        )
        self.assertIsNotNone(
            backup._parse_strict_utc(result["snapshots"][0]["last_modified"])
        )
        self.assertEqual(
            calls, [{"name_starts_with": "hriv-backups/", "include": ["metadata"]}]
        )
        self.assertFalse(
            any(hasattr(container, name) for name in ("upload_blob", "delete_blob"))
        )
        with self.assertRaises(AttributeError):
            container.upload_blob = lambda: None

    def test_validation_list_rejects_malformed_published_entries(self):
        valid = {
            "name": "hriv-backups/hriv-backup-20260101-020000-11111111.tar.gz",
            "metadata": {"hriv_publication_state": "published"},
            "size": 1,
            "etag": "0x8DF0E2716DD645B",
            "last_modified": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }
        invalid_overrides = (
            {"name": "hriv-backups/not-a-snapshot.tar.gz"},
            {"name": "hriv-backups/hriv-backup-20261301-020000-11111111.tar.gz"},
            {"name": "hriv-backups/nested/hriv-backup-20260101-020000-11111111.tar.gz"},
            {"size": 0},
            {"size": True},
            {"size": 2**63},
            {"etag": 'W/"0x8DF0E2716DD645B"'},
            {"etag": '"0x8DF0E2716DD645B'},
            {"etag": '0x8DF0E2716DD645B"'},
            {"etag": "unsafe value"},
            {"etag": "x" * 129},
            {"last_modified": datetime(2026, 1, 1)},
            {
                "last_modified": datetime(
                    2026, 1, 1, tzinfo=timezone(timedelta(hours=1))
                )
            },
            {"last_modified": "2026-01-01T00:00:00Z"},
        )
        for override in invalid_overrides:
            properties = dict(valid)
            properties.update(override)
            container, _calls = self._validation_list_container(
                [_ReadBlobItemFake(**properties)]
            )
            with self.subTest(override=override), self.assertRaises(
                backup.ValidationFailure
            ) as raised:
                backup.validation_list(container=container)
            self.assertEqual(raised.exception.code, "SNAPSHOT_LIST_ENTRY_INVALID")

    def test_validation_list_is_bounded_and_maps_configuration_and_storage_errors(self):
        blobs = [
            _ReadBlobItemFake(
                name=f"hriv-backups/hriv-backup-20260101-020000-{index:08x}.tar.gz",
                metadata={"hriv_publication_state": "candidate"},
            )
            for index in range(1001)
        ]
        container, _calls = self._validation_list_container(blobs)
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_list(container=container)
        self.assertEqual(raised.exception.code, "SNAPSHOT_LIST_TOO_LARGE")

        class AuthenticationError(Exception):
            pass

        container, _calls = self._validation_list_container(
            error=AuthenticationError("must not leak")
        )
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_list(container=container)
        self.assertEqual(raised.exception.code, "AZURE_AUTH_FAILED")
        self.assertNotIn("must not leak", str(raised.exception))
        with patch.object(backup, "AZURE_READ_SAS_URL", ""), self.assertRaises(
            backup.ValidationFailure
        ) as raised:
            backup.validation_list()
        self.assertEqual(raised.exception.code, "READ_SAS_MISSING")

    def _fixture(self):
        snapshot = "hriv-backup-20260101-020000-1234abcd"
        run_id = "run-1"
        completed = "2026-01-01T02:02:00.123457+00:00"
        manifest_completed = "2026-01-01T02:01:00+00:00"
        payload = b"source"
        metadata = {"size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        target_lsn = "1A/2B"
        capture_started = "2026-01-01T01:59:00+00:00"
        database_started = "2026-01-01T01:59:10.123456+00:00"
        filesystem_started = "2026-01-01T01:59:20.654321+00:00"
        target_time = "2026-01-01T02:00:00+00:00"
        manifest = {
            "format_version": 2,
            "schema_version": 2,
            "recovery_set_id": snapshot,
            "snapshot_name": snapshot,
            "run_id": run_id,
            "completed_at": manifest_completed,
            "capture_started_at": capture_started,
            "capture_boundary_at": target_time,
            "capture_boundary_lsn": target_lsn,
            "database_name": "hriv",
            "versions": {"hriv": "unknown", "backup": "unknown", "archive_format": 2},
            "backup_mode": "production",
            "tiles_excluded": True,
            "selection": "source_images",
            "files": {"data/source_images/image.jpg": metadata},
            "file_count": 1,
            "total_bytes": len(payload),
            "source_images": {
                "files": {"data/source_images/image.jpg": metadata},
                "file_count": 1,
                "included_file_count": 1,
                "total_bytes": len(payload),
                "database_row_count": 1,
                "included_row_count": 1,
                "missing_or_skipped_count": 0,
                "orphan_count": 0,
            },
            "excluded_incomplete_artifacts": [],
            "validation": {
                "accepted": True,
                "missing_sources": [],
                "orphan_sources": [],
                "excluded_incomplete_artifacts": [],
            },
            "database_recovery": {
                "provider": "cloudnative-pg",
                "cluster": "pg-core",
                "target_time": target_time,
                "target_lsn": target_lsn,
                "archive_timeout_seconds": 300,
                "wal_fence_file": "000000010000000000000001",
                "wal_fence_committed_at": "2026-01-01T02:00:10+00:00",
                "wal_fence_archived_at": "2026-01-01T02:00:20+00:00",
                "logical_dump_role": "not-included",
            },
        }
        sidecar = json.dumps(manifest, indent=2).encode()
        archive_buffer = io.BytesIO()
        with tarfile.open(fileobj=archive_buffer, mode="w:gz") as tar:
            info = tarfile.TarInfo(f"{snapshot}/data/source_images/image.jpg")
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
            info = tarfile.TarInfo(f"{snapshot}/manifest.json")
            info.size = len(sidecar)
            tar.addfile(info, io.BytesIO(sidecar))
        archive = archive_buffer.getvalue()
        archive_blob = f"hriv-backups/{snapshot}.tar.gz"
        database_key = f"cnpg://pg-core?target_time={target_time}&target_lsn={target_lsn}"
        state = {
            "schema_version": 2,
            "snapshot_name": snapshot,
            "run_id": run_id,
            "backup_mode": "production",
            "tiles_excluded": True,
            "storage_prefix": "hriv-backups",
            "updated_at": "2026-01-01T02:03:00+00:00",
            "attempts": [{"bounded_observability": True}],
            "failure_reason": None,
            "database": {
                "run_id": run_id,
                "success": True,
                "completed_at": completed,
                "archive_key": database_key,
                "size_bytes": None,
                "started_at": database_started,
                "duration_seconds": 170.000001,
                "last_success_started_at": database_started,
                "last_success_completed_at": completed,
                "last_success_duration_seconds": 170.000001,
                "last_success_size_bytes": None,
                "last_success_archive_key": database_key,
            },
            "filesystem": {
                "run_id": run_id,
                "success": True,
                "completed_at": completed,
                "archive_key": archive_blob,
                "size_bytes": len(payload),
                "started_at": filesystem_started,
                "duration_seconds": 159.469136,
                "last_success_started_at": filesystem_started,
                "last_success_completed_at": completed,
                "last_success_duration_seconds": 159.469136,
                "last_success_size_bytes": len(payload),
                "last_success_archive_key": archive_blob,
            },
        }
        marker = {
            "snapshot_name": snapshot,
            "run_id": run_id,
            "created_at": capture_started,
            "completed_at": completed,
            "backup_mode": "production",
            "tiles_excluded": True,
            "archive_size": len(archive),
            "types": {
                name: {
                    "run_id": run_id,
                    "snapshot_name": snapshot,
                    "created_at": section["started_at"],
                    "completed_at": completed,
                    "archive_key": section["archive_key"],
                    "size_bytes": section["size_bytes"],
                }
                for name, section in (
                    ("database", state["database"]),
                    ("filesystem", state["filesystem"]),
                )
            },
        }

        blobs = {
            "hriv-backups/LAST_SUCCESS.json": json.dumps(marker).encode(),
            "hriv-backups/BACKUP_STATE.json": json.dumps(state).encode(),
            f"hriv-backups/{snapshot}.manifest.json": sidecar,
            archive_blob: archive,
        }
        calls = []
        property_overrides = {}

        class Blob:
            __slots__ = ("name",)

            def __init__(self, name):
                self.name = name

            def get_blob_properties(self):
                calls.append(("head", self.name))
                if self.name not in blobs:
                    raise backup.ResourceNotFoundError("missing")
                defaults = {
                    "size": len(blobs[self.name]),
                    "etag": "0x8DF0E2716DD645B",
                    "metadata": (
                        {"hriv_publication_state": "published"}
                        if self.name == archive_blob
                        else {}
                    ),
                }
                defaults.update(property_overrides.get(self.name, {}))
                return _ReadBlobPropertiesFake(**defaults)

        class Download:
            __slots__ = ("value",)

            def __init__(self, value):
                self.value = value

            def readall(self):
                return self.value

            def chunks(self):
                yield self.value

        class Container:
            __slots__ = (
                "download_kwargs",
                "property_overrides",
                "download_error_suffix",
            )

            def __init__(self):
                self.download_kwargs = []
                self.property_overrides = property_overrides
                self.download_error_suffix = None

            def get_blob_client(self, name):
                calls.append(("get", name))
                return Blob(name)

            def download_blob(self, name, **kwargs):
                calls.append(("download", name))
                self.download_kwargs.append((name, kwargs))
                if self.download_error_suffix and name.endswith(self.download_error_suffix):
                    raise backup.ResourceModifiedError("changed")
                if name not in blobs:
                    raise backup.ResourceNotFoundError("missing")
                return Download(blobs[name][: kwargs.get("length")])

        return snapshot, manifest, sidecar, blobs, Container(), calls

    def _archive_with_members(self, members):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
            for name, payload in members:
                info = tarfile.TarInfo(name)
                if payload is None:
                    info.type = tarfile.DIRTYPE
                    info.size = 0
                    tar.addfile(info)
                else:
                    info.size = len(payload)
                    tar.addfile(info, io.BytesIO(payload))
        return buffer.getvalue()

    def test_strict_select_success_and_exact_snapshot(self):
        snapshot, _manifest, sidecar, _blobs, container, calls = self._fixture()
        result = backup.validation_select(snapshot, container=container)
        self.assertTrue(result["success"])
        self.assertEqual(result["manifest_sha256"], hashlib.sha256(sidecar).hexdigest())
        self.assertEqual(result["archive_etag"], '"0x8DF0E2716DD645B"')
        self.assertEqual(result["target_timeline"], 1)
        self.assertEqual(
            result["source_state"], {"missing_sources": [], "orphan_sources": []}
        )
        self.assertEqual(result["excluded_artifacts"], [])
        self.assertEqual(result["capture_started_at"], "2026-01-01T01:59:00Z")
        self.assertEqual(result["wal_fence_file"], "000000010000000000000001")
        self.assertEqual(result["wal_fence_committed_at"], "2026-01-01T02:00:10Z")
        self.assertEqual(result["wal_fence_archived_at"], "2026-01-01T02:00:20Z")
        self.assertEqual(result["completed_at"], "2026-01-01T02:01:00Z")
        self.assertNotIn("source_files", result)
        self.assertTrue(
            all(operation in {"get", "head", "download"} for operation, _ in calls)
        )
        kwargs = dict(container.download_kwargs)
        self.assertTrue(all(options["offset"] == 0 for options in kwargs.values()))
        self.assertEqual(
            kwargs["hriv-backups/LAST_SUCCESS.json"]["length"], 1024 * 1024 + 1
        )
        self.assertEqual(
            kwargs["hriv-backups/BACKUP_STATE.json"]["length"], 4 * 1024 * 1024 + 1
        )
        sidecar_kwargs = kwargs[f"hriv-backups/{snapshot}.manifest.json"]
        self.assertEqual(sidecar_kwargs["etag"], '"0x8DF0E2716DD645B"')
        self.assertEqual(
            sidecar_kwargs["match_condition"], backup.MatchConditions.IfNotModified
        )
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_select(snapshot + "x", container=container)
        self.assertEqual(raised.exception.code, "SNAPSHOT_MISMATCH")

    def test_selection_emits_canonical_source_files_digest_without_inventory(self):
        snapshot, manifest, _sidecar, _blobs, container, _calls = self._fixture()
        expected_files = {
            path: {"size": metadata["size"], "sha256": metadata["sha256"]}
            for path, metadata in sorted(manifest["files"].items())
        }
        expected = hashlib.sha256(json.dumps(expected_files, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        summary = backup._validation_manifest_summary(manifest)
        result = backup.validation_select(snapshot, container=container)
        self.assertEqual(expected, summary["source_files_sha256"])
        self.assertEqual(expected, result["source_files_sha256"])
        self.assertNotIn("files", backup._public_validation_result(result))

    def test_manifest_summary_rejects_non_lowercase_source_sha(self):
        _snapshot, manifest, _sidecar, _blobs, _container, _calls = self._fixture()
        manifest["files"][next(iter(manifest["files"]))]["sha256"] = "A" * 64
        with self.assertRaises(backup.ValidationFailure):
            backup._validation_manifest_summary(manifest)

    def test_strict_select_preserves_quoted_property_etags(self):
        snapshot, _manifest, _sidecar, _blobs, container, _calls = self._fixture()
        quoted = '"0x8DF0E2716DD645B"'
        for name in (
            f"hriv-backups/{snapshot}.tar.gz",
            f"hriv-backups/{snapshot}.manifest.json",
        ):
            container.property_overrides[name] = {"etag": quoted}

        result = backup.validation_select(snapshot, container=container)

        self.assertEqual(result["archive_etag"], quoted)
        sidecar_kwargs = dict(container.download_kwargs)[
            f"hriv-backups/{snapshot}.manifest.json"
        ]
        self.assertEqual(sidecar_kwargs["etag"], quoted)

    def test_azure_sdk_emits_quoted_if_match_header(self):
        from azure.core.pipeline.transport import HttpTransport

        class RequestCaptured(Exception):
            pass

        class CapturingTransport(HttpTransport):
            def __init__(self):
                self.request = None

            def open(self):
                pass

            def close(self):
                pass

            def __exit__(self, *_args):
                self.close()

            def send(self, request, **_kwargs):
                self.request = request
                raise RequestCaptured

        transport = CapturingTransport()
        client = backup.ContainerClient(
            account_url="http://127.0.0.1:10000/localaccount",
            container_name="test-container",
            credential="sv=local-test&sig=fake-local-token",
            transport=transport,
            retry_total=0,
        )
        canonical = backup._canonical_azure_etag(
            "0x8DF0E2716DD645B", "ETAG_INVALID", "etag"
        )

        with self.assertRaises(RequestCaptured):
            client.download_blob(
                "archive.tar.gz",
                offset=0,
                length=2,
                etag=canonical,
                match_condition=backup.MatchConditions.IfNotModified,
            )

        self.assertIsNotNone(transport.request)
        self.assertEqual(transport.request.headers.get("If-Match"), canonical)
        self.assertEqual(transport.request.headers.get("x-ms-range"), "bytes=0-1")

    def test_strict_select_accepts_independent_component_starts_and_binds_each_one(
        self,
    ):
        snapshot, manifest, _sidecar, blobs, container, _calls = self._fixture()
        marker_name = "hriv-backups/LAST_SUCCESS.json"
        state_name = "hriv-backups/BACKUP_STATE.json"
        marker = json.loads(blobs[marker_name])
        state = json.loads(blobs[state_name])
        database_started = state["database"]["last_success_started_at"]
        filesystem_started = state["filesystem"]["last_success_started_at"]
        self.assertEqual(marker["created_at"], manifest["capture_started_at"])
        canonical_manifest = copy.deepcopy(manifest)
        canonical_manifest["capture_started_at"] = "2026-01-01T01:59:00Z"
        self.assertEqual(
            backup._validation_manifest_summary(canonical_manifest)["capture_started_at"],
            "2026-01-01T01:59:00Z",
        )
        self.assertNotEqual(database_started, marker["created_at"])
        self.assertNotEqual(filesystem_started, marker["created_at"])
        self.assertNotEqual(database_started, filesystem_started)
        self.assertTrue(backup.validation_select(snapshot, container=container)["success"])

        for corruption in ("swap", "single"):
            snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
            marker = json.loads(blobs[marker_name])
            if corruption == "swap":
                database_created = marker["types"]["database"]["created_at"]
                marker["types"]["database"]["created_at"] = marker["types"][
                    "filesystem"
                ]["created_at"]
                marker["types"]["filesystem"]["created_at"] = database_created
            else:
                marker["types"]["database"]["created_at"] = (
                    "2026-01-01T01:59:11+00:00"
                )
            blobs[marker_name] = json.dumps(marker).encode()
            with self.subTest(corruption=corruption), self.assertRaises(
                backup.ValidationFailure
            ) as raised:
                backup.validation_select(snapshot, container=container)
            self.assertEqual(raised.exception.code, "COMPONENT_INCOHERENT")

    def test_component_duration_matches_timestamp_delta_with_microseconds(self):
        snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
        state_name = "hriv-backups/BACKUP_STATE.json"
        state = json.loads(blobs[state_name])
        self.assertEqual(
            state["database"]["last_success_duration_seconds"], 170.000001
        )
        self.assertEqual(
            state["filesystem"]["last_success_duration_seconds"], 159.469136
        )
        self.assertTrue(backup.validation_select(snapshot, container=container)["success"])

        for component in ("database", "filesystem"):
            snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
            state = json.loads(blobs[state_name])
            state[component]["last_success_duration_seconds"] += 0.001
            blobs[state_name] = json.dumps(state).encode()
            with self.subTest(component=component), self.assertRaises(
                backup.ValidationFailure
            ) as raised:
                backup.validation_select(snapshot, container=container)
            self.assertEqual(raised.exception.code, "COMPONENT_INCOHERENT")

    def test_component_completion_cannot_precede_start(self):
        snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
        marker_name = "hriv-backups/LAST_SUCCESS.json"
        state_name = "hriv-backups/BACKUP_STATE.json"
        marker = json.loads(blobs[marker_name])
        state = json.loads(blobs[state_name])
        invalid_start = "2026-01-01T02:03:00+00:00"
        marker["types"]["database"]["created_at"] = invalid_start
        state["database"]["last_success_started_at"] = invalid_start
        state["database"]["last_success_duration_seconds"] = 0.0
        blobs[marker_name] = json.dumps(marker).encode()
        blobs[state_name] = json.dumps(state).encode()
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_select(snapshot, container=container)
        self.assertEqual(raised.exception.code, "COMPONENT_INCOHERENT")

    def test_marker_top_created_at_must_match_manifest_capture_start(self):
        snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
        marker_name = "hriv-backups/LAST_SUCCESS.json"
        marker = json.loads(blobs[marker_name])
        marker["created_at"] = "2026-01-01T01:59:01+00:00"
        blobs[marker_name] = json.dumps(marker).encode()
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_select(snapshot, container=container)
        self.assertEqual(raised.exception.code, "RECOVERY_SET_INCOHERENT")

    def test_read_only_selection_fake_forbids_mutation_capabilities(self):
        _snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
        marker_name = "hriv-backups/LAST_SUCCESS.json"
        read_objects = (
            container,
            container.get_blob_client(marker_name),
            container.download_blob(marker_name),
            _ReadBlobItemFake(name=marker_name, metadata={}),
            _ReadBlobPropertiesFake(size=len(blobs[marker_name]), etag='"etag"', metadata={}),
        )
        for read_object in read_objects:
            for name in (
                "upload_blob",
                "delete_blob",
                "set_container_metadata",
                "stage_block",
                "commit_block_list",
            ):
                with self.subTest(type=type(read_object).__name__, name=name):
                    self.assertFalse(hasattr(read_object, name))
                    with self.assertRaises(AttributeError):
                        setattr(read_object, name, lambda: None)

    def test_strict_select_uses_last_success_when_newer_attempt_is_pending_or_failed(self):
        for attempt_success in (None, False):
            snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
            state_name = "hriv-backups/BACKUP_STATE.json"
            state = json.loads(blobs[state_name])
            state.update(
                run_id="run-2",
                snapshot_name="hriv-backup-20260102-020000-87654321",
                updated_at="2026-01-02T02:03:00+00:00",
                failure_reason="permanent failure" if attempt_success is False else None,
            )
            for section in (state["database"], state["filesystem"]):
                section.update(
                    run_id="run-2",
                    started_at="2026-01-02T02:00:00+00:00",
                    completed_at=(
                        "2026-01-02T02:02:00+00:00"
                        if attempt_success is False
                        else None
                    ),
                    success=attempt_success,
                    duration_seconds=120.0 if attempt_success is False else None,
                    size_bytes=None,
                    archive_key=None,
                )
            blobs[state_name] = json.dumps(state).encode()
            with self.subTest(attempt_success=attempt_success):
                result = backup.validation_select(snapshot, container=container)
            self.assertEqual(result["run_id"], "run-1")
            self.assertEqual(result["snapshot_name"], snapshot)

    def test_strict_select_rejects_corrupt_component_last_success_fields(self):
        corruptions = {
            "last_success_started_at": "2026-01-01T02:00:01+00:00",
            "last_success_completed_at": "2026-01-01T02:02:01+00:00",
            "last_success_duration_seconds": -1,
            "last_success_size_bytes": 999,
            "last_success_archive_key": "wrong-key",
        }
        for component in ("database", "filesystem"):
            for field, value in corruptions.items():
                snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
                state_name = "hriv-backups/BACKUP_STATE.json"
                state = json.loads(blobs[state_name])
                state[component][field] = value
                blobs[state_name] = json.dumps(state).encode()
                with self.subTest(component=component, field=field), self.assertRaises(
                    backup.ValidationFailure
                ) as raised:
                    backup.validation_select(snapshot, container=container)
                self.assertEqual(raised.exception.code, "COMPONENT_INCOHERENT")

    def test_strict_select_rejects_candidate_journal_and_incoherence(self):
        snapshot, manifest, _sidecar, blobs, container, _calls = self._fixture()
        blobs[f"hriv-backups/.publication-{snapshot}.json"] = b"{}"
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_select(container=container)
        self.assertEqual(raised.exception.code, "PUBLICATION_INCOMPLETE")
        blobs.pop(f"hriv-backups/.publication-{snapshot}.json")
        manifest["run_id"] = "wrong"
        blobs[f"hriv-backups/{snapshot}.manifest.json"] = json.dumps(manifest).encode()
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_select(container=container)
        self.assertEqual(raised.exception.code, "RECOVERY_SET_INCOHERENT")

    def test_selection_accepts_real_state_optional_fields_and_rejects_invalid_observability(self):
        snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
        state_name = "hriv-backups/BACKUP_STATE.json"
        state = json.loads(blobs[state_name])
        self.assertEqual(
            {"updated_at", "attempts", "failure_reason"} & set(state),
            {"updated_at", "attempts", "failure_reason"},
        )
        self.assertTrue(backup.validation_select(snapshot, container=container)["success"])
        snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
        state = json.loads(blobs[state_name])
        for key in ("updated_at", "attempts", "failure_reason"):
            state.pop(key)
        blobs[state_name] = json.dumps(state).encode()
        self.assertTrue(backup.validation_select(snapshot, container=container)["success"])

        invalid_values = (
            ("attempts", [{}] * 11),
            ("attempts", ["not-an-object"]),
            ("attempts", {}),
            ("failure_reason", 1),
            ("failure_reason", "x" * 1025),
            ("unexpected", True),
        )
        for key, value in invalid_values:
            snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
            state = json.loads(blobs[state_name])
            state[key] = value
            blobs[state_name] = json.dumps(state).encode()
            with self.subTest(key=key, value_type=type(value).__name__), self.assertRaises(
                backup.ValidationFailure
            ) as raised:
                backup.validation_select(snapshot, container=container)
            self.assertEqual(raised.exception.code, "STATE_DOCUMENT_INVALID")

    def test_selection_requires_configured_cnpg_cluster_to_match_manifest(self):
        snapshot, _manifest, _sidecar, _blobs, container, _calls = self._fixture()
        with patch.object(backup, "CNPG_CLUSTER_NAME", "different-cluster"):
            with self.assertRaises(backup.ValidationFailure) as raised:
                backup.validation_select(snapshot, container=container)
        self.assertEqual(raised.exception.code, "CNPG_METADATA_INVALID")

    def test_selection_rejects_invalid_marker_timestamp(self):
        snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
        marker_name = "hriv-backups/LAST_SUCCESS.json"
        marker = json.loads(blobs[marker_name])
        marker["completed_at"] = "2026-01-01 02:02:00Z"
        blobs[marker_name] = json.dumps(marker).encode()
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_select(snapshot, container=container)
        self.assertEqual(raised.exception.code, "RECOVERY_SET_INCOHERENT")

    def test_selection_rejects_unsafe_blob_prefix_before_reads(self):
        snapshot, _manifest, _sidecar, _blobs, container, calls = self._fixture()
        with patch.object(backup, "AZURE_BLOB_PREFIX", "../wrong"), self.assertRaises(
            backup.ValidationFailure
        ) as raised:
            backup.validation_select(snapshot, container=container)
        self.assertEqual(raised.exception.code, "ARCHIVE_PREFIX_INVALID")
        self.assertEqual(calls, [])

    def test_selection_reports_missing_documents_and_rejects_archive_metadata(self):
        missing_cases = (
            ("hriv-backups/LAST_SUCCESS.json", "MARKER_MISSING"),
            ("hriv-backups/BACKUP_STATE.json", "STATE_MISSING"),
        )
        for blob_name, expected in missing_cases:
            snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
            blobs.pop(blob_name)
            with self.subTest(blob_name=blob_name), self.assertRaises(
                backup.ValidationFailure
            ) as raised:
                backup.validation_select(snapshot, container=container)
            self.assertEqual(raised.exception.code, expected)
        for suffix, expected in ((".manifest.json", "SIDECAR_MISSING"), (".tar.gz", "ARCHIVE_MISSING")):
            snapshot, _manifest, _sidecar, blobs, container, _calls = self._fixture()
            name = next(name for name in blobs if name.endswith(suffix))
            blobs.pop(name)
            with self.subTest(name=name), self.assertRaises(backup.ValidationFailure) as raised:
                backup.validation_select(snapshot, container=container)
            self.assertEqual(raised.exception.code, expected)
        for metadata in ({}, {"hriv_publication_state": "candidate"}, {"hriv_publication_state": "unknown"}):
            snapshot, _manifest, _sidecar, _blobs, container, _calls = self._fixture()
            archive_name = f"hriv-backups/{snapshot}.tar.gz"
            container.property_overrides[archive_name] = {"metadata": metadata}
            with self.subTest(metadata=metadata), self.assertRaises(backup.ValidationFailure) as raised:
                backup.validation_select(snapshot, container=container)
            self.assertEqual(raised.exception.code, "ARCHIVE_NOT_PUBLISHED")
        snapshot, _manifest, _sidecar, _blobs, container, _calls = self._fixture()
        archive_name = f"hriv-backups/{snapshot}.tar.gz"
        container.property_overrides[archive_name] = {
            "metadata": {"hriv_publication_state": "published", "harmless": "value"}
        }
        self.assertTrue(
            backup.validation_select(snapshot, container=container)["success"]
        )
        for suffix, expected in (
            (".tar.gz", "ARCHIVE_PROPERTIES_INVALID"),
            (".manifest.json", "SIDECAR_INVALID"),
        ):
            for malformed in (
                'W/"0x8DF0E2716DD645B"',
                '"0x8DF0E2716DD645B',
                '0x8DF0E2716DD645B"',
                'unsafe\n"',
                "x" * 129,
            ):
                snapshot, _manifest, _sidecar, blobs, container, _calls = (
                    self._fixture()
                )
                name = next(name for name in blobs if name.endswith(suffix))
                container.property_overrides[name] = {"etag": malformed}
                with (
                    self.subTest(name=name, etag=malformed),
                    self.assertRaises(backup.ValidationFailure) as raised,
                ):
                    backup.validation_select(snapshot, container=container)
                self.assertEqual(raised.exception.code, expected)

    def test_azure_auth_and_service_errors_are_bounded(self):
        class AuthenticationError(Exception):
            pass

        class ServiceError(Exception):
            pass

        class ErrorContainer:
            __slots__ = ("error",)

            def __init__(self, error):
                self.error = error

            def download_blob(self, _name, **_kwargs):
                raise self.error

        for error, code in ((AuthenticationError("secret URL"), "AZURE_AUTH_FAILED"), (ServiceError("secret URL"), "AZURE_READ_FAILED")):
            container = ErrorContainer(error)
            with self.subTest(code=code), self.assertRaises(backup.ValidationFailure) as raised:
                backup._validation_download(container, "marker", "marker", 10)
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn("secret", str(raised.exception))

    def test_conditional_sidecar_and_archive_mutation_are_rejected(self):
        snapshot, _manifest, sidecar, _blobs, container, _calls = self._fixture()
        container.download_error_suffix = ".manifest.json"
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup.validation_select(snapshot, container=container)
        self.assertEqual((raised.exception.code, raised.exception.stage), ("SOURCE_CHANGED", "sidecar"))

        snapshot, _manifest, sidecar, _blobs, container, _calls = self._fixture()
        container.download_error_suffix = ".tar.gz"
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(
            backup.ValidationFailure
        ) as raised:
            target = Path(directory).resolve() / "target"
            backup.restore_filesystem_stateless(
                snapshot,
                data_dir=str(target),
                expected_recovery_set_id=snapshot,
                expected_manifest_sha256=hashlib.sha256(sidecar).hexdigest(),
                container=container,
            )
        self.assertEqual((raised.exception.code, raised.exception.stage), ("SOURCE_CHANGED", "archive-download"))
        self.assertFalse((target / "source_images").exists())

    def test_strict_json_rejects_duplicate_nonfinite_and_non_utf8(self):
        for payload in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}', b'\xff'):
            with self.subTest(payload=payload), self.assertRaises(
                backup.ValidationFailure
            ) as raised:
                backup._validation_json(payload, "sidecar")
            self.assertEqual(raised.exception.code, "SIDECAR_INVALID")

    def test_manifest_requires_emitted_identity_versions_and_bounded_paths(self):
        _snapshot, manifest, _sidecar, _blobs, _container, _calls = self._fixture()
        self.assertEqual(backup._validation_manifest_summary(copy.deepcopy(manifest))["file_count"], 1)
        invalid = []
        candidate = copy.deepcopy(manifest)
        candidate["versions"].pop("backup")
        invalid.append(candidate)
        candidate = copy.deepcopy(manifest)
        candidate["database_name"] = "app"
        invalid.append(candidate)
        candidate = copy.deepcopy(manifest)
        candidate["run_id"] = " bad "
        invalid.append(candidate)
        candidate = copy.deepcopy(manifest)
        candidate["capture_started_at"] = "2026-01-01 01:59:00Z"
        invalid.append(candidate)
        candidate = copy.deepcopy(manifest)
        candidate["database_recovery"]["wal_fence_file"] = "0" * 24
        invalid.append(candidate)
        candidate = copy.deepcopy(manifest)
        candidate["database_recovery"]["wal_fence_file"] = "0000000a0000000000000001"
        invalid.append(candidate)
        candidate = copy.deepcopy(manifest)
        candidate["source_images"]["file_count"] = 2
        invalid.append(candidate)
        candidate = copy.deepcopy(manifest)
        candidate["files"] = {"data/source_images/../bad": next(iter(manifest["files"].values()))}
        invalid.append(candidate)
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(backup.ValidationFailure):
                backup._validation_manifest_summary(candidate)
        too_long_after_prefix = "source_images/" + "a" * 498
        with self.assertRaises(backup.ValidationFailure):
            backup._canonical_source_path(too_long_after_prefix)

    def test_excluded_artifacts_match_incomplete_segments_and_suffixes_case_insensitively(self):
        _snapshot, manifest, _sidecar, _blobs, _container, _calls = self._fixture()
        paths = [
            "data/source_images/MiXeD/.StAgInG/file.jpg",
            "data/source_images/MiXeD/photo.PaRt",
            "data/source_images/AdMiN/file.jpg",
        ]
        excluded = [
            {"path": path, "reason": "incomplete_or_non_authoritative"}
            for path in paths
        ]
        manifest["excluded_incomplete_artifacts"] = excluded
        manifest["validation"]["excluded_incomplete_artifacts"] = excluded
        summary = backup._validation_manifest_summary(manifest)
        self.assertEqual(
            [entry["path"] for entry in summary["excluded_artifacts"]], sorted(paths)
        )
        invalid = copy.deepcopy(manifest)
        invalid["excluded_incomplete_artifacts"][0]["path"] = (
            "data/source_images/MiXeD/staging-file.jpg"
        )
        invalid["validation"]["excluded_incomplete_artifacts"] = invalid[
            "excluded_incomplete_artifacts"
        ]
        with self.assertRaises(backup.ValidationFailure) as raised:
            backup._validation_manifest_summary(invalid)
        self.assertEqual(raised.exception.code, "EXCLUDED_ARTIFACT_UNAPPROVED")

    def test_bounded_reader_rejects_under_over_and_interrupted_streams(self):
        class Download:
            __slots__ = ("_chunks",)

            def __init__(self, chunks):
                self._chunks = chunks

            def chunks(self):
                yield from self._chunks

        over = backup._AzureChunkReader(Download([b"123", b"4"]), expected_size=3)
        with self.assertRaises(backup.ValidationFailure) as raised:
            over.read()
        self.assertEqual(raised.exception.code, "ARCHIVE_SIZE_MISMATCH")
        under = backup._AzureChunkReader(Download([b"12"]), expected_size=3)
        under.read()
        with self.assertRaises(backup.ValidationFailure) as raised:
            under.validate_eof()
        self.assertEqual(raised.exception.code, "ARCHIVE_SIZE_MISMATCH")

        class Interrupted:
            __slots__ = ()

            def chunks(self):
                yield b"1"
                raise RuntimeError("service interrupted")

        interrupted = backup._AzureChunkReader(Interrupted(), expected_size=3)
        with self.assertRaises(RuntimeError):
            interrupted.validate_eof()

    def test_archive_rejects_extra_and_duplicate_members_without_promotion(self):
        snapshot, manifest, sidecar, _blobs, container, _calls = self._fixture()
        selection = backup.validation_select(snapshot, container=container)
        source_name = f"{snapshot}/data/source_images/image.jpg"
        manifest_name = f"{snapshot}/manifest.json"
        cases = (
            [(source_name, b"source"), (manifest_name, sidecar), (f"{snapshot}/db.sql", b"bad")],
            [(f"{snapshot}/arbitrary", None), (source_name, b"source"), (manifest_name, sidecar)],
            [(source_name, b"source"), (manifest_name, sidecar), (manifest_name, sidecar)],
            [(source_name, b"source"), (source_name, b"source"), (manifest_name, sidecar)],
            [(f"{snapshot}/data/source_images/../bad", b"bad"), (manifest_name, sidecar)],
        )
        for members in cases:
            with self.subTest(members=[name for name, _ in members]), tempfile.TemporaryDirectory() as directory:
                target = Path(directory).resolve()
                archive = self._archive_with_members(members)
                with self.assertRaises(backup.ValidationFailure):
                    backup._stateless_restore_stream(io.BytesIO(archive), selection, target)
                self.assertFalse((target / "source_images").exists())

    def test_target_preflight_rejects_overlap_symlinks_and_invalid_parents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            production = root / "production"
            production.mkdir()
            with patch.object(backup, "DATA_DIR", str(production)):
                for unsafe in (
                    production,
                    production / "child",
                    root,
                    Path("/data"),
                    Path("/data/child"),
                    Path("/backups"),
                    Path("/backups/child"),
                ):
                    with self.subTest(unsafe=unsafe), self.assertRaises(
                        backup.ValidationFailure
                    ):
                        backup._stateless_target_preflight(str(unsafe))
            missing_parent = root / "missing" / "target"
            with self.assertRaises(backup.ValidationFailure) as raised:
                backup._stateless_target_preflight(str(missing_parent))
            self.assertEqual(raised.exception.code, "TARGET_PARENT_INVALID")
            real = root / "real"
            real.mkdir()
            symlink = root / "link"
            symlink.symlink_to(real, target_is_directory=True)
            for unsafe in (symlink, symlink / "child"):
                with self.assertRaises(backup.ValidationFailure) as raised:
                    backup._stateless_target_preflight(str(unsafe))
                self.assertEqual(raised.exception.code, "TARGET_UNSAFE")
            for unsafe in (str(root / "target") + "/", str(root / "x" / ".." / "target"), "relative"):
                with self.assertRaises(backup.ValidationFailure):
                    backup._stateless_target_preflight(unsafe)

    def test_target_preflight_preserves_existing_empty_directory_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "target"
            target.mkdir(mode=0o755)
            before = target.stat().st_mode
            self.assertEqual(backup._stateless_target_preflight(str(target)), target)
            self.assertEqual(target.stat().st_mode, before)

    def test_stateless_restore_uses_no_state_or_mutating_helpers(self):
        snapshot, _manifest, sidecar, _blobs, container, _calls = self._fixture()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "fresh"
            forbidden = (
                "_read_restore_state",
                "_write_restore_state",
                "_local_backup_dir",
                "_set_maintenance",
                "_restore_database_dump",
                "_reconcile_publications",
                "_cleanup_stale_candidates",
                "_write_publication_journal",
                "_delete_publication_journal",
            )
            patches = [patch.object(backup, name, side_effect=AssertionError(name)) for name in forbidden]
            with contextlib.ExitStack() as stack:
                for item in patches:
                    stack.enter_context(item)
                result = backup.restore_filesystem_stateless(
                    snapshot,
                    data_dir=str(target),
                    expected_recovery_set_id=snapshot,
                    expected_manifest_sha256=hashlib.sha256(sidecar).hexdigest(),
                    container=container,
                )
            self.assertEqual(
                (target / "source_images" / "image.jpg").read_bytes(), b"source"
            )
            self.assertEqual(result["restored_file_count"], 1)
            self.assertEqual(result["target_data_dir"], str(target))
            self.assertEqual(result["capture_started_at"], "2026-01-01T01:59:00Z")
            self.assertEqual(result["wal_fence_file"], "000000010000000000000001")
            self.assertEqual(result["wal_fence_committed_at"], "2026-01-01T02:00:10Z")
            self.assertEqual(result["wal_fence_archived_at"], "2026-01-01T02:00:20Z")
            self.assertFalse((target / "db.sql").exists())
            self.assertFalse((target / "tiles").exists())
            archive_kwargs = container.download_kwargs[-1][1]
            self.assertEqual(archive_kwargs["offset"], 0)
            self.assertEqual(archive_kwargs["length"], result["archive_size"] + 1)
            self.assertEqual(archive_kwargs["etag"], '"0x8DF0E2716DD645B"')
            self.assertEqual(
                archive_kwargs["match_condition"], backup.MatchConditions.IfNotModified
            )

    def test_pinned_target_rejects_entry_added_before_yield_and_restores_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "target"
            target.mkdir()
            original_cwd = Path.cwd()
            original_fchdir = os.fchdir
            injected = False

            def inject_after_target_chdir(fd):
                nonlocal injected
                original_fchdir(fd)
                if not injected:
                    injected = True
                    Path("intruder").write_text("concurrent")

            with patch.object(os, "fchdir", side_effect=inject_after_target_chdir):
                with self.assertRaises(backup.ValidationFailure) as raised:
                    with backup._pinned_stateless_target(str(target)):
                        self.fail("nonempty pinned target must not be yielded")
            self.assertEqual(raised.exception.code, "TARGET_NOT_EMPTY")
            self.assertEqual(Path.cwd(), original_cwd)

    def test_stateless_stream_rejects_content_added_during_extraction(self):
        snapshot, _manifest, _sidecar, _blobs, container, _calls = self._fixture()
        selection = backup.validation_select(snapshot, container=container)
        archive = container.download_blob(selection["archive_blob"]).readall()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve()

            class InjectingStream(io.BytesIO):
                def __init__(self, payload):
                    super().__init__(payload)
                    self.injected = False

                def read(self, size=-1):
                    if not self.injected:
                        self.injected = True
                        (target / "intruder").write_text("concurrent")
                    return super().read(size)

            with self.assertRaises(backup.ValidationFailure) as raised:
                backup._stateless_restore_stream(
                    InjectingStream(archive), selection, target
                )
            self.assertEqual(raised.exception.code, "TARGET_CHANGED")
            self.assertFalse((target / "source_images").exists())

    def test_stateless_stream_rechecks_target_immediately_before_promotion(self):
        snapshot, _manifest, _sidecar, _blobs, container, _calls = self._fixture()
        selection = backup.validation_select(snapshot, container=container)
        archive = container.download_blob(selection["archive_blob"]).readall()
        original_compare = hmac.compare_digest
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve()

            def inject_before_promotion(left, right):
                (target / "intruder").write_text("concurrent")
                return original_compare(left, right)

            with patch.object(
                backup.hmac, "compare_digest", side_effect=inject_before_promotion
            ), self.assertRaises(backup.ValidationFailure) as raised:
                backup._stateless_restore_stream(io.BytesIO(archive), selection, target)
            self.assertEqual(raised.exception.code, "TARGET_CHANGED")
            self.assertFalse((target / "source_images").exists())

    def test_stateless_stream_rechecks_target_after_promotion(self):
        snapshot, _manifest, _sidecar, _blobs, container, _calls = self._fixture()
        selection = backup.validation_select(snapshot, container=container)
        archive = container.download_blob(selection["archive_blob"]).readall()
        original_replace = os.replace
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve()

            def inject_after_promotion(source, destination):
                original_replace(source, destination)
                (target / "intruder").write_text("concurrent")

            with patch.object(
                backup.os, "replace", side_effect=inject_after_promotion
            ), self.assertRaises(backup.ValidationFailure) as raised:
                backup._stateless_restore_stream(io.BytesIO(archive), selection, target)
            self.assertEqual(raised.exception.code, "TARGET_CHANGED")

    def test_pinned_context_requires_exact_final_source_images_entry(self):
        snapshot, _manifest, sidecar, _blobs, container, _calls = self._fixture()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "target"
            with patch.object(
                backup, "_stateless_restore_stream", return_value=(1, 6)
            ), self.assertRaises(backup.ValidationFailure) as raised:
                backup.restore_filesystem_stateless(
                    snapshot,
                    data_dir=str(target),
                    expected_recovery_set_id=snapshot,
                    expected_manifest_sha256=hashlib.sha256(sidecar).hexdigest(),
                    container=container,
                )
            self.assertEqual(raised.exception.code, "TARGET_CHANGED")

    def test_stateless_restore_stays_on_pinned_inode_and_reports_target_replacement(self):
        snapshot, _manifest, sidecar, _blobs, container, _calls = self._fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / "target"
            moved = root / "pinned-original"
            escape = root / "escape"
            escape.mkdir()
            original_restore = backup._stateless_restore_stream

            def replace_target(stream, selection, relative_target, **kwargs):
                target.rename(moved)
                target.symlink_to(escape, target_is_directory=True)
                return original_restore(stream, selection, relative_target, **kwargs)

            with patch.object(
                backup, "_stateless_restore_stream", side_effect=replace_target
            ), self.assertRaises(backup.ValidationFailure) as raised:
                backup.restore_filesystem_stateless(
                    snapshot,
                    data_dir=str(target),
                    expected_recovery_set_id=snapshot,
                    expected_manifest_sha256=hashlib.sha256(sidecar).hexdigest(),
                    container=container,
                )
            self.assertEqual(raised.exception.code, "TARGET_CHANGED")
            self.assertEqual(
                (moved / "source_images" / "image.jpg").read_bytes(), b"source"
            )
            self.assertEqual(list(escape.iterdir()), [])

    def test_pinned_target_open_rejects_pre_open_symlink_swap(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / "target"
            target.mkdir()
            moved = root / "original"
            escape = root / "escape"
            escape.mkdir()
            original_open = os.open
            swapped = False

            def swap_before_target_open(path, flags, *args, **kwargs):
                nonlocal swapped
                if path == target.name and kwargs.get("dir_fd") is not None and not swapped:
                    swapped = True
                    target.rename(moved)
                    target.symlink_to(escape, target_is_directory=True)
                return original_open(path, flags, *args, **kwargs)

            with patch.object(os, "open", side_effect=swap_before_target_open):
                with self.assertRaises(backup.ValidationFailure) as raised:
                    with backup._pinned_stateless_target(str(target)):
                        self.fail("symlink target must not open")
            self.assertEqual(raised.exception.code, "TARGET_CHANGED")
            self.assertEqual(list(escape.iterdir()), [])

    def test_stateless_preflight_rejects_nonempty_before_archive_download(self):
        snapshot, _manifest, sidecar, _blobs, container, calls = self._fixture()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / "target"
            target.mkdir()
            (target / "existing").write_text("no")
            with self.assertRaises(backup.ValidationFailure) as raised:
                backup.restore_filesystem_stateless(
                    snapshot,
                    data_dir=str(target),
                    expected_recovery_set_id=snapshot,
                    expected_manifest_sha256=hashlib.sha256(sidecar).hexdigest(),
                    container=container,
                )
            self.assertEqual(raised.exception.code, "TARGET_NOT_EMPTY")
            self.assertEqual(calls, [])

    def test_machine_options_reject_whitespace_option_tokens_and_duplicates(self):
        required = ("--data-dir", "--expected-recovery-set-id", "--expected-manifest-sha256")
        invalid = (
            ["snapshot", "--data-dir", " /tmp/x", "--expected-recovery-set-id", "id", "--expected-manifest-sha256", "a" * 64],
            ["snapshot", "--data-dir", "--expected-recovery-set-id", "id", "--expected-manifest-sha256", "a" * 64],
            ["snapshot", "--unknown", "value"],
            ["snapshot", "--data-dir=/tmp/x", "--data-dir=/tmp/y", "--expected-recovery-set-id=id", "--expected-manifest-sha256=" + "a" * 64],
            [" snapshot", "--data-dir=/tmp/x", "--expected-recovery-set-id=id", "--expected-manifest-sha256=" + "a" * 64],
        )
        for args in invalid:
            with self.subTest(args=args), self.assertRaises(backup.ValidationFailure):
                backup._machine_options(args, required)
        for invalid_snapshot in ("prefix", "hriv-backup-20260101-020000-extra", " snapshot"):
            with self.assertRaises(backup.ValidationFailure):
                backup._exact_validation_snapshot(invalid_snapshot)

    def test_machine_cli_prints_exactly_one_json_document(self):
        success = {"schema_version": 1, "operation": "validation-select", "success": True}
        for selected, expected_code in ((success, 0), (backup.ValidationFailure("MARKER_MISSING", "marker"), 1)):
            stdout = io.StringIO()
            effect = selected if isinstance(selected, Exception) else None
            result = None if effect else selected
            with self.subTest(expected_code=expected_code), patch.object(
                backup, "validation_select", return_value=result, side_effect=effect
            ), patch.object(sys, "argv", ["backup.py", "validation-select"]), contextlib.redirect_stdout(stdout):
                with self.assertRaises(SystemExit) as raised:
                    backup.main()
            self.assertEqual(raised.exception.code, expected_code)
            lines = stdout.getvalue().splitlines()
            self.assertEqual(len(lines), 1)
            document = json.loads(lines[0])
            self.assertIsInstance(document, dict)
            if expected_code == 1:
                self.assertEqual(document, {"schema_version": 1, "operation": "validation-select", "success": False, "failure_code": "MARKER_MISSING", "failure_stage": "marker"})

    def test_machine_cli_invalid_validation_config_is_one_bounded_document(self):
        script = Path(backup.__file__).resolve()
        env = os.environ.copy()
        env["VALIDATION_MIN_SAS_VALIDITY_SECONDS"] = "not-a-number"
        cases = (
            ["validation-list"],
            ["validation-select"],
            ["restore-filesystem-stateless"],
        )
        for args in cases:
            completed = subprocess.run(
                [sys.executable, str(script), *args],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            with self.subTest(command=args[0]):
                self.assertEqual(completed.returncode, 1)
                lines = completed.stdout.splitlines()
                self.assertEqual(len(lines), 1)
                document = json.loads(lines[0])
                self.assertEqual(document["operation"], args[0])
                self.assertEqual(document["failure_code"], "VALIDATION_CONFIG_INVALID")
                self.assertNotIn("not-a-number", completed.stdout)

        completed = subprocess.run(
            [sys.executable, str(script), "list"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0)
        self.assertNotIn("VALIDATION_CONFIG_INVALID", completed.stdout)

    def test_validation_list_cli_prints_exactly_one_json_document(self):
        success = {
            "schema_version": 1,
            "operation": "validation-list",
            "success": True,
            "snapshots": [],
        }
        cases = (
            (success, None, 0),
            (None, backup.ValidationFailure("READ_SAS_MISSING", "configuration"), 1),
        )
        for result, effect, expected_code in cases:
            stdout = io.StringIO()
            with self.subTest(expected_code=expected_code), patch.object(
                backup, "validation_list", return_value=result, side_effect=effect
            ), patch.object(
                sys, "argv", ["backup.py", "validation-list"]
            ), contextlib.redirect_stdout(stdout):
                with self.assertRaises(SystemExit) as raised:
                    backup.main()
            self.assertEqual(raised.exception.code, expected_code)
            lines = stdout.getvalue().splitlines()
            self.assertEqual(len(lines), 1)
            document = json.loads(lines[0])
            self.assertEqual(document["operation"], "validation-list")

    def test_unsafe_target_performs_no_remote_reads_or_state_writes(self):
        snapshot, _manifest, sidecar, _blobs, container, calls = self._fixture()
        with patch.object(backup, "DATA_DIR", "/data"), patch.object(
            backup, "_write_restore_state", side_effect=AssertionError("state write")
        ):
            with self.assertRaises(backup.ValidationFailure) as raised:
                backup.restore_filesystem_stateless(
                    snapshot,
                    data_dir="/data/restore-child",
                    expected_recovery_set_id=snapshot,
                    expected_manifest_sha256=hashlib.sha256(sidecar).hexdigest(),
                    container=container,
                )
        self.assertEqual(raised.exception.code, "TARGET_UNSAFE")
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
