from __future__ import annotations

import copy
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from .models import ResourceRef
from .strict import UID_RE, ValidationError, canonical_json

MANAGED_BY_LABEL = "app.kubernetes.io/managed-by"
RUN_LABEL = "hriv.bcit.ca/restore-validation-run-id"
ROLE_LABEL = "hriv.bcit.ca/restore-validation-role"
TEMPLATE_IDENTITY_ANNOTATION = "hriv.bcit.ca/restore-validation-template-sha256"
_REQUIRED_LABELS = (MANAGED_BY_LABEL, RUN_LABEL, ROLE_LABEL)
_VOLATILE_ANNOTATIONS = {"hriv.bcit.ca/created-at", "hriv.bcit.ca/expires-at", TEMPLATE_IDENTITY_ANNOTATION}


def _fixed_spec(value: Any) -> Any:
    if isinstance(value, dict):
        result = {key: _fixed_spec(item) for key, item in value.items()}
        annotations = result.get("annotations")
        if isinstance(annotations, dict):
            result["annotations"] = {key: item for key, item in annotations.items() if key not in _VOLATILE_ANNOTATIONS}
        return result
    if isinstance(value, list):
        return [_fixed_spec(item) for item in value]
    return copy.deepcopy(value)


def _contains_fixed(actual: Any, desired: Any) -> bool:
    if isinstance(desired, dict):
        return isinstance(actual, dict) and all(
            key in actual and _contains_fixed(actual[key], value) for key, value in desired.items()
        )
    if isinstance(desired, list):
        return isinstance(actual, list) and len(actual) == len(desired) and all(
            _contains_fixed(actual_item, desired_item)
            for actual_item, desired_item in zip(actual, desired, strict=True)
        )
    return actual == desired


def template_identity(manifest: dict[str, Any]) -> str:
    metadata = manifest.get("metadata", {})
    labels = metadata.get("labels", {})
    document = {
        "apiVersion": manifest.get("apiVersion"),
        "kind": manifest.get("kind"),
        "name": metadata.get("name"),
        "labels": {key: labels.get(key) for key in _REQUIRED_LABELS},
        "spec": _fixed_spec(manifest.get("spec")),
    }
    return hashlib.sha256(canonical_json(document).encode("utf-8")).hexdigest()


def adopted_ref(desired: dict[str, Any], actual: dict[str, Any]) -> ResourceRef:
    desired_metadata = desired.get("metadata", {})
    actual_metadata = actual.get("metadata", {})
    labels = actual_metadata.get("labels", {})
    desired_labels = desired_metadata.get("labels", {})
    annotations = actual_metadata.get("annotations", {})
    desired_digest = desired_metadata.get("annotations", {}).get(TEMPLATE_IDENTITY_ANNOTATION)
    uid = str(actual_metadata.get("uid", ""))
    exact_identity = (
        actual.get("apiVersion") == desired.get("apiVersion")
        and actual.get("kind") == desired.get("kind")
        and actual_metadata.get("name") == desired_metadata.get("name")
    )
    if (
        not exact_identity
        or desired_labels.get(MANAGED_BY_LABEL) != "hriv-restore-validation"
        or any(not isinstance(desired_labels.get(key), str) or not desired_labels[key] or labels.get(key) != desired_labels[key] for key in _REQUIRED_LABELS)
        or not isinstance(desired_digest, str)
        or desired_digest != template_identity(desired)
        or annotations.get(TEMPLATE_IDENTITY_ANNOTATION) != desired_digest
        or not _contains_fixed(
            _fixed_spec(actual.get("spec")), _fixed_spec(desired.get("spec"))
        )
        or UID_RE.fullmatch(uid) is None
    ):
        raise ValidationError("OWNERSHIP_CONFLICT")
    return ResourceRef(desired["apiVersion"], desired["kind"], desired_metadata["name"], uid)


class Conflict(RuntimeError):
    pass


@dataclass(frozen=True)
class Lease:
    resource_version: str
    holder_identity: str | None
    acquire_time: datetime | None
    renew_time: datetime | None
    duration_seconds: int | None


@dataclass(frozen=True)
class Observation:
    phase: str
    result: str | None = None
    resources: tuple[ResourceRef, ...] = ()


class Gateway(Protocol):
    conflict_error: type[Exception]

    def read_state(self, name: str) -> tuple[str | None, str]:
        raise NotImplementedError

    def replace_state(self, name: str, raw: str, resource_version: str) -> None:
        raise NotImplementedError

    def read_lease(self, name: str) -> Lease:
        raise NotImplementedError

    def replace_lease(self, name: str, lease: Lease) -> Lease:
        raise NotImplementedError

    def holder_job_status(self, name: str, uid: str) -> str:
        raise NotImplementedError

    def list_run_children(self, run_id: str) -> list[ResourceRef]:
        raise NotImplementedError

    def create_child(self, manifest: dict[str, Any]) -> ResourceRef:
        raise NotImplementedError

    def get_child(self, ref: ResourceRef) -> dict[str, Any] | None:
        raise NotImplementedError

    def observe_child(self, ref: ResourceRef) -> Observation:
        raise NotImplementedError

    def delete_child(self, ref: ResourceRef) -> None:
        raise NotImplementedError

    def namespace_usage(self) -> dict[str, int]:
        raise NotImplementedError


class FakeGateway:
    conflict_error = Conflict

    def __init__(self) -> None:
        self.state_raw: str | None = None
        self.state_version = 1
        self.lease = Lease("1", None, None, None, None)
        self.children: dict[tuple[str, str, str], tuple[ResourceRef, dict[str, Any], Observation]] = {}
        self.jobs: dict[tuple[str, str], str] = {}
        self.conflicts = 0
        self.created: list[dict[str, Any]] = []
        self.deleted: list[ResourceRef] = []
        self.results: dict[str, str] = {}
        self.phases: dict[str, str] = {}
        self.async_deletes = False

    def read_state(self, name: str) -> tuple[str | None, str]:
        return self.state_raw, str(self.state_version)

    def replace_state(self, name: str, raw: str, resource_version: str) -> None:
        if self.conflicts:
            self.conflicts -= 1
            raise Conflict()
        if resource_version != str(self.state_version):
            raise Conflict()
        self.state_raw = raw
        self.state_version += 1

    def read_lease(self, name: str) -> Lease:
        return self.lease

    def replace_lease(self, name: str, lease: Lease) -> Lease:
        if lease.resource_version != self.lease.resource_version:
            raise Conflict()
        def normalized(value: datetime | None) -> datetime | None:
            if value is None:
                return None
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValidationError("LEASE_TIMESTAMP_INVALID")
            return value.astimezone(timezone.utc).replace(microsecond=0)
        acquired, renewed = normalized(lease.acquire_time), normalized(lease.renew_time)
        if lease.holder_identity is not None:
            parts = lease.holder_identity.split("|")
            times = tuple(value.isoformat(timespec="seconds").replace("+00:00", "Z") for value in (acquired, renewed) if value is not None)
            if len(parts) != 5 or len(times) != 2 or tuple(parts[-2:]) != times:
                raise ValidationError("LEASE_IDENTITY_INVALID")
        elif acquired is not None or renewed is not None:
            raise ValidationError("LEASE_TIMESTAMP_INVALID")
        self.lease = Lease(str(int(self.lease.resource_version) + 1), lease.holder_identity, acquired, renewed, lease.duration_seconds)
        return self.lease

    def holder_job_status(self, name: str, uid: str) -> str:
        return self.jobs.get((name, uid), "absent")

    def list_run_children(self, run_id: str) -> list[ResourceRef]:
        return [ref for ref, manifest, _ in self.children.values() if manifest.get("metadata", {}).get("labels", {}).get("hriv.bcit.ca/restore-validation-run-id") == run_id]

    def create_child(self, manifest: dict[str, Any]) -> ResourceRef:
        manifest = copy.deepcopy(manifest)
        metadata = manifest["metadata"]
        key = (manifest["apiVersion"], manifest["kind"], metadata["name"])
        if key in self.children:
            actual_ref, actual_manifest, _ = self.children[key]
            actual = copy.deepcopy(actual_manifest)
            actual["metadata"] = copy.deepcopy(actual_manifest["metadata"]) | {"uid": actual_ref.uid}
            return adopted_ref(manifest, actual)
        uid = f"uid-{len(self.children) + 1}"
        ref = ResourceRef(manifest["apiVersion"], manifest["kind"], metadata["name"], uid)
        role = metadata.get("labels", {}).get("hriv.bcit.ca/restore-validation-role", "")
        result = self.results.get(role)
        phase = self.phases.get(role, "Healthy" if manifest["kind"] == "Cluster" else "Succeeded")
        self.children[key] = (ref, manifest, Observation(phase, result))
        self.created.append(manifest)
        return ref

    def get_child(self, ref: ResourceRef) -> dict[str, Any] | None:
        item = self.children.get((ref.api_version, ref.kind, ref.name))
        if item is None:
            return None
        actual, manifest, _ = item
        if actual.uid != ref.uid:
            return copy.deepcopy(manifest) | {"metadata": copy.deepcopy(manifest["metadata"]) | {"uid": actual.uid}}
        return copy.deepcopy(manifest) | {"metadata": copy.deepcopy(manifest["metadata"]) | {"uid": actual.uid}}

    def observe_child(self, ref: ResourceRef) -> Observation:
        item = self.children.get((ref.api_version, ref.kind, ref.name))
        return Observation("Absent") if item is None else item[2]

    def delete_child(self, ref: ResourceRef) -> None:
        key = (ref.api_version, ref.kind, ref.name)
        item = self.children.get(key)
        if item is None:
            return
        actual, manifest, _ = item
        labels = manifest.get("metadata", {}).get("labels", {})
        if actual.uid != ref.uid or labels.get("app.kubernetes.io/managed-by") != "hriv-restore-validation":
            raise ValidationError("OWNERSHIP_CONFLICT")
        self.deleted.append(ref)
        if self.async_deletes:
            manifest.setdefault("metadata", {})["deletionTimestamp"] = "2026-01-15T10:00:00Z"
            self.children[key] = (actual, manifest, Observation("Terminating"))
        else:
            del self.children[key]

    def finish_deletes(self) -> None:
        for key, (_, manifest, _) in list(self.children.items()):
            if manifest.get("metadata", {}).get("deletionTimestamp"):
                del self.children[key]

    def namespace_usage(self) -> dict[str, int]:
        return {
            "jobs": sum(ref.kind == "Job" for ref, _, _ in self.children.values()),
            "pvcs": sum(ref.kind == "PersistentVolumeClaim" for ref, _, _ in self.children.values()),
        }
