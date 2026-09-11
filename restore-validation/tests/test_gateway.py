from __future__ import annotations

import copy
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

from kubernetes.client import ApiException

import hriv_restore_validation.kubernetes_gateway as kubernetes_gateway
from hriv_restore_validation.gateway import FakeGateway, Lease, TEMPLATE_IDENTITY_ANNOTATION, template_identity
from hriv_restore_validation.models import ResourceRef
from hriv_restore_validation.strict import ValidationError


class GatewayTests(unittest.TestCase):
    def test_lease_api_time_roundtrip_normalizes(self):
        value = datetime(2026, 1, 15, 2, 0, 0, 999999, tzinfo=timezone(timedelta(hours=-8)))
        self.assertEqual(datetime(2026, 1, 15, 10, 0, tzinfo=timezone.utc), kubernetes_gateway._time(value))

    def test_lease_write_microsecond_roundtrip_is_exact_utc_seconds(self):
        gateway = self._gateway(); gateway.coordination = Mock()
        raw = datetime(2026, 1, 15, 2, 0, 0, 999999, tzinfo=timezone(timedelta(hours=-8)))
        normalized = datetime(2026, 1, 15, 10, 0, tzinfo=timezone.utc)
        holder = "v1|job-uid|rv-20260115t100000z-a1b2c3d4|2026-01-15T10:00:00Z|2026-01-15T10:00:00Z"
        response_spec = SimpleNamespace(holder_identity=holder, acquire_time=raw, renew_time=raw, lease_duration_seconds=30)
        gateway.coordination.patch_namespaced_lease.return_value = SimpleNamespace(metadata=SimpleNamespace(resource_version="8"), spec=response_spec)
        stored = gateway.replace_lease("lease", Lease("7", holder, raw, raw, 30))
        body = gateway.coordination.patch_namespaced_lease.call_args.args[2]
        self.assertEqual(normalized, body["spec"]["acquireTime"]); self.assertEqual(normalized, stored.renew_time)

    @staticmethod
    def _manifest():
        manifest = {"apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": {"name": "x", "labels": {"app.kubernetes.io/managed-by": "hriv-restore-validation", "hriv.bcit.ca/restore-validation-run-id": "run", "hriv.bcit.ca/restore-validation-role": "source-pvc"}, "annotations": {}}, "spec": {"accessModes": ["ReadWriteOnce"]}}
        manifest["metadata"]["annotations"][TEMPLATE_IDENTITY_ANNOTATION] = template_identity(manifest)
        return manifest

    def test_fake_create_conflict_adopts_exact_identity(self):
        fake = FakeGateway(); manifest = self._manifest(); expected = fake.create_child(manifest)
        self.assertEqual(expected, fake.create_child(manifest))

    def test_fake_create_conflict_rejects_spoofed_binding(self):
        for mutation in ("label", "digest", "spec"):
            with self.subTest(mutation=mutation):
                fake = FakeGateway(); manifest = self._manifest(); fake.create_child(manifest)
                retry = self._manifest()
                if mutation == "label":
                    retry["metadata"]["labels"]["hriv.bcit.ca/restore-validation-run-id"] = "other"
                elif mutation == "digest":
                    retry["metadata"]["annotations"][TEMPLATE_IDENTITY_ANNOTATION] = "0" * 64
                else:
                    retry["spec"]["accessModes"] = ["ReadOnlyMany"]
                    retry["metadata"]["annotations"][TEMPLATE_IDENTITY_ANNOTATION] = template_identity(retry)
                with self.assertRaises(ValidationError):
                    fake.create_child(retry)

    def test_fake_async_delete(self):
        fake = FakeGateway(); ref = fake.create_child({"apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": {"name": "x", "labels": {"app.kubernetes.io/managed-by": "hriv-restore-validation"}}}); fake.async_deletes = True; fake.delete_child(ref)
        self.assertIsNotNone(fake.get_child(ref)); fake.finish_deletes(); self.assertIsNone(fake.get_child(ref))

    def _gateway(self):
        gateway = object.__new__(kubernetes_gateway.KubernetesGateway); gateway.namespace = "ns"; gateway.core = Mock(); gateway.batch = Mock(); gateway.custom = Mock(); gateway.apps = Mock(); return gateway

    def _successful(self, log='diagnostic\n{"schema_version":1}\n', *, failed=False, exit_code=0):
        gateway = self._gateway(); ref = ResourceRef("batch/v1", "Job", "job", "job-uid")
        labels = {"app.kubernetes.io/managed-by": "hriv-restore-validation", "hriv.bcit.ca/restore-validation-run-id": "run", "hriv.bcit.ca/restore-validation-role": "selection"}
        gateway.get_child = Mock(return_value={"metadata": {"labels": labels}, "spec": {"template": {"spec": {"containers": [{"name": "main"}]}}}, "status": {"failed" if failed else "succeeded": 1}})
        terminated = SimpleNamespace(exit_code=exit_code); status = SimpleNamespace(name="main", state=SimpleNamespace(terminated=terminated)); owner = SimpleNamespace(kind="Job", name="job", uid="job-uid", controller=True)
        pod_labels = labels | {"job-name": "job", "batch.kubernetes.io/controller-uid": "job-uid"}
        pod = SimpleNamespace(metadata=SimpleNamespace(name="pod", uid="pod-uid", labels=pod_labels, owner_references=[owner]), status=SimpleNamespace(container_statuses=[status]))
        gateway.core.list_namespaced_pod.return_value.items = [pod]; gateway.core.read_namespaced_pod_log.return_value = log
        return gateway, ref

    def test_job_result_final_log_line(self):
        gateway, ref = self._successful(); self.assertEqual('{"schema_version":1}', gateway.observe_child(ref).result)

    def test_job_requires_one_pod(self):
        gateway, ref = self._successful(); gateway.core.list_namespaced_pod.return_value.items = []
        with self.assertRaises(ValidationError): gateway.observe_child(ref)

    def test_job_requires_owner_uid(self):
        gateway, ref = self._successful(); gateway.core.list_namespaced_pod.return_value.items[0].metadata.owner_references[0].uid = "wrong"
        with self.assertRaises(ValidationError): gateway.observe_child(ref)

    def test_job_requires_controller_owner_and_exact_required_labels(self):
        gateway, ref = self._successful(); pod = gateway.core.list_namespaced_pod.return_value.items[0]
        pod.metadata.owner_references[0].controller = False
        with self.assertRaises(ValidationError): gateway.observe_child(ref)
        gateway, ref = self._successful(); gateway.core.list_namespaced_pod.return_value.items[0].metadata.labels["hriv.bcit.ca/restore-validation-run-id"] = "wrong"
        with self.assertRaises(ValidationError): gateway.observe_child(ref)

    def test_job_uses_uid_and_name_selector(self):
        gateway, ref = self._successful(); gateway.observe_child(ref)
        self.assertEqual("batch.kubernetes.io/controller-uid=job-uid,job-name=job", gateway.core.list_namespaced_pod.call_args.kwargs["label_selector"])

    def test_job_requires_exit_zero(self):
        gateway, ref = self._successful(); gateway.core.list_namespaced_pod.return_value.items[0].status.container_statuses[0].state.terminated.exit_code = 1
        with self.assertRaises(ValidationError): gateway.observe_child(ref)

    def test_job_log_bounded(self):
        gateway, ref = self._successful("x" * 32769)
        with self.assertRaises(ValidationError): gateway.observe_child(ref)

    def test_failed_job_returns_owned_failure_result(self):
        raw = '{"schema_version":1,"operation":"validation-select","success":false,"failure_code":"MARKER_MISSING"}'
        gateway, ref = self._successful(raw, failed=True, exit_code=1)
        observation = gateway.observe_child(ref)
        self.assertEqual("Failed", observation.phase); self.assertEqual(raw, observation.result)
        self.assertEqual((ResourceRef("v1", "Pod", "pod", "pod-uid"),), observation.resources)

    def test_failed_job_malformed_result_is_generic(self):
        gateway, ref = self._successful("not-json", failed=True, exit_code=2)
        observation = gateway.observe_child(ref)
        self.assertEqual("Failed", observation.phase); self.assertIsNone(observation.result)

    def test_cnpg_ready_only_is_not_healthy(self):
        gateway = self._gateway(); ref = ResourceRef("postgresql.cnpg.io/v1", "Cluster", "db", "uid")
        gateway.get_child = Mock(return_value={"status": {"conditions": [{"type": "Ready", "status": "True"}], "phase": "Setting up primary", "readyInstances": 1, "instances": 1}})
        self.assertEqual("Running", gateway.observe_child(ref).phase)

    def test_cnpg_full_gate_is_healthy(self):
        gateway = self._gateway(); ref = ResourceRef("postgresql.cnpg.io/v1", "Cluster", "db", "uid")
        gateway.get_child = Mock(return_value={"status": {"conditions": [{"type": "Ready", "status": "True"}], "phase": "Cluster in healthy state", "readyInstances": 1, "instances": 1}})
        self.assertEqual("Healthy", gateway.observe_child(ref).phase)

    def test_job_extra_controller_label_allowed(self):
        gateway, ref = self._successful(); gateway.get_child.return_value["metadata"]["labels"]["operator-added"] = "yes"; gateway.core.list_namespaced_pod.return_value.items[0].metadata.labels["batch.kubernetes.io/controller-uid"] = "job-uid"
        self.assertEqual("Succeeded", gateway.observe_child(ref).phase)

    def test_create_409_adopts_only_exact_deterministic_resource(self):
        desired = self._manifest()
        existing = copy.deepcopy(desired)
        existing["metadata"]["uid"] = "uid-existing"
        gateway = self._gateway(); gateway._create = Mock(side_effect=ApiException(status=409)); gateway._read = Mock(return_value=existing)
        self.assertEqual("uid-existing", gateway.create_child(desired).uid)
        for field, value in (("uid", "unsafe uid"), ("name", "other")):
            with self.subTest(field=field):
                drifted = copy.deepcopy(existing); drifted["metadata"][field] = value; gateway._read.return_value = drifted
                with self.assertRaises(ValidationError): gateway.create_child(desired)
        drifted = copy.deepcopy(existing)
        drifted["spec"]["accessModes"] = ["ReadOnlyMany"]
        gateway._read.return_value = drifted
        with self.assertRaises(ValidationError):
            gateway.create_child(desired)

    def test_no_secret_api_usage(self):
        import inspect
        self.assertNotIn("read_namespaced_secret", inspect.getsource(kubernetes_gateway)); self.assertNotIn("list_namespaced_secret", inspect.getsource(kubernetes_gateway))


if __name__ == "__main__": unittest.main()
