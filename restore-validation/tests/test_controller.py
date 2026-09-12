from __future__ import annotations

import copy
import json
import unittest
from datetime import datetime, timedelta, timezone

from hriv_restore_validation.controller import Controller, child_name, holder_identity, make_run_id, normalize_lease_time
from hriv_restore_validation.gateway import Lease, Observation
from hriv_restore_validation.state import parse_state
from hriv_restore_validation.strict import ValidationError
from fixtures import NOW, RUN, TRIGGER, config, consistency_result, controller, database_result, drive, gateway as fixture_gateway, policy, profile, restore_result as fixture_restore_result, selection_document as fixture_selection_document, template_document, templates


def selection_document(**changes: object) -> dict[str, object]:
    value = fixture_selection_document()
    value["recovery_set_id"] = value["snapshot_name"]
    value["archive_blob"] = f"hriv-backups/{value['snapshot_name']}.tar.gz"
    value.update(changes)
    return value


def restore_result(**changes: object) -> dict[str, object]:
    value = fixture_restore_result()
    value["recovery_set_id"] = value["snapshot_name"]
    value.update(changes)
    return value


def gateway():
    fake = fixture_gateway()
    fake.results["selection"] = json.dumps(selection_document())
    fake.results["source-restore"] = json.dumps(restore_result())
    return fake


class ControllerTests(unittest.TestCase):
    def test_core_success_boundary(self) -> None:
        fake = gateway()
        self.assertEqual("succeeded", drive(controller(fake)))
        state = parse_state(fake.state_raw, NOW)
        self.assertEqual("SUCCEEDED", state["latest_run"]["state"])
        self.assertEqual({"stage": "core_succeeded", "completed_at": "2026-01-15T10:00:00Z", "contract_boundary": "simplified1253"}, state["latest_run"]["core_succeeded"])
        self.assertEqual({"run_id": RUN, "completed_at": "2026-01-15T10:00:00Z", "recovery_set_id": selection_document()["recovery_set_id"], "source_files_sha256": "e" * 64, "cleanup": {"outcome": "succeeded", "completed_at": "2026-01-15T10:00:00Z", "remaining_resource_count": 0}}, state["last_complete_success"])

    def test_legacy_1251_success_allows_next_run_without_promotion(self) -> None:
        fake = gateway(); self.assertEqual("succeeded", drive(controller(fake)))
        state = json.loads(fake.state_raw)
        state["latest_run"]["core_succeeded"]["contract_boundary"] = "1251"
        state["last_complete_success"] = None
        for resource in state["latest_run"]["child_resources"]:
            resource.pop("template_sha256", None)
        fake.state_raw = json.dumps(state)
        parsed = parse_state(fake.state_raw, NOW)
        self.assertEqual("1251", parsed["latest_run"]["core_succeeded"]["contract_boundary"])
        self.assertIsNone(parsed["last_complete_success"])
        new_run = "rv-20260115t110000z-deadbeef"
        trigger = type(TRIGGER)("on_demand", "next-orchestrator", "next-job-uid", "next-pod-uid")
        self.assertEqual("running", Controller(fake, config(), profile(), policy(), templates(), clock=lambda: NOW).run(trigger, new_run))
        upgraded = parse_state(fake.state_raw, NOW)
        self.assertEqual(new_run, upgraded["latest_run"]["run_id"])
        self.assertIsNone(upgraded["last_complete_success"])

    def test_legacy_1251_success_cannot_claim_complete_success(self) -> None:
        fake = gateway(); self.assertEqual("succeeded", drive(controller(fake)))
        state = json.loads(fake.state_raw)
        state["latest_run"]["core_succeeded"]["contract_boundary"] = "1251"
        with self.assertRaises(ValidationError):
            parse_state(json.dumps(state), NOW)
        state["last_complete_success"] = None
        state["latest_run"]["core_succeeded"]["contract_boundary"] = "unsupported"
        with self.assertRaises(ValidationError):
            parse_state(json.dumps(state), NOW)

    def test_failure_never_advances_last_complete_success(self) -> None:
        fake = gateway(); self.assertEqual("succeeded", drive(controller(fake)))
        before = copy.deepcopy(parse_state(fake.state_raw, NOW)["last_complete_success"])
        failed_run = "rv-20260115t110000z-deadbeef"
        failed_trigger = type(TRIGGER)("scheduled", "weekly", "failed-job-uid")
        fake.results["selection"] = json.dumps({"schema_version": 1, "operation": "validation-select", "success": False, "failure_code": "STATE_MISSING", "failure_stage": "selection"})
        fake.phases["selection"] = "Failed"
        self.assertEqual("retained", Controller(fake, config(), profile(), policy(), templates(), clock=lambda: NOW).run(failed_trigger, failed_run))
        self.assertEqual(before, parse_state(fake.state_raw, NOW)["last_complete_success"])

    def test_complete_success_schema_rejects_extra_or_failed_cleanup(self) -> None:
        fake = gateway(); drive(controller(fake)); state = json.loads(fake.state_raw)
        for mutate in (
            lambda evidence: evidence.__setitem__("extra", True),
            lambda evidence: evidence["cleanup"].__setitem__("outcome", "failed"),
            lambda evidence: evidence.__setitem__("source_files_sha256", "bad"),
        ):
            altered = copy.deepcopy(state); mutate(altered["last_complete_success"])
            with self.assertRaises(ValidationError):
                parse_state(json.dumps(altered), NOW)

    def test_cnpg_uses_target_tli(self) -> None:
        fake = gateway(); drive(controller(fake))
        cluster = next(item for item in fake.created if item["kind"] == "Cluster")
        target = cluster["spec"]["bootstrap"]["recovery"]["recoveryTarget"]
        self.assertEqual({"targetLSN": "A/1234", "targetTLI": "7"}, target)
        self.assertEqual(cluster["metadata"]["labels"], cluster["spec"]["inheritedMetadata"]["labels"])
        self.assertNotIn("targetTimeline", json.dumps(cluster))

    def test_cnpg_rejects_missing_target(self) -> None:
        with self.assertRaises(ValidationError): Controller._validate_cluster_target({"spec": {}})

    def test_cnpg_rejects_latest_target(self) -> None:
        with self.assertRaises(ValidationError): Controller._validate_cluster_target({"spec": {"bootstrap": {"recovery": {"recoveryTarget": {"targetLSN": "latest", "targetTLI": "7"}}}}})

    def test_selection_rejects_lowercase_wal_fence(self) -> None:
        fake = gateway(); fake.results["selection"] = json.dumps(selection_document(wal_fence_file="0000000a0000000000000001", target_timeline=10))
        self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))

    def test_selection_rejects_fence_timeline_mismatch(self) -> None:
        fake = gateway(); fake.results["selection"] = json.dumps(selection_document(target_timeline=8))
        self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))

    def test_selection_rejects_fence_segment_mismatch(self) -> None:
        fake = gateway(); fake.results["selection"] = json.dumps(selection_document(wal_fence_file="000000070000000A00000001"))
        self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))
        self.assertEqual("IMMUTABLE_BINDING_INVALID", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_cnpg_fixed_external_source(self) -> None:
        fake = gateway(); drive(controller(fake))
        cluster = next(item for item in fake.created if item["kind"] == "Cluster")
        self.assertEqual("pg-core-source", cluster["spec"]["bootstrap"]["recovery"]["source"])
        self.assertEqual({"barmanObjectName": "hriv-restore-validation-pg-core", "serverName": "pg-core"}, cluster["spec"]["externalClusters"][0]["plugin"]["parameters"])

    def test_ready_only_cnpg_does_not_advance(self) -> None:
        fake = gateway(); instance = controller(fake)
        for _ in range(3): instance.run(TRIGGER, RUN)
        key = next(key for key in fake.children if key[1] == "Cluster")
        ref, manifest, _ = fake.children[key]; fake.children[key] = (ref, manifest, Observation("Running"))
        self.assertEqual("running", instance.run(TRIGGER, RUN))
        self.assertEqual("WAIT_CNPG", parse_state(fake.state_raw, NOW)["latest_run"]["state"])

    def test_cnpg_fresh_superuser(self) -> None:
        fake = gateway(); drive(controller(fake))
        cluster = next(item for item in fake.created if item["kind"] == "Cluster")
        self.assertTrue(cluster["spec"]["enableSuperuserAccess"])
        job = next(item for item in fake.created if item["metadata"]["labels"].get("hriv.bcit.ca/restore-validation-role") == "db-validation")
        self.assertIn("rv-a1b2c3d4-pg-superuser", json.dumps(job))

    def test_selection_profile_cluster_env(self) -> None:
        fake = gateway(); controller(fake).run(TRIGGER, RUN)
        selection = fake.created[0]
        self.assertIn({"name": "CNPG_CLUSTER_NAME", "value": "pg-core"}, selection["spec"]["template"]["spec"]["containers"][0]["env"])

    def test_database_receives_bound_fence_window(self) -> None:
        fake = gateway(); drive(controller(fake))
        job = next(item for item in fake.created if item["metadata"]["labels"].get("hriv.bcit.ca/restore-validation-role") == "db-validation")
        args = job["spec"]["template"]["spec"]["containers"][0]["args"]
        self.assertEqual("2026-01-15T09:00:00Z", args[args.index("--capture-started-at") + 1])
        self.assertEqual("2026-01-15T09:01:00Z", args[args.index("--wal-fence-committed-at") + 1])
        self.assertEqual("A/1234", args[args.index("--target-lsn") + 1])
        self.assertEqual("7", args[args.index("--target-tli") + 1])

    def test_database_result_whole_second_bound_accepts_original_fractional_fence(self) -> None:
        fake = gateway(); fake.results["db-validation"] = json.dumps(database_result(fence_fenced_at="2026-01-15T09:01:00.900000Z"))
        self.assertEqual("succeeded", drive(controller(fake)))

    def test_database_result_fractional_bound_rejects_later_fraction(self) -> None:
        fake = gateway()
        fake.results["selection"] = json.dumps(selection_document(wal_fence_committed_at="2026-01-15T09:01:00.100000Z"))
        fake.results["db-validation"] = json.dumps(database_result(fence_fenced_at="2026-01-15T09:01:00.900000Z"))
        self.assertEqual("retained", drive(controller(fake)))
        self.assertEqual("DB_VALIDATION_INVALID", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_database_result_requires_promoted_target_timeline(self) -> None:
        for result in (
            database_result(timeline=7),
            database_result(target_tli=8),
            database_result(timeline=8, target_tli=8),
        ):
            with self.subTest(result=result):
                fake = gateway(); fake.results["db-validation"] = json.dumps(result)
                self.assertEqual("retained", drive(controller(fake)))
                self.assertEqual("DB_VALIDATION_INVALID", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_restore_exact_args_and_parent_mount(self) -> None:
        fake = gateway(); drive(controller(fake))
        job = next(item for item in fake.created if item["metadata"]["labels"].get("hriv.bcit.ca/restore-validation-role") == "source-restore")
        args = job["spec"]["template"]["spec"]["containers"][0]["args"]
        self.assertEqual("/restore/data", args[3])
        self.assertIn("--expected-recovery-set-id", args)
        self.assertIn("--expected-manifest-sha256", args)
        self.assertNotIn("db.sql", json.dumps(job))

    def test_overlap_is_trigger_only(self) -> None:
        fake = gateway(); instance = controller(fake); instance.run(TRIGGER, RUN)
        before = parse_state(fake.state_raw, NOW)
        other = type(TRIGGER)("scheduled", "other", "other-uid")
        self.assertEqual("rejected", instance.run(other, "rv-20260115t100001z-11111111"))
        after = parse_state(fake.state_raw, NOW)
        for field in ("active_run", "latest_run", "retained_runs", "last_complete_success"):
            self.assertEqual(before[field], after[field])

    def test_interruption_does_not_reselect(self) -> None:
        fake = gateway(); first = controller(fake); first.run(TRIGGER, RUN)
        binding = copy.deepcopy(parse_state(fake.state_raw, NOW)["latest_run"]["selected_source"])
        Controller(fake, config(), profile(), policy(), templates(), clock=lambda: NOW).run(TRIGGER, RUN)
        self.assertEqual(binding, parse_state(fake.state_raw, NOW)["latest_run"]["selected_source"])
        self.assertEqual(1, sum(item["metadata"]["labels"].get("hriv.bcit.ca/restore-validation-role") == "selection" for item in fake.created))

    def test_persisted_selection_binding_corruption_is_retained_before_side_effects(self) -> None:
        mutations = {
            "schema version": ("selection_schema_version", 2, "IMMUTABLE_BINDING_INVALID"),
            "operation": ("selection_operation", "restore-filesystem-stateless", "IMMUTABLE_BINDING_INVALID"),
            "backup run": ("backup_run_id", "bad run", "IMMUTABLE_BINDING_INVALID"),
            "snapshot": ("snapshot_name", "hriv-backup-20260115-090001-deadbeef", "IMMUTABLE_BINDING_INVALID"),
            "recovery set": ("recovery_set_id", "hriv-backup-20260115-090001-deadbeef", "IMMUTABLE_BINDING_INVALID"),
            "manifest hash": ("manifest_sha256", "D" * 64, "IMMUTABLE_BINDING_INVALID"),
            "archive blob": ("archive_blob", "../archive.tar.gz", "IMMUTABLE_BINDING_INVALID"),
            "archive size": ("archive_size", 0, "IMMUTABLE_BINDING_INVALID"),
            "archive etag": ("archive_etag", "etag", "IMMUTABLE_BINDING_INVALID"),
            "capture timestamp": ("capture_started_at", "2026-01-15T09:00:00+00:00", "IMMUTABLE_BINDING_INVALID"),
            "fence file": ("wal_fence_file", "00000007000000000000000a", "IMMUTABLE_BINDING_INVALID"),
            "fence committed": ("wal_fence_committed_at", "2026-01-15T08:59:00Z", "IMMUTABLE_BINDING_INVALID"),
            "fence archived": ("wal_fence_archived_at", "2026-01-15T09:00:30Z", "IMMUTABLE_BINDING_INVALID"),
            "completed": ("completed_at", "2026-01-15T09:01:30Z", "IMMUTABLE_BINDING_INVALID"),
            "target lsn": ("target_lsn", "latest", "IMMUTABLE_BINDING_INVALID"),
            "target timeline": ("target_timeline", 8, "IMMUTABLE_BINDING_INVALID"),
            "file count": ("source_file_count", 1, "IMMUTABLE_BINDING_INVALID"),
            "source bytes": ("source_total_bytes", -1, "IMMUTABLE_BINDING_INVALID"),
            "source files hash": ("source_files_sha256", "E" * 64, "IMMUTABLE_BINDING_INVALID"),
            "database rows": ("database_row_count", 3, "IMMUTABLE_BINDING_INVALID"),
            "missing count": ("missing_count", 1, "IMMUTABLE_BINDING_INVALID"),
            "orphan count": ("orphan_count", 1, "SOURCE_POLICY_MISMATCH"),
            "exclusion count": ("exclusion_count", 1, "IMMUTABLE_BINDING_INVALID"),
            "source state": ("source_state", {"missing_sources": [], "orphan_sources": [{"path": "x"}]}, "SOURCE_POLICY_MISMATCH"),
            "source state hash": ("source_state_sha256", "b" * 64, "SOURCE_POLICY_MISMATCH"),
            "excluded artifact": ("excluded_artifacts", [{"path": "data/source_images/x", "reason": "unapproved"}], "IMMUTABLE_BINDING_INVALID"),
            "policy version": ("source_state_policy_version", 2, "SOURCE_POLICY_MISMATCH"),
            "policy hash": ("source_state_policy_sha256", "b" * 64, "SOURCE_POLICY_MISMATCH"),
            "profile id": ("source_profile_id", "other", "IMMUTABLE_BINDING_INVALID"),
            "profile version": ("source_profile_version", 2, "IMMUTABLE_BINDING_INVALID"),
            "profile hash": ("source_profile_sha256", "b" * 64, "IMMUTABLE_BINDING_INVALID"),
            "database": ("database", "other", "IMMUTABLE_BINDING_INVALID"),
            "owner": ("owner", "other", "IMMUTABLE_BINDING_INVALID"),
            "system identifier": ("expected_system_identifier", "888888", "IMMUTABLE_BINDING_INVALID"),
            "server": ("server_name", "other", "IMMUTABLE_BINDING_INVALID"),
            "external cluster": ("external_cluster", "other", "IMMUTABLE_BINDING_INVALID"),
            "object store": ("object_store", "other", "IMMUTABLE_BINDING_INVALID"),
        }
        for name, (field, replacement, expected_code) in mutations.items():
            with self.subTest(name=name):
                fake = gateway(); controller(fake).run(TRIGGER, RUN)
                state = parse_state(fake.state_raw, NOW)
                state["latest_run"]["selected_source"][field] = replacement
                fake.state_raw = json.dumps(state)
                created = len(fake.created)
                fresh = Controller(fake, config(), profile(), policy(), templates(), clock=lambda: NOW)
                self.assertEqual("retained", fresh.run(TRIGGER, RUN))
                retained = parse_state(fake.state_raw, NOW)["latest_run"]
                self.assertEqual(expected_code, retained["failure_code"])
                self.assertEqual(created, len(fake.created))

        for name, mutate in (
            ("unknown key", lambda binding: binding.__setitem__("unknown", True)),
            ("missing key", lambda binding: binding.pop("archive_size")),
        ):
            with self.subTest(name=name):
                fake = gateway(); controller(fake).run(TRIGGER, RUN)
                state = parse_state(fake.state_raw, NOW); mutate(state["latest_run"]["selected_source"])
                fake.state_raw = json.dumps(state); created = len(fake.created)
                fresh = Controller(fake, config(), profile(), policy(), templates(), clock=lambda: NOW)
                self.assertEqual("retained", fresh.run(TRIGGER, RUN))
                self.assertEqual("IMMUTABLE_BINDING_INVALID", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])
                self.assertEqual(created, len(fake.created))

    def test_extra_cnpg_label_is_allowed(self) -> None:
        fake = gateway(); instance = controller(fake)
        for _ in range(3): instance.run(TRIGGER, RUN)
        key = next(key for key in fake.children if key[1] == "Cluster")
        ref, manifest, obs = fake.children[key]; manifest["metadata"]["labels"]["cnpg.io/cluster"] = "added"; fake.children[key] = (ref, manifest, obs)
        self.assertEqual("running", instance.run(TRIGGER, RUN))

    def test_failed_job_emitted_code_is_retained(self) -> None:
        for code in ("MARKER_MISSING", "AZURE_READ_FAILED", "STATE_TOO_LARGE"):
            fake = gateway()
            fake.phases["selection"] = "Failed"
            fake.results["selection"] = json.dumps(
                {"schema_version": 1, "operation": "validation-select", "success": False, "failure_code": code, "failure_stage": "selection"}
            )
            with self.subTest(code=code):
                self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))
                self.assertEqual(code, parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_failed_job_unallowlisted_code_maps_generic(self) -> None:
        fake = gateway(); fake.phases["selection"] = "Failed"; fake.results["selection"] = json.dumps({"schema_version": 1, "operation": "validation-select", "success": False, "failure_code": "ATTACKER_CHOSEN"})
        self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))
        self.assertEqual("SELECTION_FAILED", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_failed_job_malformed_code_maps_generic(self) -> None:
        fake = gateway(); fake.phases["selection"] = "Failed"; fake.results["selection"] = "{}"
        self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))
        self.assertEqual("SELECTION_FAILED", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_wrong_managed_or_run_label_is_retained(self) -> None:
        for label, wrong in (("app.kubernetes.io/managed-by", "other"), ("hriv.bcit.ca/restore-validation-run-id", "wrong")):
            with self.subTest(label=label):
                fake = gateway(); instance = controller(fake)
                for _ in range(3): instance.run(TRIGGER, RUN)
                key = next(key for key in fake.children if key[1] == "Cluster")
                ref, manifest, obs = fake.children[key]; manifest["metadata"]["labels"][label] = wrong; fake.children[key] = (ref, manifest, obs)
                self.assertEqual("retained", instance.run(TRIGGER, RUN))

    def test_wrong_role_is_retained(self) -> None:
        fake = gateway(); instance = controller(fake)
        for _ in range(3): instance.run(TRIGGER, RUN)
        key = next(key for key in fake.children if key[1] == "Cluster")
        ref, manifest, obs = fake.children[key]; manifest["metadata"]["labels"]["hriv.bcit.ca/restore-validation-role"] = "wrong"; fake.children[key] = (ref, manifest, obs)
        self.assertEqual("retained", instance.run(TRIGGER, RUN))

    def test_stage_timeout(self) -> None:
        fake = gateway(); current = [NOW]
        instance = Controller(fake, config(stage_timeout_seconds=30), profile(), policy(), templates(), clock=lambda: current[0]); instance.run(TRIGGER, RUN); current[0] += timedelta(seconds=31)
        self.assertEqual("retained", instance.run(TRIGGER, RUN))

    def test_preflight_reserves_full_ten_child_bound(self) -> None:
        fake = gateway(); instance = controller(fake, max_child_resources=9)
        instance.run(TRIGGER, RUN)
        self.assertEqual("retained", instance.run(TRIGGER, RUN))
        self.assertEqual("CAPACITY_INSUFFICIENT", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_preflight_accepts_exact_ten_child_bound(self) -> None:
        fake = gateway(); instance = controller(fake, max_child_resources=10)
        instance.run(TRIGGER, RUN); self.assertEqual("running", instance.run(TRIGGER, RUN))
        self.assertEqual("PROVISION", parse_state(fake.state_raw, NOW)["latest_run"]["state"])

    def test_preflight_job_quota(self) -> None:
        fake = gateway(); fake.create_child({"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": "unrelated", "labels": {}}})
        instance = controller(fake, max_jobs=4); instance.run(TRIGGER, RUN)
        self.assertEqual("retained", instance.run(TRIGGER, RUN))
        self.assertEqual("CAPACITY_INSUFFICIENT", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_preflight_reserves_source_and_cnpg_pvcs(self) -> None:
        fake = gateway()
        for index in range(7):
            fake.create_child(
                {
                    "apiVersion": "v1",
                    "kind": "PersistentVolumeClaim",
                    "metadata": {"name": f"unrelated-{index}", "labels": {}},
                }
            )
        instance = controller(fake, max_pvcs=8)
        instance.run(TRIGGER, RUN)
        self.assertEqual("retained", instance.run(TRIGGER, RUN))
        self.assertEqual("CAPACITY_INSUFFICIENT", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_source_capacity(self) -> None:
        fake = gateway(); fake.results["selection"] = json.dumps(selection_document(source_total_bytes=50 * 1024**3))
        self.assertEqual("retained", drive(controller(fake)))
        self.assertEqual("CAPACITY_INSUFFICIENT", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_stable_160gi_source_capacity_covers_corrected_source_with_margin(self) -> None:
        import yaml
        from hriv_restore_validation.models import Templates

        raw_templates = template_document()
        raw_templates["source_pvc"]["spec"]["resources"]["requests"]["storage"] = "160Gi"
        configured = Templates.parse(yaml.safe_dump(raw_templates), profile())
        fake = gateway()
        fake.results["selection"] = json.dumps(selection_document(source_total_bytes=128_986_771_498))
        fake.results["source-restore"] = json.dumps(restore_result(source_total_bytes=128_986_771_498, restored_total_bytes=128_986_771_498))
        fake.results["consistency"] = json.dumps(consistency_result(restored_total_bytes=128_986_771_498))
        instance = Controller(fake, config(), profile(), policy(), configured, clock=lambda: NOW)
        self.assertEqual("succeeded", drive(instance))

    def test_restore_count_mismatch(self) -> None:
        fake = gateway(); fake.results["source-restore"] = json.dumps(restore_result(restored_file_count=1))
        self.assertEqual("retained", drive(controller(fake)))

    def test_consistency_policy_mismatch(self) -> None:
        fake = gateway(); fake.results["consistency"] = json.dumps(consistency_result(unexpected_orphan_count=1))
        self.assertEqual("retained", drive(controller(fake)))

    def test_consistency_same_size_digest_mismatch_is_retained(self) -> None:
        fake = gateway(); fake.results["consistency"] = json.dumps(consistency_result(source_files_sha256="f" * 64))
        self.assertEqual("retained", drive(controller(fake)))
        self.assertEqual("CONSISTENCY_RESULT_INVALID", parse_state(fake.state_raw, NOW)["latest_run"]["failure_code"])

    def test_selection_binding_preserves_machine_evidence_and_local_digests(self) -> None:
        fake = gateway(); fake.results["selection"] = json.dumps(selection_document(exclusion_count=1, excluded_artifacts=[{"path": "data/admin", "reason": "non_authoritative_production_data"}]))
        controller(fake).run(TRIGGER, RUN)
        selected = parse_state(fake.state_raw, NOW)["latest_run"]["selected_source"]
        for field in ("backup_run_id", "manifest_sha256", "archive_blob", "archive_size", "archive_etag", "completed_at", "target_lsn", "target_timeline", "source_file_count", "source_total_bytes", "source_files_sha256", "database_row_count", "missing_count", "orphan_count", "exclusion_count", "source_state", "source_state_sha256", "excluded_artifacts", "source_profile_id", "source_profile_sha256", "source_state_policy_version", "source_state_policy_sha256"):
            self.assertIn(field, selected)
        self.assertEqual([{"path": "data/admin", "reason": "non_authoritative_production_data"}], selected["excluded_artifacts"])

    def test_selection_rejects_exclusion_count_mismatch(self) -> None:
        fake = gateway(); fake.results["selection"] = json.dumps(selection_document(exclusion_count=1))
        self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))

    def test_database_result_extra_field(self) -> None:
        fake = gateway(); fake.results["db-validation"] = json.dumps(database_result(extra=True))
        self.assertEqual("retained", drive(controller(fake)))

    def test_async_cleanup_waits(self) -> None:
        fake = gateway(); fake.async_deletes = True; instance = controller(fake)
        for _ in range(20):
            instance.run(TRIGGER, RUN)
            if parse_state(fake.state_raw, NOW)["latest_run"]["state"] == "CLEANUP": break
        self.assertEqual("running", instance.run(TRIGGER, RUN))
        deleted = len(fake.deleted); self.assertGreater(deleted, 0)
        self.assertEqual("running", instance.run(TRIGGER, RUN)); self.assertEqual(deleted, len(fake.deleted))
        fake.finish_deletes(); self.assertEqual("succeeded", instance.run(TRIGGER, RUN))

    def test_create_conflict_is_retained(self) -> None:
        fake = gateway()
        fake.create_child({"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": child_name(RUN, "selection"), "labels": {}}})
        self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))

    def test_crash_after_create_recovers_every_child_role_without_leaks(self) -> None:
        class SimulatedCrash(BaseException):
            pass

        for target_role in ("selection", "source-pvc", "cnpg", "db-validation", "source-restore", "consistency"):
            with self.subTest(role=target_role):
                fake = gateway()
                original_create = fake.create_child
                original_replace = fake.replace_state
                crash_pending = [False]

                def create(manifest):
                    ref = original_create(manifest)
                    if manifest["metadata"]["labels"].get("hriv.bcit.ca/restore-validation-role") == target_role:
                        crash_pending[0] = True
                    return ref

                def replace(name, raw, version):
                    if crash_pending[0]:
                        crash_pending[0] = False
                        raise SimulatedCrash()
                    return original_replace(name, raw, version)

                fake.create_child = create
                fake.replace_state = replace
                first = controller(fake)
                for _ in range(30):
                    try:
                        first.run(TRIGGER, RUN)
                    except SimulatedCrash:
                        break
                else:
                    self.fail(f"did not inject crash for {target_role}")
                fake.create_child = original_create
                fake.replace_state = original_replace
                created_ref = next(ref for ref, manifest, _ in fake.children.values() if manifest["metadata"]["labels"].get("hriv.bcit.ca/restore-validation-role") == target_role)
                state = parse_state(fake.state_raw, NOW)["latest_run"]
                self.assertFalse(any(item["uid"] == created_ref.uid for item in state["child_resources"]))
                fresh = Controller(fake, config(), profile(), policy(), templates(), clock=lambda: NOW)
                fresh.run(TRIGGER, RUN)
                state = parse_state(fake.state_raw, NOW)["latest_run"]
                self.assertTrue(any(item["uid"] == created_ref.uid for item in state["child_resources"]))
                self.assertEqual("succeeded", drive(fresh))
                self.assertEqual([], fake.list_run_children(RUN))

    def test_unexpected_stage_exceptions_retain_without_exception_text(self) -> None:
        secret = "https://secret.example/?sig=do-not-persist"
        cases = ("SELECT", "PROVISION", "observe", "delete")
        for case in cases:
            with self.subTest(case=case):
                fake = gateway(); instance = controller(fake)
                if case == "PROVISION":
                    instance.run(TRIGGER, RUN); instance.run(TRIGGER, RUN)
                    fake.create_child = lambda manifest: (_ for _ in ()).throw(RuntimeError(secret))
                elif case == "observe":
                    fake.observe_child = lambda ref: (_ for _ in ()).throw(RuntimeError(secret))
                elif case == "delete":
                    for _ in range(30):
                        instance.run(TRIGGER, RUN)
                        if parse_state(fake.state_raw, NOW)["latest_run"]["state"] == "CLEANUP":
                            break
                    fake.delete_child = lambda ref: (_ for _ in ()).throw(RuntimeError(secret))
                else:
                    fake.create_child = lambda manifest: (_ for _ in ()).throw(RuntimeError(secret))
                self.assertEqual("retained", instance.run(TRIGGER, RUN))
                raw = fake.state_raw or ""
                run = parse_state(raw, NOW)["latest_run"]
                self.assertEqual("INTERNAL_ERROR", run["failure_code"])
                self.assertEqual({"SELECT": "SELECT", "observe": "SELECT", "PROVISION": "PROVISION", "delete": "CLEANUP"}[case], run["failure_stage"])
                self.assertNotIn(secret, raw)
                self.assertIsNone(parse_state(raw, NOW)["active_run"])
                self.assertIsNone(fake.lease.holder_identity)

    def test_unexpected_exception_reraises_when_retention_state_write_fails(self) -> None:
        fake = gateway(); instance = controller(fake)
        instance.run(TRIGGER, RUN)
        fake.observe_child = lambda ref: (_ for _ in ()).throw(RuntimeError("stage failure"))
        fake.replace_state = lambda name, raw, version: (_ for _ in ()).throw(RuntimeError("state unavailable"))
        with self.assertRaises(RuntimeError):
            instance.run(TRIGGER, RUN)
        self.assertIsNotNone(fake.lease.holder_identity)

    def test_lease_microseconds_normalized_on_acquire(self) -> None:
        fake = gateway(); clock = datetime(2026, 1, 15, 10, 0, 0, 987654, tzinfo=timezone.utc)
        instance = Controller(fake, config(), profile(), policy(), templates(), clock=lambda: clock)
        instance.run(TRIGGER, RUN)
        self.assertEqual(0, fake.lease.acquire_time.microsecond); self.assertEqual(0, fake.lease.renew_time.microsecond)
        self.assertNotIn(".", fake.lease.holder_identity.split("|")[3])

    def test_lease_microseconds_normalized_on_renew(self) -> None:
        value = datetime(2026, 1, 15, 2, 0, 0, 123456, tzinfo=timezone(timedelta(hours=-8)))
        self.assertEqual(datetime(2026, 1, 15, 10, 0, tzinfo=timezone.utc), normalize_lease_time(value))

    def test_same_holder_repairs_post_lease_gap(self) -> None:
        fake = gateway(); fake.lease = Lease("2", holder_identity(TRIGGER.job_uid, RUN, NOW, NOW), NOW, NOW, 30)
        self.assertEqual("running", controller(fake).run(TRIGGER, RUN))
        self.assertEqual(RUN, parse_state(fake.state_raw, NOW)["active_run"]["run_id"])

    def test_post_lease_zero_child_recovery(self) -> None:
        fake = gateway(); old = "rv-20260115t090000z-deadbeef"; acquired = NOW - timedelta(minutes=3)
        fake.lease = Lease("4", holder_identity("old-uid", old, acquired, acquired), acquired, acquired, 30)
        self.assertEqual("running", controller(fake).run(TRIGGER, RUN))
        self.assertEqual("5", fake.lease.resource_version)
        self.assertEqual(TRIGGER.job_uid, fake.lease.holder_identity.split("|")[1])
        self.assertTrue(any(item.get("failure_code") == "LEASE_STATE_INITIALIZATION_LOST" for item in parse_state(fake.state_raw, NOW)["attempt_history"]))

    def test_state_store_honors_configured_max_bytes(self) -> None:
        fake = gateway()
        with self.assertRaises(ValidationError): controller(fake, state_max_bytes=100).run(TRIGGER, RUN)

    def test_cnpg_generated_service_is_valid_controlled_descendant(self) -> None:
        fake = gateway(); instance = controller(fake)
        for _ in range(3): instance.run(TRIGGER, RUN)
        state = parse_state(fake.state_raw, NOW); run = state["latest_run"]
        cluster = next(item for item in run["child_resources"] if item["kind"] == "Cluster")
        labels = {"app.kubernetes.io/managed-by": "hriv-restore-validation", "hriv.bcit.ca/restore-validation-run-id": RUN, "hriv.bcit.ca/restore-validation-role": "cnpg", "cnpg.io/cluster": child_name(RUN, "cnpg")}
        fake.create_child({"apiVersion": "v1", "kind": "Service", "metadata": {"name": "generated-rw", "labels": labels, "ownerReferences": [{"apiVersion": "postgresql.cnpg.io/v1", "kind": "Cluster", "name": cluster["name"], "uid": cluster["uid"], "controller": True}]}})
        self.assertTrue(instance._ownership_intact(run))

    def test_run_and_child_names_deterministic(self) -> None:
        self.assertEqual(RUN, make_run_id(NOW, "a1b2c3d4")); self.assertEqual("rv-a1b2c3d4-pg", child_name(RUN, "cnpg"))

    def _retained(self):
        fake = gateway(); fake.results["db-validation"] = json.dumps(database_result(system_identifier="wrong"))
        instance = controller(fake)
        self.assertEqual("retained", drive(instance))
        return fake, instance

    def test_manual_cleanup_removes_exact_sole_retained_run(self) -> None:
        fake, instance = self._retained()
        self.assertEqual("succeeded", instance.cleanup_retained("cleanup-job-uid"))
        state = parse_state(fake.state_raw, NOW)
        self.assertEqual([], state["retained_runs"])
        self.assertEqual("succeeded", state["latest_run"]["cleanup"]["outcome"])
        self.assertIsNone(fake.lease.holder_identity)
        self.assertEqual("succeeded", instance.cleanup_retained("cleanup-job-uid"))

    def test_manual_cleanup_rejects_zero_and_multiple_retained(self) -> None:
        with self.assertRaisesRegex(ValidationError, "CLEANUP_NO_RETAINED_RUN"):
            controller(gateway()).cleanup_retained("cleanup-job-uid")
        fake, instance = self._retained()
        state = parse_state(fake.state_raw, NOW)
        second = copy.deepcopy(state["retained_runs"][0]); second["run_id"] = "rv-20260115t090000z-deadbeef"
        state["retained_runs"].append(second)
        fake.state_raw = json.dumps(state)
        with self.assertRaisesRegex(ValidationError, "CLEANUP_RETAINED_COUNT_INVALID"):
            instance.cleanup_retained("cleanup-job-uid")

    def test_manual_cleanup_rejects_active_altered_and_unbound_children(self) -> None:
        fake, instance = self._retained(); state = parse_state(fake.state_raw, NOW)
        state["active_run"] = instance._summary(state["latest_run"]); fake.state_raw = json.dumps(state)
        with self.assertRaisesRegex(ValidationError, "CLEANUP_ACTIVE_RUN"):
            instance.cleanup_retained("cleanup-job-uid")
        state["active_run"] = None; fake.state_raw = json.dumps(state)
        key, (ref, manifest, observation) = next(iter(fake.children.items()))
        manifest["metadata"]["labels"]["hriv.bcit.ca/restore-validation-role"] = "altered"
        fake.children[key] = (ref, manifest, observation)
        with self.assertRaises(ValidationError): instance.cleanup_retained("cleanup-job-uid")

    def test_manual_cleanup_deletes_legitimate_cnpg_descendants(self) -> None:
        fake, instance = self._retained()
        state = parse_state(fake.state_raw, NOW)
        cluster = next(item for item in state["retained_runs"][0]["child_resources"] if item["kind"] == "Cluster")
        labels = {"app.kubernetes.io/managed-by": "hriv-restore-validation", "hriv.bcit.ca/restore-validation-run-id": RUN, "hriv.bcit.ca/restore-validation-role": "cnpg"}
        cluster_owner = {"apiVersion": "postgresql.cnpg.io/v1", "kind": "Cluster", "name": cluster["name"], "uid": cluster["uid"], "controller": True}
        job = fake.create_child({"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": "generated-full-recovery", "labels": labels, "ownerReferences": [cluster_owner]}})
        for api_version, kind, name, owner in (
            ("v1", "PersistentVolumeClaim", "generated-pg-1", cluster_owner),
            ("v1", "Service", "generated-pg-rw", cluster_owner),
            ("v1", "Pod", "generated-full-recovery-pod", {"apiVersion": "batch/v1", "kind": "Job", "name": job.name, "uid": job.uid, "controller": True}),
        ):
            fake.create_child({"apiVersion": api_version, "kind": kind, "metadata": {"name": name, "labels": labels, "ownerReferences": [owner]}})
        self.assertEqual("succeeded", instance.cleanup_retained("cleanup-job-uid"))
        self.assertFalse(fake.list_run_children(RUN))

    def test_manual_cleanup_rejects_misbound_cnpg_descendant(self) -> None:
        fake, instance = self._retained()
        state = parse_state(fake.state_raw, NOW)
        cluster = next(item for item in state["retained_runs"][0]["child_resources"] if item["kind"] == "Cluster")
        labels = {"app.kubernetes.io/managed-by": "hriv-restore-validation", "hriv.bcit.ca/restore-validation-run-id": RUN, "hriv.bcit.ca/restore-validation-role": "cnpg"}
        job = fake.create_child({"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": "generated-full-recovery", "labels": labels, "ownerReferences": [{"apiVersion": "postgresql.cnpg.io/v1", "kind": "Cluster", "name": cluster["name"], "uid": cluster["uid"], "controller": True}]}})
        fake.create_child({"apiVersion": "v1", "kind": "Pod", "metadata": {"name": "misbound-pod", "labels": labels, "ownerReferences": [{"apiVersion": "batch/v1", "kind": "Job", "name": "other-job", "uid": job.uid, "controller": True}]}})
        with self.assertRaisesRegex(ValidationError, "CLEANUP_UNBOUND_CHILD"):
            instance.cleanup_retained("cleanup-job-uid")

    def test_manual_cleanup_rejects_unbound_labelled_descendant(self) -> None:
        fake, instance = self._retained()
        labels = {"app.kubernetes.io/managed-by": "hriv-restore-validation", "hriv.bcit.ca/restore-validation-run-id": RUN, "hriv.bcit.ca/restore-validation-role": "cnpg"}
        fake.create_child({"apiVersion": "v1", "kind": "Service", "metadata": {"name": "unbound", "labels": labels, "ownerReferences": [{"apiVersion": "postgresql.cnpg.io/v1", "kind": "Cluster", "name": "unbound", "uid": "not-bound", "controller": True}]}})
        with self.assertRaisesRegex(ValidationError, "CLEANUP_UNBOUND_CHILD"):
            instance.cleanup_retained("cleanup-job-uid")

    def test_manual_cleanup_rejects_changed_bound_template_identity(self) -> None:
        fake, instance = self._retained()
        key, (ref, manifest, observation) = next(
            (item for item in fake.children.items() if item[1][1]["kind"] != "Pod")
        )
        manifest["metadata"]["annotations"]["hriv.bcit.ca/restore-validation-template-sha256"] = "0" * 64
        fake.children[key] = (ref, manifest, observation)
        with self.assertRaisesRegex(ValidationError, "OWNERSHIP_CONFLICT"):
            instance.cleanup_retained("cleanup-job-uid")
        self.assertEqual([], fake.deleted)

    def test_manual_cleanup_waits_for_partial_delete_and_survives_cas_conflict(self) -> None:
        fake, instance = self._retained(); fake.async_deletes = True
        self.assertEqual("running", instance.cleanup_retained("cleanup-job-uid"))
        fake.finish_deletes(); fake.conflicts = 1
        self.assertEqual("succeeded", instance.cleanup_retained("cleanup-job-uid"))

    def test_manual_cleanup_expired_stale_holder_takeover_continues_partial_cleanup(self) -> None:
        fake, first = self._retained(); fake.async_deletes = True
        self.assertEqual("running", first.cleanup_retained("old-cleanup-uid"))
        takeover_time = NOW + timedelta(seconds=31)
        replacement = Controller(fake, config(), profile(), policy(), templates(), clock=lambda: takeover_time)
        self.assertEqual("running", replacement.cleanup_retained("replacement-cleanup-uid"))
        self.assertEqual("replacement-cleanup-uid", fake.lease.holder_identity.split("|")[1])
        fake.finish_deletes()
        self.assertEqual("succeeded", replacement.cleanup_retained("replacement-cleanup-uid"))

    def test_manual_cleanup_stale_takeover_rejects_unexpired_live_and_different_run(self) -> None:
        for case in ("unexpired", "live", "different-run"):
            with self.subTest(case=case):
                fake, first = self._retained(); fake.async_deletes = True
                self.assertEqual("running", first.cleanup_retained("old-cleanup-uid"))
                clock = NOW + timedelta(seconds=31)
                if case == "unexpired":
                    clock = NOW + timedelta(seconds=30)
                elif case == "live":
                    fake.jobs[("", "old-cleanup-uid")] = "active"
                else:
                    acquired = fake.lease.acquire_time
                    fake.lease = Lease(fake.lease.resource_version, holder_identity("old-cleanup-uid", "rv-20260115t090000z-deadbeef", acquired, acquired), acquired, acquired, 30)
                replacement = Controller(fake, config(), profile(), policy(), templates(), clock=lambda: clock)
                with self.assertRaisesRegex(ValidationError, "CLEANUP_OVERLAP"):
                    replacement.cleanup_retained("replacement-cleanup-uid")

    def test_run_trigger_cannot_displace_live_cleanup_lease(self) -> None:
        fake, instance = self._retained(); fake.async_deletes = True
        self.assertEqual("running", instance.cleanup_retained("cleanup-a-uid"))
        trigger = type(TRIGGER)("scheduled", "weekly", "weekly-job-uid")
        self.assertEqual("rejected", instance.run(trigger, "rv-20260115t110000z-deadbeef"))
        self.assertEqual("cleanup-a-uid", fake.lease.holder_identity.split("|")[1])
        state = parse_state(fake.state_raw, NOW)
        self.assertEqual(RUN, state["latest_run"]["run_id"])
        self.assertEqual(1, len(state["retained_runs"]))
        with self.assertRaisesRegex(ValidationError, "CLEANUP_OVERLAP"):
            instance.cleanup_retained("cleanup-b-uid")
        fake.finish_deletes()
        self.assertEqual("succeeded", instance.cleanup_retained("cleanup-a-uid"))

    def test_run_trigger_cannot_displace_expired_cleanup_lease(self) -> None:
        fake, first = self._retained(); fake.async_deletes = True
        self.assertEqual("running", first.cleanup_retained("cleanup-a-uid"))
        later = NOW + timedelta(seconds=31)
        instance = Controller(fake, config(), profile(), policy(), templates(), clock=lambda: later)
        trigger = type(TRIGGER)("scheduled", "weekly", "weekly-job-uid")
        self.assertEqual("rejected", instance.run(trigger, "rv-20260115t110000z-deadbeef"))
        self.assertEqual("cleanup-a-uid", fake.lease.holder_identity.split("|")[1])
        self.assertEqual("running", instance.cleanup_retained("cleanup-b-uid"))
        self.assertEqual("cleanup-b-uid", fake.lease.holder_identity.split("|")[1])
        fake.finish_deletes()
        self.assertEqual("succeeded", instance.cleanup_retained("cleanup-b-uid"))

    def test_terminal_run_own_stale_lease_still_clears(self) -> None:
        fake, instance = self._retained()
        acquired = NOW - timedelta(minutes=3)
        fake.lease = Lease("4", holder_identity(TRIGGER.job_uid, RUN, acquired, acquired), acquired, acquired, 30)
        trigger = type(TRIGGER)("scheduled", "weekly", "weekly-job-uid")
        self.assertEqual("running", instance.run(trigger, "rv-20260115t110000z-deadbeef"))
        self.assertEqual("weekly-job-uid", fake.lease.holder_identity.split("|")[1])

    def test_terminal_report_is_bounded_and_omits_sensitive_archive_identity(self) -> None:
        fake = gateway(); instance = controller(fake); outcome = drive(instance)
        report = instance.terminal_report(TRIGGER, RUN, outcome)
        self.assertTrue(report["success"]); self.assertIn("source_files_sha256", report)
        self.assertNotIn("archive_blob", json.dumps(report)); self.assertNotIn("archive_etag", json.dumps(report))
        self.assertLess(len(json.dumps(report)), 32768)


if __name__ == "__main__": unittest.main()
