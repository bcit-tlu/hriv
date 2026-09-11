from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .strict import DNS_RE, ValidationError, bounded_string, exact_object, integer, parse_json

IMAGE_RE = re.compile(r"[^\s@]+@sha256:[0-9a-f]{64}")
IDENT_RE = re.compile(r"[a-z_][a-z0-9_]{0,62}")
PG_NAME_RE = re.compile(r"[a-z_][a-z0-9_-]{0,62}")
NO_PERMISSION_SA = "hriv-restore-validation-no-permission"
AZURE_SECRET = "hriv-restore-validation-azure-read"


def _strings(value: Any, name: str, maximum: int = 64) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) > maximum:
        raise ValidationError("SCHEMA_INVALID", name)
    result = tuple(bounded_string(item, name, 128) for item in value)
    if len(set(result)) != len(result):
        raise ValidationError("SCHEMA_INVALID", name)
    return result


def _canonical_source_path(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 512:
        raise ValidationError("POLICY_INVALID")
    normalized = unicodedata.normalize("NFC", value)
    if "\x00" in normalized or "\\" in normalized:
        raise ValidationError("POLICY_INVALID")
    for prefix in ("/data/source_images/", "data/source_images/", "source_images/"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix):]
            break
    path = Path(normalized)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValidationError("POLICY_INVALID")
    canonical = "data/source_images/" + path.as_posix()
    if len(canonical.encode("utf-8")) > 512:
        raise ValidationError("POLICY_INVALID")
    return canonical


def _quantity_bytes(value: str) -> int:
    match = re.fullmatch(r"([1-9][0-9]{0,8})(Gi|Ti)", value)
    if not match:
        raise ValidationError("SCHEMA_INVALID", "storage_size")
    return int(match.group(1)) * (1024**3 if match.group(2) == "Gi" else 1024**4)


@dataclass(frozen=True)
class Config:
    namespace: str
    state_config_map: str
    lease_name: str
    lease_seconds: int
    initialization_grace_seconds: int
    max_runtime_seconds: int
    stage_timeout_seconds: int
    retained_seconds: int
    cas_retries: int
    max_retained_runs: int
    max_child_resources: int
    max_jobs: int
    max_pvcs: int
    state_max_bytes: int

    @classmethod
    def parse(cls, raw: str | bytes) -> "Config":
        value = exact_object(
            parse_json(raw, max_bytes=16 * 1024),
            required={"schema_version", "namespace", "state_config_map", "lease_name", "lease_seconds", "initialization_grace_seconds", "max_runtime_seconds", "stage_timeout_seconds", "retained_seconds", "cas_retries", "max_retained_runs", "max_child_resources", "max_jobs", "max_pvcs", "state_max_bytes"},
        )
        if value["schema_version"] != 1:
            raise ValidationError("CONFIG_SCHEMA_UNSUPPORTED")
        return cls(
            bounded_string(value["namespace"], "namespace", 63, DNS_RE),
            bounded_string(value["state_config_map"], "state_config_map", 63, DNS_RE),
            bounded_string(value["lease_name"], "lease_name", 63, DNS_RE),
            integer(value["lease_seconds"], "lease_seconds", 10, 300),
            integer(value["initialization_grace_seconds"], "initialization_grace_seconds", 0, 300),
            integer(value["max_runtime_seconds"], "max_runtime_seconds", 60, 21600),
            integer(value["stage_timeout_seconds"], "stage_timeout_seconds", 30, 7200),
            integer(value["retained_seconds"], "retained_seconds", 3600, 172800),
            integer(value["cas_retries"], "cas_retries", 1, 20),
            integer(value["max_retained_runs"], "max_retained_runs", 0, 2),
            integer(value["max_child_resources"], "max_child_resources", 10, 64),
            integer(value["max_jobs"], "max_jobs", 4, 32),
            integer(value["max_pvcs"], "max_pvcs", 1, 8),
            integer(value["state_max_bytes"], "state_max_bytes", 65536, 512 * 1024),
        )


@dataclass(frozen=True)
class SourceProfile:
    profile_id: str
    profile_version: int
    source_cluster: str
    external_cluster: str
    database: str
    owner: str
    application_database: str
    server_name: str
    expected_system_identifier: str
    object_store: str
    postgresql_image: str
    postgresql_storage_size: str
    expected_database_inventory: tuple[dict[str, Any], ...]
    expected_static_role_inventory: tuple[dict[str, Any], ...]
    dynamic_role_prefixes: tuple[str, ...]
    expected_migration_version: str
    expected_row_counts: dict[str, int]
    expected_source_image_count: int
    synthetic_row: dict[str, str]
    controller_image: str
    backup_image: str
    source_container: str
    source_prefix: str
    sha256: str

    @property
    def storage_bytes(self) -> int:
        return _quantity_bytes(self.postgresql_storage_size)

    @property
    def image_allowlist(self) -> set[str]:
        return {self.controller_image, self.backup_image, self.postgresql_image}

    @classmethod
    def parse(cls, raw: str | bytes) -> "SourceProfile":
        required = {"schema_version", "profile_id", "profile_version", "provider", "source_cluster", "external_cluster", "database", "owner", "application_database", "server_name", "expected_system_identifier", "object_store", "object_store_api_version", "postgresql_major", "postgresql_image", "postgresql_storage_size", "expected_database_inventory", "expected_static_role_inventory", "dynamic_role_prefixes", "expected_migration_version", "expected_row_counts", "expected_source_image_count", "synthetic_row", "controller_image", "backup_image", "source_container", "source_prefix"}
        value = exact_object(parse_json(raw, max_bytes=64 * 1024), required=required)
        if value["schema_version"] != 1:
            raise ValidationError("PROFILE_SCHEMA_UNSUPPORTED")
        fixed = (value["provider"], value["source_cluster"], value["external_cluster"], value["database"], value["owner"], value["application_database"], value["server_name"], value["object_store"], value["object_store_api_version"], value["postgresql_major"])
        if fixed != ("cloudnative-pg", "pg-core", "pg-core-source", "app", "app", "hriv", "pg-core", "hriv-restore-validation-pg-core", "barmancloud.cnpg.io/v1", 17):
            raise ValidationError("PROFILE_NOT_APPROVED")
        images = [bounded_string(value[name], name, 512, IMAGE_RE) for name in ("postgresql_image", "controller_image", "backup_image")]
        databases = cls._databases(value["expected_database_inventory"])
        roles = cls._roles(value["expected_static_role_inventory"])
        row_counts = cls._row_counts(value["expected_row_counts"])
        synthetic = exact_object(value["synthetic_row"], required={"id", "email"})
        storage = bounded_string(value["postgresql_storage_size"], "postgresql_storage_size", 16)
        _quantity_bytes(storage)
        profile_digest = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        return cls(
            bounded_string(value["profile_id"], "profile_id", 128), integer(value["profile_version"], "profile_version", 1, 1000),
            "pg-core", "pg-core-source", "app", "app", "hriv", "pg-core",
            bounded_string(value["expected_system_identifier"], "expected_system_identifier", 32, re.compile(r"[1-9][0-9]{0,31}")),
            "hriv-restore-validation-pg-core", images[0], storage, databases, roles,
            _strings(value["dynamic_role_prefixes"], "dynamic_role_prefixes", 16),
            bounded_string(value["expected_migration_version"], "expected_migration_version", 128), row_counts,
            integer(value["expected_source_image_count"], "expected_source_image_count", 0, 10_000_000),
            {"id": bounded_string(synthetic["id"], "synthetic.id", 128), "email": bounded_string(synthetic["email"], "synthetic.email", 320)},
            images[1], images[2], bounded_string(value["source_container"], "source_container", 63, DNS_RE), bounded_string(value["source_prefix"], "source_prefix", 256), profile_digest,
        )

    @staticmethod
    def _databases(value: Any) -> tuple[dict[str, Any], ...]:
        if not isinstance(value, list) or not value or len(value) > 32:
            raise ValidationError("SCHEMA_INVALID", "expected_database_inventory")
        result = []
        for item in value:
            obj = exact_object(item, required={"name", "owner", "allow_connections"})
            if obj["allow_connections"] is not True:
                raise ValidationError("SCHEMA_INVALID", "allow_connections")
            result.append({"name": bounded_string(obj["name"], "database", 63, PG_NAME_RE), "owner": bounded_string(obj["owner"], "owner", 63, PG_NAME_RE), "allow_connections": obj["allow_connections"]})
        if len({item["name"] for item in result}) != len(result):
            raise ValidationError("SCHEMA_INVALID", "expected_database_inventory")
        return tuple(sorted(result, key=lambda item: item["name"]))

    @staticmethod
    def _roles(value: Any) -> tuple[dict[str, Any], ...]:
        if not isinstance(value, list) or not value or len(value) > 64:
            raise ValidationError("SCHEMA_INVALID", "expected_static_role_inventory")
        result = []
        for item in value:
            obj = exact_object(item, required={"name", "attributes", "memberships"})
            attrs = exact_object(obj["attributes"], required={"superuser", "inherit", "createrole", "createdb", "canlogin", "replication", "bypassrls"})
            if any(not isinstance(flag, bool) for flag in attrs.values()):
                raise ValidationError("SCHEMA_INVALID", "role.attributes")
            result.append({"name": bounded_string(obj["name"], "role", 63, PG_NAME_RE), "attributes": dict(sorted(attrs.items())), "memberships": [bounded_string(item, "membership", 63, PG_NAME_RE) for item in _strings(obj["memberships"], "memberships", 32)]})
        return tuple(sorted(result, key=lambda item: item["name"]))

    @staticmethod
    def _row_counts(value: Any) -> dict[str, int]:
        if not isinstance(value, dict) or not value or len(value) > 32:
            raise ValidationError("SCHEMA_INVALID", "expected_row_counts")
        return {bounded_string(name, "table", 63, IDENT_RE): integer(count, name, 0, 2**63 - 1) for name, count in sorted(value.items())}


@dataclass(frozen=True)
class SourcePolicy:
    policy_version: int
    missing_sources: tuple[dict[str, Any], ...]
    orphan_sources: tuple[dict[str, Any], ...]
    sha256: str

    @classmethod
    def parse(cls, raw: str | bytes) -> "SourcePolicy":
        value = exact_object(parse_json(raw, max_bytes=128 * 1024), required={"schema_version", "policy_version", "source_state", "sha256"})
        if value["schema_version"] != 1 or value["policy_version"] != 1:
            raise ValidationError("POLICY_SCHEMA_UNSUPPORTED")
        state = exact_object(value["source_state"], required={"missing_sources", "orphan_sources"})
        for name in ("missing_sources", "orphan_sources"):
            if not isinstance(state[name], list) or len(state[name]) > 256 or any(not isinstance(item, dict) for item in state[name]):
                raise ValidationError("POLICY_INVALID")
        missing = []
        for item in state["missing_sources"]:
            obj = exact_object(item, required={"row_id", "status", "stored_path", "reason"})
            if not isinstance(obj["row_id"], str) or re.fullmatch(r"[1-9][0-9]{0,18}", obj["row_id"]) is None or obj["reason"] not in {"missing_source", "unsafe_or_out_of_root", "duplicate_source_reference"}:
                raise ValidationError("POLICY_INVALID")
            status = obj["status"]
            if not isinstance(status, str) or len(status.encode("utf-8")) > 512:
                raise ValidationError("POLICY_INVALID")
            missing.append({"row_id": obj["row_id"], "status": unicodedata.normalize("NFC", status), "stored_path": _canonical_source_path(obj["stored_path"]), "reason": obj["reason"]})
        orphans = []
        for item in state["orphan_sources"]:
            obj = exact_object(item, required={"path", "reason", "policy"})
            if obj["reason"] != "no_database_row" or obj["policy"] != "quarantined_by_policy":
                raise ValidationError("POLICY_INVALID")
            orphans.append({"path": _canonical_source_path(obj["path"]), "reason": obj["reason"], "policy": obj["policy"]})
        if len({item["row_id"] for item in missing}) != len(missing) or len({item["path"] for item in orphans}) != len(orphans):
            raise ValidationError("POLICY_INVALID")
        missing.sort(key=lambda item: (int(item["row_id"]), item["status"], item["stored_path"], item["reason"]))
        orphans.sort(key=lambda item: (item["path"], item["reason"], item["policy"]))
        canonical_state = {"missing_sources": missing, "orphan_sources": orphans}
        canonical = json.dumps(canonical_state, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        digest = bounded_string(value["sha256"], "sha256", 64, re.compile(r"[0-9a-f]{64}"))
        if hashlib.sha256(canonical.encode()).hexdigest() != digest:
            raise ValidationError("POLICY_DIGEST_INVALID")
        return cls(1, tuple(missing), tuple(orphans), digest)

    def document(self) -> dict[str, Any]:
        return {"missing_sources": list(self.missing_sources), "orphan_sources": list(self.orphan_sources)}


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def _construct_mapping(loader: UniqueKeyLoader, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
    result: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValidationError("DUPLICATE_KEY", str(key))
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


@dataclass(frozen=True)
class Templates:
    selection_job: dict[str, Any]
    source_pvc: dict[str, Any]
    cnpg_cluster: dict[str, Any]
    db_validation_job: dict[str, Any]
    source_restore_job: dict[str, Any]
    consistency_job: dict[str, Any]

    @classmethod
    def parse(cls, raw: str | bytes, profile: SourceProfile) -> "Templates":
        allowed_images = profile.image_allowlist
        encoded = raw if isinstance(raw, bytes) else raw.encode()
        if len(encoded) > 192 * 1024:
            raise ValidationError("DOCUMENT_TOO_LARGE")
        try:
            value = yaml.load(encoded.decode(), Loader=UniqueKeyLoader)
        except (yaml.YAMLError, UnicodeDecodeError) as exc:
            raise ValidationError("TEMPLATE_INVALID") from exc
        obj = exact_object(value, required={"schema_version", "image_allowlist", "selection_job", "source_pvc", "cnpg_cluster", "db_validation_job", "source_restore_job", "consistency_job"})
        if obj["schema_version"] != 1 or set(_strings(obj["image_allowlist"], "image_allowlist", 8)) != allowed_images:
            raise ValidationError("TEMPLATE_IMAGE_ALLOWLIST_INVALID")
        templates = [obj[key] for key in ("selection_job", "source_pvc", "cnpg_cluster", "db_validation_job", "source_restore_job", "consistency_job")]
        if not all(isinstance(item, dict) for item in templates):
            raise ValidationError("TEMPLATE_INVALID")
        rendered = yaml.safe_dump(value)
        if "db.sql" in rendered or re.search(r"(?:targetTLI|targetLSN):\s*latest", rendered, re.I) or any(token in rendered for token in ("hostPath:", "hostNetwork:", "hostPID:", "privileged:")):
            raise ValidationError("TEMPLATE_FORBIDDEN")
        for item in templates:
            if item.get("metadata") != {}:
                raise ValidationError("TEMPLATE_METADATA_FORBIDDEN")
        for item in (obj["selection_job"], obj["db_validation_job"], obj["source_restore_job"], obj["consistency_job"]):
            cls._job(item, allowed_images)
        cls._references(obj, profile)
        pvc_spec = obj["source_pvc"].get("spec", {})
        pvc_size = pvc_spec.get("resources", {}).get("requests", {}).get("storage")
        if (
            not isinstance(pvc_size, str)
            or _quantity_bytes(pvc_size) < 40 * 1024**3
            or pvc_spec.get("accessModes") != ["ReadWriteOnce"]
            or pvc_spec.get("storageClassName") != "longhorn"
        ):
            raise ValidationError("TEMPLATE_PVC_INVALID")
        cluster = obj["cnpg_cluster"].get("spec", {})
        recovery = cluster.get("bootstrap", {}).get("recovery", {})
        target = recovery.get("recoveryTarget", {})
        external = cluster.get("externalClusters", [])
        if (
            cluster.get("imageName") not in allowed_images
            or cluster.get("storage")
            != {"size": profile.postgresql_storage_size, "storageClass": "longhorn"}
            or cluster.get("affinity")
            != {"nodeSelector": {"bcit.ca/longhorn-storage": "true"}}
            or recovery.get("source") != "pg-core-source"
            or recovery.get("database") != "app"
            or recovery.get("owner") != "app"
            or target
            != {
                "targetLSN": "CONTROLLER_BOUND_TARGET_LSN",
                "targetTLI": "CONTROLLER_BOUND_TARGET_TLI",
            }
            or external
            != [
                {
                    "name": "pg-core-source",
                    "plugin": {
                        "name": "barman-cloud.cloudnative-pg.io",
                        "parameters": {
                            "barmanObjectName": "hriv-restore-validation-pg-core",
                            "serverName": "pg-core",
                        },
                    },
                }
            ]
        ):
            raise ValidationError("TEMPLATE_INVALID")
        return cls(*templates)

    @staticmethod
    def _job(item: dict[str, Any], allowed_images: set[str]) -> None:
        spec = item.get("spec", {})
        pod = spec.get("template", {}).get("spec", {})
        if item.get("apiVersion") != "batch/v1" or item.get("kind") != "Job" or spec.get("backoffLimit") != 0 or "ttlSecondsAfterFinished" in spec or pod.get("restartPolicy") != "Never" or pod.get("serviceAccountName") != NO_PERMISSION_SA or pod.get("automountServiceAccountToken") is not False or spec.get("template", {}).get("metadata") != {}:
            raise ValidationError("TEMPLATE_JOB_INVALID")
        containers = pod.get("containers")
        if not isinstance(containers, list) or len(containers) != 1 or containers[0].get("image") not in allowed_images:
            raise ValidationError("TEMPLATE_IMAGE_UNPINNED")
        container = containers[0]
        security = container.get("securityContext", {})
        drops = security.get("capabilities", {}).get("drop", [])
        volumes = {volume.get("name"): volume for volume in pod.get("volumes", []) if isinstance(volume, dict)}
        mounts = {mount.get("name"): mount for mount in container.get("volumeMounts", []) if isinstance(mount, dict)}
        pod_security = pod.get("securityContext", {})
        tmp_volume = volumes.get("tmp", {})
        empty_dir = tmp_volume.get("emptyDir") if isinstance(tmp_volume, dict) else None
        valid_empty_dir = isinstance(empty_dir, dict) and set(empty_dir) <= {"sizeLimit"}
        if valid_empty_dir and "sizeLimit" in empty_dir:
            size_limit = empty_dir["sizeLimit"]
            match = re.fullmatch(r"([1-9][0-9]{0,8})(Ki|Mi|Gi)", size_limit) if isinstance(size_limit, str) else None
            valid_empty_dir = match is not None and int(match.group(1)) * {"Ki": 1024, "Mi": 1024**2, "Gi": 1024**3}[match.group(2)] <= 1024**3
        if pod_security.get("runAsNonRoot") is not True or pod_security.get("seccompProfile") != {"type": "RuntimeDefault"} or any(pod.get(name) for name in ("hostNetwork", "hostPID", "hostIPC")) or security.get("allowPrivilegeEscalation") is not False or security.get("readOnlyRootFilesystem") is not True or security.get("privileged") is True or drops != ["ALL"] or "hostPath" in yaml.safe_dump(pod) or set(tmp_volume) != {"name", "emptyDir"} or tmp_volume.get("name") != "tmp" or not valid_empty_dir or mounts.get("tmp", {}).get("mountPath") != "/tmp" or mounts.get("tmp", {}).get("readOnly") is True:
            raise ValidationError("TEMPLATE_SECURITY_INVALID")

    @staticmethod
    def _references(obj: dict[str, Any], profile: SourceProfile) -> None:
        def pod(name: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
            spec = obj[name]["spec"]["template"]["spec"]
            return spec["containers"][0], {item["name"]: item for item in spec.get("volumes", [])}
        selection, selection_volumes = pod("selection_job")
        restore, restore_volumes = pod("source_restore_job")
        database, database_volumes = pod("db_validation_job")
        consistency, consistency_volumes = pod("consistency_job")
        expected_volume_names = {
            "selection": {"tmp"},
            "restore": {"tmp", "source"},
            "database": {"tmp", "credentials", "profile"},
            "consistency": {"tmp", "credentials", "profile", "policy", "source"},
        }
        for name, volumes in (("selection", selection_volumes), ("restore", restore_volumes), ("database", database_volumes), ("consistency", consistency_volumes)):
            if set(volumes) != expected_volume_names[name]:
                raise ValidationError("TEMPLATE_REFERENCE_INVALID")
        for container, command in ((selection, "validation-select"), (restore, "restore-filesystem-stateless"), (database, "validate-database"), (consistency, "validate-consistency")):
            if "command" in container or container.get("args") != [command]:
                raise ValidationError("TEMPLATE_COMMAND_INVALID")
        expected_env = {
            "CNPG_CLUSTER_NAME": {"name": "CNPG_CLUSTER_NAME", "value": profile.source_cluster},
            "AZURE_STORAGE_CONTAINER": {"name": "AZURE_STORAGE_CONTAINER", "value": profile.source_container},
            "AZURE_BLOB_PREFIX": {"name": "AZURE_BLOB_PREFIX", "value": profile.source_prefix},
            "AZURE_READ_SAS_URL": {"name": "AZURE_READ_SAS_URL", "valueFrom": {"secretKeyRef": {"name": AZURE_SECRET, "key": "azureReadSasUrl"}}},
            "HOME": {"name": "HOME", "value": "/tmp"},
            "TMPDIR": {"name": "TMPDIR", "value": "/tmp"},
            "PYTHONDONTWRITEBYTECODE": {"name": "PYTHONDONTWRITEBYTECODE", "value": "1"},
        }
        for container in (selection, restore):
            entries = container.get("env", [])
            env = {item.get("name"): item for item in entries if isinstance(item, dict)}
            if len(entries) != len(expected_env) or env != expected_env or "envFrom" in container:
                raise ValidationError("TEMPLATE_SECRET_INVALID")
        if database.get("env", []) or consistency.get("env", []) or "envFrom" in database or "envFrom" in consistency:
            raise ValidationError("TEMPLATE_REFERENCE_INVALID")
        if restore_volumes.get("source", {}).get("persistentVolumeClaim", {}).get("claimName") != "generated-source-pvc" or consistency_volumes.get("source", {}).get("persistentVolumeClaim", {}).get("claimName") != "generated-source-pvc":
            raise ValidationError("TEMPLATE_PVC_REFERENCE_INVALID")
        if database_volumes.get("credentials", {}).get("secret", {}).get("secretName") != "generated-superuser" or consistency_volumes.get("credentials", {}).get("secret", {}).get("secretName") != "generated-superuser":
            raise ValidationError("TEMPLATE_SECRET_INVALID")
        expected_maps = {"profile": "hriv-restore-validation-source-profile-v1", "policy": "hriv-restore-validation-source-state-policy-v1"}
        if database_volumes.get("profile", {}).get("configMap", {}).get("name") != expected_maps["profile"] or consistency_volumes.get("profile", {}).get("configMap", {}).get("name") != expected_maps["profile"] or consistency_volumes.get("policy", {}).get("configMap", {}).get("name") != expected_maps["policy"]:
            raise ValidationError("TEMPLATE_CONFIG_REFERENCE_INVALID")
        tmp = {"name": "tmp", "mountPath": "/tmp"}
        credentials = {"name": "credentials", "mountPath": "/credentials", "readOnly": True}
        profile = {"name": "profile", "mountPath": "/etc/hriv/profile.json", "readOnly": True, "subPath": "profile.json"}
        policy = {"name": "policy", "mountPath": "/etc/hriv/policy.json", "readOnly": True, "subPath": "policy.json"}
        source_write = {"name": "source", "mountPath": "/restore", "readOnly": False}
        source_read = {"name": "source", "mountPath": "/restore", "readOnly": True}
        expected_mounts = {
            "selection": [tmp],
            "restore": [tmp, source_write],
            "database": [tmp, credentials, profile],
            "consistency": [tmp, credentials, profile, policy, source_read],
        }
        for name, container in (("selection", selection), ("restore", restore), ("database", database), ("consistency", consistency)):
            mounts = container.get("volumeMounts", [])
            if not isinstance(mounts, list) or sorted(mounts, key=lambda item: item.get("name", "")) != sorted(expected_mounts[name], key=lambda item: item["name"]):
                raise ValidationError("TEMPLATE_MOUNT_INVALID")


@dataclass(frozen=True)
class Trigger:
    trigger: str
    job_name: str
    job_uid: str
    pod_uid: str | None = None


@dataclass(frozen=True)
class ResourceRef:
    api_version: str
    kind: str
    name: str
    uid: str

    def document(self) -> dict[str, str]:
        return {"apiVersion": self.api_version, "kind": self.kind, "name": self.name, "uid": self.uid}
