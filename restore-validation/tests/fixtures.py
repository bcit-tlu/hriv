from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from hriv_restore_validation.gateway import FakeGateway
from hriv_restore_validation.models import Config, SourcePolicy, SourceProfile, Templates, Trigger

NOW = datetime(2026, 1, 15, 10, 0, tzinfo=timezone.utc)
RUN = "rv-20260115t100000z-a1b2c3d4"
TRIGGER = Trigger("on_demand", "orchestrator", "job-uid", "pod-uid")
DIGEST = "a" * 64
CONTROLLER_IMAGE = f"registry/controller@sha256:{DIGEST}"
BACKUP_IMAGE = f"registry/backup@sha256:{'b' * 64}"
POSTGRES_IMAGE = f"registry/postgres:17@sha256:{'c' * 64}"
ROLE_ATTRS = {"superuser": False, "inherit": True, "createrole": False, "createdb": False, "canlogin": True, "replication": False, "bypassrls": False}


def config(**changes: Any) -> Config:
    values = dict(namespace="hriv-restore-validation", state_config_map="hriv-restore-validation-state", lease_name="hriv-restore-validation", lease_seconds=30, initialization_grace_seconds=60, max_runtime_seconds=21600, stage_timeout_seconds=7200, retained_seconds=86400, cas_retries=8, max_retained_runs=2, max_child_resources=16, max_jobs=32, max_pvcs=8, state_max_bytes=524288)
    values.update(changes)
    return Config(**values)


def profile_document(**changes: Any) -> dict[str, Any]:
    value = {"schema_version": 1, "profile_id": "production-pg-core", "profile_version": 1, "provider": "cloudnative-pg", "source_cluster": "pg-core", "external_cluster": "pg-core-source", "database": "app", "owner": "app", "application_database": "hriv", "server_name": "pg-core", "expected_system_identifier": "777777", "object_store": "hriv-restore-validation-pg-core", "object_store_api_version": "barmancloud.cnpg.io/v1", "postgresql_major": 17, "postgresql_image": POSTGRES_IMAGE, "postgresql_storage_size": "40Gi", "required_database_inventory": [{"name": "app", "owner": "app", "allow_connections": True}, {"name": "hriv", "owner": "app", "allow_connections": True}], "required_static_role_inventory": [{"name": "app", "attributes": ROLE_ATTRS, "memberships": []}], "dynamic_role_prefixes": ["v-"], "expected_migration_version": "abc123", "minimum_row_counts": {"categories": 1, "images": 1, "source_images": 2, "users": 1}, "synthetic_row": {"id": "1", "email_sha256": "faa296d58b7dcae9eec26d1991a5e3cc322ea91f0e668c0a720642817d7b0469"}, "controller_image": CONTROLLER_IMAGE, "backup_image": BACKUP_IMAGE, "source_container": "recovery", "source_prefix": "hriv-backups"}
    value = copy.deepcopy(value)
    value.update(changes)
    return value


def profile() -> SourceProfile:
    return SourceProfile.parse(json.dumps(profile_document()))


def policy_document(missing_count: int = 0, orphan_count: int = 0, sha256: str | None = None) -> dict[str, Any]:
    empty_state = {"missing_sources": [], "orphan_sources": []}
    digest = sha256 or hashlib.sha256(json.dumps(empty_state, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"policy_version": 1, "source_state_sha256": digest, "missing_count": missing_count, "orphan_count": orphan_count}


def policy() -> SourcePolicy:
    return SourcePolicy.parse(json.dumps(policy_document()))


def template_document() -> dict[str, Any]:
    def job(image: str, role: str) -> dict[str, Any]:
        volumes = [{"name": "tmp", "emptyDir": {}}]
        command = {"selection": "validation-select", "db": "validate-database", "restore": "restore-filesystem-stateless", "consistency": "validate-consistency"}[role]
        env = []
        if role in {"selection", "restore"}:
            env.extend([
                {"name": "CNPG_CLUSTER_NAME", "value": "pg-core"},
                {"name": "AZURE_STORAGE_CONTAINER", "value": "recovery"},
                {"name": "AZURE_BLOB_PREFIX", "value": "hriv-backups"},
                {"name": "AZURE_READ_SAS_URL", "valueFrom": {"secretKeyRef": {"name": "hriv-restore-validation-azure-read", "key": "azureReadSasUrl"}}},
                {"name": "HOME", "value": "/tmp"},
                {"name": "TMPDIR", "value": "/tmp"},
                {"name": "PYTHONDONTWRITEBYTECODE", "value": "1"},
                {"name": "HTTPS_PROXY", "value": "http://hriv-restore-validation-egress-proxy:10000"},
                {"name": "NO_PROXY", "value": ".svc,.cluster.local,10.43.0.1,localhost,127.0.0.1"},
            ])
        if role in {"db", "consistency"}:
            volumes.extend([{"name": "credentials", "secret": {"secretName": "generated-superuser"}}, {"name": "profile", "configMap": {"name": "hriv-restore-validation-source-profile-v6"}}])
        if role == "consistency":
            volumes.append({"name": "policy", "configMap": {"name": "hriv-restore-validation-source-state-policy-v6"}})
        if role in {"restore", "consistency"}:
            volumes.append({"name": "source", "persistentVolumeClaim": {"claimName": "generated-source-pvc"}})
        mounts = [{"name": "tmp", "mountPath": "/tmp"}]
        mount_paths = {"credentials": "/credentials", "profile": "/etc/hriv/profile.json", "policy": "/etc/hriv/policy.json", "source": "/restore"}
        for item in volumes:
            if item["name"] == "tmp": continue
            mount = {"name": item["name"], "mountPath": mount_paths[item["name"]], "readOnly": item["name"] != "source" or role == "consistency"}
            if item["name"] in {"profile", "policy"}: mount["subPath"] = item["name"] + ".json"
            mounts.append(mount)
        return {"apiVersion": "batch/v1", "kind": "Job", "metadata": {}, "spec": {"backoffLimit": 0, "template": {"metadata": {}, "spec": {"serviceAccountName": "hriv-restore-validation-no-permission", "automountServiceAccountToken": False, "restartPolicy": "Never", "securityContext": {"runAsNonRoot": True, "seccompProfile": {"type": "RuntimeDefault"}}, "containers": [{"name": role, "image": image, "args": [command], "env": env, "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}}, "volumeMounts": mounts}], "volumes": volumes}}}}
    return {"schema_version": 1, "image_allowlist": [CONTROLLER_IMAGE, BACKUP_IMAGE, POSTGRES_IMAGE], "selection_job": job(BACKUP_IMAGE, "selection"), "source_pvc": {"apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": {}, "spec": {"accessModes": ["ReadWriteOnce"], "storageClassName": "longhorn", "resources": {"requests": {"storage": "40Gi"}}}}, "cnpg_cluster": {"apiVersion": "postgresql.cnpg.io/v1", "kind": "Cluster", "metadata": {}, "spec": {"imageName": POSTGRES_IMAGE, "bootstrap": {"recovery": {"source": "pg-core-source", "database": "app", "owner": "app", "recoveryTarget": {"targetLSN": "CONTROLLER_BOUND_TARGET_LSN", "targetTLI": "CONTROLLER_BOUND_TARGET_TLI"}}}, "externalClusters": [{"name": "pg-core-source", "plugin": {"name": "barman-cloud.cloudnative-pg.io", "parameters": {"barmanObjectName": "hriv-restore-validation-pg-core", "serverName": "pg-core"}}}], "storage": {"size": "40Gi", "storageClass": "longhorn"}, "affinity": {"nodeSelector": {"bcit.ca/longhorn-storage": "true"}}}}, "db_validation_job": job(CONTROLLER_IMAGE, "db"), "source_restore_job": job(BACKUP_IMAGE, "restore"), "consistency_job": job(CONTROLLER_IMAGE, "consistency")}


def templates() -> Templates:
    import yaml
    return Templates.parse(yaml.safe_dump(template_document()), profile())


def selection_document(**changes: Any) -> dict[str, Any]:
    value = {"schema_version": 1, "operation": "validation-select", "success": True, "snapshot_name": "hriv-backup-20260115-090000-abcdef12", "recovery_set_id": "set-1", "run_id": "backup-run", "manifest_sha256": "d" * 64, "archive_blob": "archive.tar.gz", "archive_size": 10, "archive_etag": "etag", "target_lsn": "A/1234", "target_timeline": 7, "source_file_count": 2, "source_total_bytes": 10, "source_files_sha256": "e" * 64, "database_row_count": 2, "missing_count": 0, "orphan_count": 0, "exclusion_count": 0, "source_state": {"missing_sources": [], "orphan_sources": []}, "source_state_sha256": policy().source_state_sha256, "excluded_artifacts": [], "capture_started_at": "2026-01-15T09:00:00Z", "wal_fence_file": "000000070000000000000001", "wal_fence_committed_at": "2026-01-15T09:01:00Z", "wal_fence_archived_at": "2026-01-15T09:02:00Z", "completed_at": "2026-01-15T09:30:00Z"}
    value.update(changes)
    return value


def database_result(**changes: Any) -> dict[str, Any]:
    p = profile()
    value = {"schema_version": 1, "operation": "validate-database", "success": True, "system_identifier": p.expected_system_identifier, "timeline": 7, "recovery_complete": True, "required_database_inventory": [dict(item) for item in p.required_database_inventory], "required_static_role_inventory": [dict(item) for item in p.required_static_role_inventory], "migration_version": p.expected_migration_version, "observed_row_counts": p.minimum_row_counts, "source_image_count": 2, "synthetic_row": p.synthetic_row, "current_lsn": "A/1234", "target_lsn": "A/1234", "fence_generation": 9, "fence_fenced_at": "2026-01-15T09:00:30Z"}
    value.update(changes)
    return value


def restore_result(**changes: Any) -> dict[str, Any]:
    value = selection_document(operation="restore-filesystem-stateless") | {"target_data_dir": "/restore/data", "restored_file_count": 2, "restored_total_bytes": 10, "selection_duration_seconds": 1.0, "restore_duration_seconds": 2.0, "duration_seconds": 3.0, "outcome": "restored"}
    value.update(changes)
    return value


def consistency_result(**changes: Any) -> dict[str, Any]:
    missing = []
    missing_digest = hashlib.sha256(json.dumps(missing, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    value = {"schema_version": 1, "operation": "validate-consistency", "success": True, "database_source_count": 2, "restored_file_count": 2, "restored_total_bytes": 10, "source_files_sha256": "e" * 64, "missing_count": len(missing), "missing_sources_sha256": missing_digest, "unexpected_orphan_count": 0, "source_state_policy_sha256": policy().identity_sha256}
    value.update(changes)
    return value


def gateway() -> FakeGateway:
    fake = FakeGateway()
    fake.results = {"selection": json.dumps(selection_document()), "db-validation": json.dumps(database_result()), "source-restore": json.dumps(restore_result()), "consistency": json.dumps(consistency_result())}
    return fake


def controller(fake: FakeGateway, **config_changes: Any):
    from hriv_restore_validation.controller import Controller
    return Controller(fake, config(**config_changes), profile(), policy(), templates(), clock=lambda: NOW)


def drive(instance: Any, limit: int = 30) -> str:
    outcome = "running"
    for _ in range(limit):
        outcome = instance.run(TRIGGER, RUN)
        if outcome != "running":
            return outcome
    return outcome
