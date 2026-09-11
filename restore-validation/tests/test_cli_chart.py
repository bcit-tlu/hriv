from __future__ import annotations

import hashlib
import inspect
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import yaml

from hriv_restore_validation.cli import main, parser
from hriv_restore_validation.models import Config, SourcePolicy, SourceProfile, Templates
from fixtures import profile

ROOT = Path(__file__).resolve().parents[2]
CHART = ROOT / "charts" / "restore-validation"


@unittest.skipUnless(shutil.which("helm"), "helm unavailable")
class ChartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rendered = subprocess.check_output(["helm", "template", "test", str(CHART)], text=True)
        cls.documents = list(yaml.safe_load_all(cls.rendered))

    def _config_map(self, name): return next(item for item in self.documents if item and item.get("kind") == "ConfigMap" and item["metadata"]["name"] == name)

    def test_default_chart_renders_disabled(self):
        self.assertNotIn("hriv-restore-validation-invoke", self.rendered)

    def test_chart_config_round_trip(self):
        raw = self._config_map("hriv-restore-validation-controller-v1")["data"]["config.json"]
        self.assertEqual("hriv-restore-validation", Config.parse(raw).namespace)

    def test_chart_profile_round_trip(self):
        raw = self._config_map("hriv-restore-validation-source-profile-v1")["data"]["profile.json"]
        self.assertEqual("pg-core-source", SourceProfile.parse(raw).external_cluster)

    def test_chart_policy_round_trip(self):
        raw = self._config_map("hriv-restore-validation-source-state-policy-v1")["data"]["policy.json"]
        self.assertEqual(1, SourcePolicy.parse(raw).policy_version)

    def test_chart_policy_digest_uses_python_canonical_bytes(self):
        state = {
            "missing_sources": [
                {
                    "row_id": "2",
                    "status": "failed<&é",
                    "stored_path": "data/source_images/a<&é.jpg",
                    "reason": "missing_source",
                }
            ],
            "orphan_sources": [],
        }
        digest = hashlib.sha256(
            json.dumps(state, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
        with tempfile.NamedTemporaryFile("w", suffix=".yaml") as values:
            yaml.safe_dump(
                {
                    "sourceStatePolicy": {
                        "version": 1,
                        "missingSources": state["missing_sources"],
                        "orphanSources": [],
                        "sha256": digest,
                    }
                },
                values,
            )
            values.flush()
            rendered = subprocess.check_output(
                ["helm", "template", "test", str(CHART), "-f", values.name], text=True
            )
        documents = list(yaml.safe_load_all(rendered))
        raw = next(
            item
            for item in documents
            if item and item.get("kind") == "ConfigMap"
            and item["metadata"]["name"] == "hriv-restore-validation-source-state-policy-v1"
        )["data"]["policy.json"]
        self.assertEqual(digest, SourcePolicy.parse(raw).sha256)

    def test_chart_templates_round_trip(self):
        profile_raw = self._config_map("hriv-restore-validation-source-profile-v1")["data"]["profile.json"]
        raw = self._config_map("hriv-restore-validation-child-templates-v1")["data"]["templates.yaml"]
        parsed_profile = SourceProfile.parse(profile_raw); parsed = Templates.parse(raw, parsed_profile)
        self.assertEqual("40Gi", parsed.source_pvc["spec"]["resources"]["requests"]["storage"])

    def test_no_secret_manifest(self):
        self.assertFalse(any(item and item.get("kind") == "Secret" for item in self.documents))

    def test_no_broad_egress(self):
        self.assertNotIn("0.0.0.0/0", self.rendered); self.assertNotIn("::/0", self.rendered)


class CliTests(unittest.TestCase):
    def test_run_command(self): self.assertEqual("run", parser().parse_args(["run"]).command)
    def test_database_command(self): self.assertEqual(7, parser().parse_args(["validate-database", "--host", "db", "--capture-started-at", "2026-01-15T09:00:00Z", "--wal-fence-committed-at", "2026-01-15T09:01:00Z", "--target-lsn", "A/1", "--target-tli", "7"]).target_tli)
    def test_consistency_command(self): self.assertEqual("/restore/data/source_images", parser().parse_args(["validate-consistency", "--host", "db", "--source", "/restore/data/source_images"]).source)
    def test_no_scheduler_commands(self):
        source = inspect.getsource(parser); self.assertNotIn("scheduler", source); self.assertNotIn("reaper", source); self.assertNotIn("exporter", source)

    def test_unexpected_child_exception_emits_one_bounded_type_only_failure(self):
        output = io.StringIO()
        with patch("hriv_restore_validation.cli._read", return_value=b"{}"), patch("hriv_restore_validation.cli.SourceProfile.parse", side_effect=RuntimeError("https://secret.invalid/?sig=secret")), self.assertLogs("hriv_restore_validation", level="ERROR") as logs, redirect_stdout(output):
            self.assertEqual(1, main(["validate-database", "--host", "db", "--capture-started-at", "2026-01-15T09:00:00Z", "--wal-fence-committed-at", "2026-01-15T09:01:00Z", "--target-lsn", "A/1", "--target-tli", "7"]))
        lines = output.getvalue().splitlines(); self.assertEqual(1, len(lines))
        self.assertEqual({"schema_version": 1, "operation": "validate-database", "success": False, "failure_code": "INTERNAL_FAILURE"}, json.loads(lines[0]))
        self.assertIn("RuntimeError", "\n".join(logs.output)); self.assertNotIn("secret.invalid", "\n".join(logs.output))


if __name__ == "__main__": unittest.main()
