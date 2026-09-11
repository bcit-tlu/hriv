from __future__ import annotations

import copy
import json
import unittest
from datetime import datetime, timedelta, timezone

from hriv_restore_validation.controller import Controller, child_name, holder_identity, make_run_id, normalize_lease_time
from hriv_restore_validation.gateway import Lease, Observation
from hriv_restore_validation.state import parse_state
from hriv_restore_validation.strict import ValidationError
from fixtures import NOW, RUN, TRIGGER, config, consistency_result, controller, database_result, drive, gateway as fixture_gateway, policy, profile, restore_result as fixture_restore_result, selection_document as fixture_selection_document, templates


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
        self.assertEqual("core_succeeded", state["latest_run"]["core_succeeded"]["stage"])
        self.assertIsNone(state["last_complete_success"])

    def test_cnpg_uses_target_tli(self) -> None:
        fake = gateway(); drive(controller(fake))
        cluster = next(item for item in fake.created if item["kind"] == "Cluster")
        target = cluster["spec"]["bootstrap"]["recovery"]["recoveryTarget"]
        self.assertEqual({"targetLSN": "A/1234", "targetTLI": "7"}, target)
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

    def test_restore_count_mismatch(self) -> None:
        fake = gateway(); fake.results["source-restore"] = json.dumps(restore_result(restored_file_count=1))
        self.assertEqual("retained", drive(controller(fake)))

    def test_consistency_policy_mismatch(self) -> None:
        fake = gateway(); fake.results["consistency"] = json.dumps(consistency_result(orphan_sources=[{"stored_path": "x"}]))
        self.assertEqual("retained", drive(controller(fake)))

    def test_selection_binding_preserves_machine_evidence_and_local_digests(self) -> None:
        fake = gateway(); fake.results["selection"] = json.dumps(selection_document(exclusion_count=1, excluded_artifacts=[{"path": "data/admin", "reason": "non_authoritative_production_data"}]))
        controller(fake).run(TRIGGER, RUN)
        selected = parse_state(fake.state_raw, NOW)["latest_run"]["selected_source"]
        for field in ("backup_run_id", "manifest_sha256", "archive_blob", "archive_size", "archive_etag", "completed_at", "target_lsn", "target_timeline", "source_file_count", "source_total_bytes", "database_row_count", "missing_count", "orphan_count", "exclusion_count", "source_state", "source_state_sha256", "excluded_artifacts", "source_profile_id", "source_profile_sha256", "source_state_policy_version", "source_state_policy_sha256"):
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
            outcome = instance.run(TRIGGER, RUN)
            if parse_state(fake.state_raw, NOW)["latest_run"]["state"] == "CLEANUP": break
        self.assertEqual("running", instance.run(TRIGGER, RUN))
        deleted = len(fake.deleted); self.assertGreater(deleted, 0)
        self.assertEqual("running", instance.run(TRIGGER, RUN)); self.assertEqual(deleted, len(fake.deleted))
        fake.finish_deletes(); self.assertEqual("succeeded", instance.run(TRIGGER, RUN))

    def test_create_conflict_is_retained(self) -> None:
        fake = gateway()
        fake.create_child({"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": child_name(RUN, "selection"), "labels": {}}})
        self.assertEqual("retained", controller(fake).run(TRIGGER, RUN))

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
        fake.create_child({"apiVersion": "v1", "kind": "Service", "metadata": {"name": "generated-rw", "labels": labels, "ownerReferences": [{"kind": "Cluster", "uid": cluster["uid"], "controller": True}]}})
        self.assertTrue(instance._ownership_intact(run))

    def test_run_and_child_names_deterministic(self) -> None:
        self.assertEqual(RUN, make_run_id(NOW, "a1b2c3d4")); self.assertEqual("rv-a1b2c3d4-pg", child_name(RUN, "cnpg"))


if __name__ == "__main__": unittest.main()
