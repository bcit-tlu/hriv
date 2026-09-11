from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from kubernetes import client, config
from kubernetes.client import ApiException

from .gateway import Conflict, Lease, Observation
from .models import ResourceRef
from .strict import ValidationError, parse_json


class KubernetesGateway:
    conflict_error = Conflict

    def __init__(self, namespace: str, *, load_config: bool = True) -> None:
        if load_config:
            config.load_incluster_config()
        self.namespace = namespace
        self.core = client.CoreV1Api()
        self.batch = client.BatchV1Api()
        self.coordination = client.CoordinationV1Api()
        self.custom = client.CustomObjectsApi()
        self.apps = client.AppsV1Api()

    def read_state(self, name: str) -> tuple[str | None, str]:
        obj = self.core.read_namespaced_config_map(name, self.namespace)
        return (obj.data or {}).get("state.json"), str(obj.metadata.resource_version)

    def replace_state(self, name: str, raw: str, resource_version: str) -> None:
        body = {"metadata": {"resourceVersion": resource_version}, "data": {"state.json": raw}}
        try:
            self.core.patch_namespaced_config_map(name, self.namespace, body)
        except ApiException as exc:
            if exc.status == 409:
                raise Conflict() from exc
            raise

    def read_lease(self, name: str) -> Lease:
        obj = self.coordination.read_namespaced_lease(name, self.namespace)
        spec = obj.spec
        return Lease(str(obj.metadata.resource_version), spec.holder_identity, _time(spec.acquire_time), _time(spec.renew_time), spec.lease_duration_seconds)

    def replace_lease(self, name: str, lease: Lease) -> Lease:
        acquire_time = _time(lease.acquire_time)
        renew_time = _time(lease.renew_time)
        _validate_lease_identity(lease.holder_identity, acquire_time, renew_time)
        body = {
            "metadata": {"resourceVersion": lease.resource_version},
            "spec": {"holderIdentity": lease.holder_identity, "acquireTime": acquire_time, "renewTime": renew_time, "leaseDurationSeconds": lease.duration_seconds},
        }
        try:
            obj = self.coordination.patch_namespaced_lease(name, self.namespace, body)
        except ApiException as exc:
            if exc.status == 409:
                raise Conflict() from exc
            raise
        stored = Lease(str(obj.metadata.resource_version), obj.spec.holder_identity, _time(obj.spec.acquire_time), _time(obj.spec.renew_time), obj.spec.lease_duration_seconds)
        _validate_lease_identity(stored.holder_identity, stored.acquire_time, stored.renew_time)
        return stored

    def holder_job_status(self, name: str, uid: str) -> str:
        if not name:
            jobs = [
                item
                for item in self.batch.list_namespaced_job(self.namespace).items
                if str(item.metadata.uid) == uid
            ]
            if not jobs:
                return "absent"
            if len(jobs) != 1:
                return "mismatch"
            obj = jobs[0]
        else:
            try:
                obj = self.batch.read_namespaced_job(name, self.namespace)
            except ApiException as exc:
                if exc.status == 404:
                    return "absent"
                raise
            if str(obj.metadata.uid) != uid:
                return "mismatch"
        return "terminal" if (obj.status.completion_time or obj.status.failed) else "live"

    def list_run_children(self, run_id: str) -> list[ResourceRef]:
        selector = f"hriv.bcit.ca/restore-validation-run-id={run_id}"
        refs: list[ResourceRef] = []
        for api_version, kind, objects in (
            ("v1", "Pod", self.core.list_namespaced_pod(self.namespace, label_selector=selector).items),
            ("v1", "Service", self.core.list_namespaced_service(self.namespace, label_selector=selector).items),
            ("v1", "PersistentVolumeClaim", self.core.list_namespaced_persistent_volume_claim(self.namespace, label_selector=selector).items),
            ("batch/v1", "Job", self.batch.list_namespaced_job(self.namespace, label_selector=selector).items),
        ):
            refs.extend(ResourceRef(api_version, kind, obj.metadata.name, str(obj.metadata.uid)) for obj in objects)
        clusters = self.custom.list_namespaced_custom_object("postgresql.cnpg.io", "v1", self.namespace, "clusters", label_selector=selector).get("items", [])
        refs.extend(ResourceRef("postgresql.cnpg.io/v1", "Cluster", obj["metadata"]["name"], str(obj["metadata"]["uid"])) for obj in clusters)
        return refs

    def create_child(self, manifest: dict[str, Any]) -> ResourceRef:
        api, kind = manifest["apiVersion"], manifest["kind"]
        try:
            obj = self._create(api, kind, manifest)
        except ApiException as exc:
            if exc.status == 409:
                raise ValidationError("OWNERSHIP_CONFLICT") from exc
            raise
        metadata = _metadata(obj)
        return ResourceRef(api, kind, metadata["name"], str(metadata["uid"]))

    def get_child(self, ref: ResourceRef) -> dict[str, Any] | None:
        try:
            obj = self._read(ref.api_version, ref.kind, ref.name)
        except ApiException as exc:
            if exc.status == 404:
                return None
            raise
        return client.ApiClient().sanitize_for_serialization(obj)

    def observe_child(self, ref: ResourceRef) -> Observation:
        obj = self.get_child(ref)
        if obj is None:
            return Observation("Absent")
        if ref.kind == "Job":
            status = obj.get("status", {})
            if status.get("succeeded") == 1:
                result, pod_ref = self._job_log_result(ref, obj, expect_success=True)
                return Observation("Succeeded", result, (pod_ref,))
            if status.get("failed", 0):
                result, pod_ref = self._job_log_result(ref, obj, expect_success=False)
                return Observation("Failed", result, (pod_ref,))
            return Observation("Running")
        if ref.kind == "Cluster":
            status = obj.get("status", {})
            conditions = status.get("conditions", [])
            ready = any(item.get("type") == "Ready" and item.get("status") == "True" for item in conditions)
            healthy = ready and status.get("phase") == "Cluster in healthy state" and status.get("readyInstances") == 1 and status.get("instances") == 1
            return Observation("Healthy" if healthy else "Running")
        return Observation("Succeeded")

    def _job_log_result(self, ref: ResourceRef, job: dict[str, Any], *, expect_success: bool) -> tuple[str | None, ResourceRef]:
        selector = f"batch.kubernetes.io/controller-uid={ref.uid},job-name={ref.name}"
        pods = self.core.list_namespaced_pod(self.namespace, label_selector=selector).items
        if len(pods) != 1:
            raise ValidationError("JOB_POD_AMBIGUOUS")
        pod = pods[0]
        labels = pod.metadata.labels or {}
        owners = pod.metadata.owner_references or []
        job_labels = job.get("metadata", {}).get("labels", {})
        required = ("app.kubernetes.io/managed-by", "hriv.bcit.ca/restore-validation-run-id", "hriv.bcit.ca/restore-validation-role")
        expected = {key: job_labels.get(key) for key in required}
        expected_container = job.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [{}])[0].get("name")
        statuses = pod.status.container_statuses or []
        owner_valid = (
            len(owners) == 1
            and owners[0].kind == "Job"
            and owners[0].name == ref.name
            and str(owners[0].uid) == ref.uid
            and owners[0].controller is True
        )
        if any(value is None or labels.get(key) != value for key, value in expected.items()) or labels.get("job-name") != ref.name or labels.get("batch.kubernetes.io/controller-uid") != ref.uid or not owner_valid or len(statuses) != 1 or statuses[0].name != expected_container or not statuses[0].state.terminated:
            raise ValidationError("JOB_POD_OWNERSHIP_INVALID")
        exit_code = statuses[0].state.terminated.exit_code
        if (expect_success and exit_code != 0) or (not expect_success and exit_code == 0):
            raise ValidationError("JOB_POD_EXIT_INVALID")
        pod_ref = ResourceRef("v1", "Pod", pod.metadata.name, str(pod.metadata.uid))
        try:
            log = self.core.read_namespaced_pod_log(pod.metadata.name, self.namespace, container=statuses[0].name, limit_bytes=32769)
            if not isinstance(log, str) or len(log.encode()) > 32768:
                raise ValidationError("JOB_LOG_TOO_LARGE")
            lines = [line for line in log.splitlines() if line.strip()]
            if not lines:
                raise ValidationError("RESULT_MISSING")
            if not isinstance(parse_json(lines[-1], max_bytes=32768), dict):
                raise ValidationError("RESULT_INVALID")
            for diagnostic in lines[:-1]:
                try:
                    parsed = parse_json(diagnostic, max_bytes=32768)
                except ValidationError:
                    continue
                if isinstance(parsed, dict):
                    raise ValidationError("RESULT_AMBIGUOUS")
        except ValidationError:
            if expect_success:
                raise
            return None, pod_ref
        return lines[-1], pod_ref

    def delete_child(self, ref: ResourceRef) -> None:
        actual = self.get_child(ref)
        if actual is None:
            return
        metadata = actual["metadata"]
        if str(metadata.get("uid")) != ref.uid or metadata.get("labels", {}).get("app.kubernetes.io/managed-by") != "hriv-restore-validation":
            raise ValidationError("OWNERSHIP_CONFLICT")
        body = client.V1DeleteOptions(preconditions=client.V1Preconditions(uid=ref.uid), propagation_policy="Foreground")
        try:
            self._delete(ref.api_version, ref.kind, ref.name, body)
        except ApiException as exc:
            if exc.status != 404:
                raise

    def namespace_usage(self) -> dict[str, int]:
        return {
            "jobs": len(self.batch.list_namespaced_job(self.namespace).items),
            "pvcs": len(self.core.list_namespaced_persistent_volume_claim(self.namespace).items),
        }

    def _create(self, api: str, kind: str, body: dict[str, Any]) -> Any:
        table: dict[tuple[str, str], Callable[..., Any]] = {
            ("v1", "PersistentVolumeClaim"): self.core.create_namespaced_persistent_volume_claim,
            ("v1", "ConfigMap"): self.core.create_namespaced_config_map,
            ("v1", "Service"): self.core.create_namespaced_service,
            ("batch/v1", "Job"): self.batch.create_namespaced_job,
            ("apps/v1", "Deployment"): self.apps.create_namespaced_deployment,
        }
        if (api, kind) == ("postgresql.cnpg.io/v1", "Cluster"):
            return self.custom.create_namespaced_custom_object("postgresql.cnpg.io", "v1", self.namespace, "clusters", body)
        if (api, kind) not in table:
            raise ValidationError("RESOURCE_KIND_FORBIDDEN")
        return table[(api, kind)](self.namespace, body)

    def _read(self, api: str, kind: str, name: str) -> Any:
        table = {
            ("v1", "Pod"): self.core.read_namespaced_pod,
            ("v1", "PersistentVolumeClaim"): self.core.read_namespaced_persistent_volume_claim,
            ("v1", "ConfigMap"): self.core.read_namespaced_config_map,
            ("v1", "Service"): self.core.read_namespaced_service,
            ("batch/v1", "Job"): self.batch.read_namespaced_job,
            ("apps/v1", "Deployment"): self.apps.read_namespaced_deployment,
        }
        if (api, kind) == ("postgresql.cnpg.io/v1", "Cluster"):
            return self.custom.get_namespaced_custom_object("postgresql.cnpg.io", "v1", self.namespace, "clusters", name)
        if (api, kind) not in table:
            raise ValidationError("RESOURCE_KIND_FORBIDDEN")
        return table[(api, kind)](name, self.namespace)

    def _delete(self, api: str, kind: str, name: str, body: Any) -> Any:
        table = {
            ("v1", "Pod"): self.core.delete_namespaced_pod,
            ("v1", "PersistentVolumeClaim"): self.core.delete_namespaced_persistent_volume_claim,
            ("v1", "ConfigMap"): self.core.delete_namespaced_config_map,
            ("v1", "Service"): self.core.delete_namespaced_service,
            ("batch/v1", "Job"): self.batch.delete_namespaced_job,
            ("apps/v1", "Deployment"): self.apps.delete_namespaced_deployment,
        }
        if (api, kind) == ("postgresql.cnpg.io/v1", "Cluster"):
            return self.custom.delete_namespaced_custom_object("postgresql.cnpg.io", "v1", self.namespace, "clusters", name, body=client.ApiClient().sanitize_for_serialization(body))
        if (api, kind) not in table:
            raise ValidationError("RESOURCE_KIND_FORBIDDEN")
        return table[(api, kind)](name, self.namespace, body=body)


def _time(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValidationError("LEASE_TIMESTAMP_INVALID")
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def _validate_lease_identity(holder: str | None, acquired: datetime | None, renewed: datetime | None) -> None:
    if holder is None:
        if acquired is not None or renewed is not None:
            raise ValidationError("LEASE_TIMESTAMP_INVALID")
        return
    parts = holder.split("|")
    if len(parts) != 5 or acquired is None or renewed is None:
        raise ValidationError("LEASE_IDENTITY_INVALID")
    expected = (
        acquired.isoformat(timespec="seconds").replace("+00:00", "Z"),
        renewed.isoformat(timespec="seconds").replace("+00:00", "Z"),
    )
    if tuple(parts[-2:]) != expected:
        raise ValidationError("LEASE_IDENTITY_INVALID")


def _metadata(obj: Any) -> dict[str, Any]:
    if isinstance(obj, dict):
        return obj["metadata"]
    return client.ApiClient().sanitize_for_serialization(obj)["metadata"]
