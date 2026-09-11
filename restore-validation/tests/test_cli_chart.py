from __future__ import annotations

import inspect
import io
import json
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
        self.assertFalse(any(item and item.get("kind") == "PrometheusRule" for item in self.documents))

    def test_runtime_configmaps_are_atomic_v2_identities(self):
        names = {item["metadata"]["name"] for item in self.documents if item and item.get("kind") == "ConfigMap"}
        expected = {"hriv-restore-validation-controller-v2", "hriv-restore-validation-source-profile-v2", "hriv-restore-validation-source-state-policy-v2", "hriv-restore-validation-child-templates-v2"}
        self.assertLessEqual(expected, names)
        self.assertFalse(any(name.endswith("-v1") for name in names))
        self.assertIn("hriv-restore-validation-state", names)

    def test_chart_config_round_trip(self):
        raw = self._config_map("hriv-restore-validation-controller-v2")["data"]["config.json"]
        self.assertEqual("hriv-restore-validation", Config.parse(raw).namespace)

    def test_chart_profile_round_trip(self):
        raw = self._config_map("hriv-restore-validation-source-profile-v2")["data"]["profile.json"]
        self.assertEqual("pg-core-source", SourceProfile.parse(raw).external_cluster)

    def test_chart_policy_round_trip(self):
        raw = self._config_map("hriv-restore-validation-source-state-policy-v2")["data"]["policy.json"]
        self.assertEqual(1, SourcePolicy.parse(raw).policy_version)

    def test_chart_current_nonzero_digest_only_policy(self):
        digest = "958b1dc2dca298c56fd96dd80b6c694144905e22c00c4b3ca9d2c59c3b666083"
        with tempfile.NamedTemporaryFile("w", suffix=".yaml") as values:
            yaml.safe_dump({"sourceStatePolicy": {"missingCount": 39, "orphanCount": 3, "sha256": digest}}, values)
            values.flush()
            rendered = subprocess.check_output(["helm", "template", "test", str(CHART), "-f", values.name], text=True)
        documents = list(yaml.safe_load_all(rendered))
        raw = next(item for item in documents if item and item.get("kind") == "ConfigMap" and item["metadata"]["name"] == "hriv-restore-validation-source-state-policy-v2")["data"]["policy.json"]
        parsed = SourcePolicy.parse(raw)
        self.assertEqual((digest, 39, 3), (parsed.source_state_sha256, parsed.missing_count, parsed.orphan_count))
        self.assertNotIn("source_state", json.loads(raw))

    def test_chart_templates_round_trip(self):
        profile_raw = self._config_map("hriv-restore-validation-source-profile-v2")["data"]["profile.json"]
        raw = self._config_map("hriv-restore-validation-child-templates-v2")["data"]["templates.yaml"]
        parsed_profile = SourceProfile.parse(profile_raw); parsed = Templates.parse(raw, parsed_profile)
        self.assertEqual("40Gi", parsed.source_pvc["spec"]["resources"]["requests"]["storage"])

    def test_operational_cronjobs_proxy_and_fixed_policy(self):
        digest = "1" * 64
        values = {
            "images": {"orchestrator": f"registry.example/controller@sha256:{digest}", "backupChild": f"registry.example/backup@sha256:{digest}", "postgresql": f"registry.example/postgres@sha256:{digest}"},
            "objectStore": {"enabled": True, "destinationPath": "https://storage.blob.core.windows.net/barman"},
            "operational": {"enabled": True, "schedule": "0 11 * * 0", "egressProxy": {"image": "envoyproxy/envoy:v1.39.1@sha256:57e14a549d7bd43c8d3f6d03e8cfa653e037d4b38e133acd9b54f38c524401b4", "allowedConnectHosts": ["storageacct.blob.core.windows.net:443"]}},
        }
        with tempfile.NamedTemporaryFile("w", suffix=".yaml") as source:
            yaml.safe_dump(values, source); source.flush()
            rendered = subprocess.check_output(["helm", "template", "test", str(CHART), "--namespace", "hriv-restore-validation", "-f", source.name], text=True)
        docs = [item for item in yaml.safe_load_all(rendered) if item]
        cronjobs = {item["metadata"]["name"]: item for item in docs if item.get("kind") == "CronJob"}
        self.assertEqual({"hriv-restore-validation-weekly", "hriv-restore-validation-on-demand", "hriv-restore-validation-cleanup"}, set(cronjobs))
        weekly = cronjobs["hriv-restore-validation-weekly"]
        on_demand = cronjobs["hriv-restore-validation-on-demand"]
        self.assertEqual(("0 11 * * 0", "Forbid", 3600, 2, 1), (weekly["spec"]["schedule"], weekly["spec"]["concurrencyPolicy"], weekly["spec"]["startingDeadlineSeconds"], weekly["spec"]["successfulJobsHistoryLimit"], weekly["spec"]["failedJobsHistoryLimit"]))
        self.assertTrue(weekly["spec"]["suspend"])
        weekly_template = weekly["spec"]["jobTemplate"]
        demand_template = on_demand["spec"]["jobTemplate"]
        self.assertEqual((0, 21600, "Never"), (weekly_template["spec"]["backoffLimit"], weekly_template["spec"]["activeDeadlineSeconds"], weekly_template["spec"]["template"]["spec"]["restartPolicy"]))
        self.assertNotIn("ttlSecondsAfterFinished", weekly_template["spec"])
        self.assertEqual(604800, demand_template["spec"]["ttlSecondsAfterFinished"])
        self.assertTrue(on_demand["spec"]["suspend"])
        cleanup_template = cronjobs["hriv-restore-validation-cleanup"]["spec"]["jobTemplate"]
        self.assertEqual(604800, cleanup_template["spec"]["ttlSecondsAfterFinished"])
        cleanup_args = cleanup_template["spec"]["template"]["spec"]["containers"][0]["args"]
        self.assertEqual(["cleanup-retained"], cleanup_args)
        rules = [item for item in docs if item.get("kind") == "PrometheusRule"]
        self.assertEqual(1, len(rules))
        alert_rules = rules[0]["spec"]["groups"][0]["rules"]
        self.assertEqual(["HRIVCoreRestoreValidationUnhealthy"], [item["alert"] for item in alert_rules])
        self.assertEqual("15m", alert_rules[0]["for"])
        expression = alert_rules[0]["expr"]
        for metric in ("kube_job_status_failed", "kube_cronjob_status_last_successful_time", "kube_cronjob_created"):
            self.assertIn(metric, expression)
        self.assertNotIn("run_id", json.dumps(rules))
        self.assertIn("connect_matcher", rendered); self.assertNotIn("domains:\n                            - '*'", rendered)
        self.assertIn("0.0.0.0/0", rendered)
        self.assertIn("10.43.0.1/32", rendered)
        self.assertIn("HTTPS_PROXY", rendered); self.assertIn("NO_PROXY", rendered)
        self.assertNotIn("name: HTTP_PROXY", rendered)
        proxy = next(item for item in docs if item.get("kind") == "Deployment" and item["metadata"]["name"] == "hriv-restore-validation-egress-proxy")
        proxy_pod = proxy["spec"]["template"]["spec"]
        self.assertFalse(proxy_pod["automountServiceAccountToken"])
        self.assertTrue(proxy_pod["securityContext"]["runAsNonRoot"])
        self.assertTrue(proxy_pod["containers"][0]["securityContext"]["readOnlyRootFilesystem"])
        child_config = next(item for item in docs if item.get("kind") == "ConfigMap" and item["metadata"]["name"] == "hriv-restore-validation-child-templates-v2")
        children = yaml.safe_load(child_config["data"]["templates.yaml"])
        for job_name in ("selection_job", "source_restore_job"):
            names = {item["name"] for item in children[job_name]["spec"]["template"]["spec"]["containers"][0]["env"]}
            self.assertIn("HTTPS_PROXY", names); self.assertNotIn("HTTP_PROXY", names)
        self.assertEqual({"HTTPS_PROXY", "NO_PROXY"}, {item["name"] for item in children["cnpg_cluster"]["spec"]["env"]})
        for job_name in ("db_validation_job", "consistency_job"):
            self.assertNotIn("env", children[job_name]["spec"]["template"]["spec"]["containers"][0])
        policies = {item["metadata"]["name"]: item["spec"] for item in docs if item.get("kind") == "NetworkPolicy"}
        selector_values = lambda name: set(policies[name]["podSelector"]["matchExpressions"][0]["values"])
        self.assertEqual({"db-validation", "consistency"}, selector_values("hriv-restore-validation-database-clients"))
        self.assertEqual({"selection", "source-restore", "cnpg"}, selector_values("hriv-restore-validation-azure-readers"))
        self.assertEqual({"orchestrator", "cleanup"}, selector_values("hriv-restore-validation-api"))
        broad = [name for name, spec in policies.items() if any(peer.get("ipBlock", {}).get("cidr") == "0.0.0.0/0" for rule in spec.get("egress", []) for peer in rule.get("to", []))]
        self.assertEqual(["hriv-restore-validation-proxy-egress"], broad)

    def test_no_secret_manifest(self):
        self.assertFalse(any(item and item.get("kind") == "Secret" for item in self.documents))

    def test_no_broad_egress(self):
        self.assertNotIn("0.0.0.0/0", self.rendered); self.assertNotIn("::/0", self.rendered)


class ReleaseConfigTests(unittest.TestCase):
    def test_initial_feat_release_is_minor(self):
        config = json.loads((ROOT / "release-please-config.json").read_text())
        manifest = json.loads((ROOT / ".release-please-manifest.json").read_text())
        self.assertEqual("0.0.0", manifest["restore-validation"])
        self.assertTrue(config["bump-minor-pre-major"])
        self.assertEqual("python", config["packages"]["restore-validation"]["release-type"])
        # Release Please's conventional-commit rule maps feat to minor; from 0.0.0 this is 0.1.0.
        current = tuple(map(int, manifest["restore-validation"].split(".")))
        self.assertEqual((0, 1, 0), (current[0], current[1] + 1, 0))


class CliTests(unittest.TestCase):
    def test_run_command(self): self.assertEqual("run", parser().parse_args(["run"]).command)
    def test_database_command(self): self.assertEqual(7, parser().parse_args(["validate-database", "--host", "db", "--capture-started-at", "2026-01-15T09:00:00Z", "--wal-fence-committed-at", "2026-01-15T09:01:00Z", "--target-lsn", "A/1", "--target-tli", "7", "--expected-source-image-count", "2"]).target_tli)
    def test_consistency_command(self): self.assertEqual("/restore/data/source_images", parser().parse_args(["validate-consistency", "--host", "db", "--source", "/restore/data/source_images", "--selected-source-state", '{"missing_sources":[],"orphan_sources":[]}']).source)
    def test_no_scheduler_commands(self):
        source = inspect.getsource(parser); self.assertNotIn("scheduler", source); self.assertNotIn("reaper", source); self.assertNotIn("exporter", source)

    def test_unexpected_child_exception_emits_one_bounded_type_only_failure(self):
        output = io.StringIO()
        with patch("hriv_restore_validation.cli._read", return_value=b"{}"), patch("hriv_restore_validation.cli.SourceProfile.parse", side_effect=RuntimeError("https://secret.invalid/?sig=secret")), self.assertLogs("hriv_restore_validation", level="ERROR") as logs, redirect_stdout(output):
            self.assertEqual(1, main(["validate-database", "--host", "db", "--capture-started-at", "2026-01-15T09:00:00Z", "--wal-fence-committed-at", "2026-01-15T09:01:00Z", "--target-lsn", "A/1", "--target-tli", "7", "--expected-source-image-count", "2"]))
        lines = output.getvalue().splitlines(); self.assertEqual(1, len(lines))
        self.assertEqual({"schema_version": 1, "operation": "validate-database", "success": False, "failure_code": "INTERNAL_FAILURE"}, json.loads(lines[0]))
        self.assertIn("RuntimeError", "\n".join(logs.output)); self.assertNotIn("secret.invalid", "\n".join(logs.output))


if __name__ == "__main__": unittest.main()
