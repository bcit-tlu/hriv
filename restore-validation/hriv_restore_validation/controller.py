from __future__ import annotations

import copy
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .gateway import Gateway, Lease, TEMPLATE_IDENTITY_ANNOTATION, template_identity
from .models import Config, ResourceRef, SourcePolicy, SourceProfile, Templates, Trigger, _quantity_bytes
from .state import StateStore, merge_history, utc
from .strict import LSN_RE, RFC3339_RE, UID_RE, ValidationError, bounded_string, exact_object, integer, parse_json

MANAGED_BY = "hriv-restore-validation"
RUN_LABEL = "hriv.bcit.ca/restore-validation-run-id"
ROLE_LABEL = "hriv.bcit.ca/restore-validation-role"
SELECTION_FIELDS = {"schema_version", "operation", "success", "snapshot_name", "recovery_set_id", "run_id", "manifest_sha256", "archive_blob", "archive_size", "archive_etag", "target_lsn", "target_timeline", "source_file_count", "source_total_bytes", "source_files_sha256", "database_row_count", "missing_count", "orphan_count", "exclusion_count", "source_state", "source_state_sha256", "excluded_artifacts", "capture_started_at", "wal_fence_file", "wal_fence_committed_at", "wal_fence_archived_at", "completed_at"}
SELECTED_SOURCE_FIELDS = {
    "selection_schema_version", "selection_operation", "backup_run_id", "snapshot_name", "recovery_set_id",
    "manifest_sha256", "archive_blob", "archive_size", "archive_etag", "completed_at", "target_lsn",
    "target_timeline", "source_file_count", "source_total_bytes", "source_files_sha256", "database_row_count", "missing_count",
    "orphan_count", "exclusion_count", "source_state", "source_state_sha256", "excluded_artifacts",
    "capture_started_at", "wal_fence_file", "wal_fence_committed_at", "wal_fence_archived_at",
    "source_profile_id", "source_profile_version", "source_profile_sha256", "source_state_policy_version",
    "source_state_policy_sha256", "database", "owner", "expected_system_identifier", "server_name",
    "external_cluster", "object_store",
}
SHA256_RE = re.compile(r"[0-9a-f]{64}")
SNAPSHOT_RE = re.compile(r"hriv-backup-\d{8}-\d{6}(?:-[0-9a-f]{8})?")
ETAG_TOKEN_RE = re.compile(r"[A-Za-z0-9._:-]{1,128}")
LOCAL_FAILURE_CODES = {
    "ARGUMENTS_INVALID", "DATABASE_CREDENTIAL_INVALID", "DATABASE_FIDELITY_MISMATCH",
    "DATABASE_RESULT_INVALID", "INTERNAL_FAILURE", "RECOVERY_TARGET_INVALID",
    "RESULT_TOO_LARGE", "SOURCE_DUPLICATE_PATH", "SOURCE_PATH_INVALID",
    "SOURCE_POLICY_MISMATCH", "SOURCE_ROOT_INVALID", "SOURCE_SYMLINK_FORBIDDEN",
    "TIMESTAMP_INVALID", "VALIDATION_FAILED",
}
BACKUP_FAILURE_CODES = {
    "ARGUMENTS_INVALID", "AZURE_AUTH_FAILED", "AZURE_READ_FAILED", "INTERNAL_FAILURE",
    "ARCHIVE_COMPONENT_INVALID", "ARCHIVE_FILE_MISMATCH", "ARCHIVE_MEMBER_DUPLICATE",
    "ARCHIVE_MEMBER_INVALID", "ARCHIVE_MEMBER_UNSAFE", "ARCHIVE_MISSING",
    "ARCHIVE_NOT_PUBLISHED", "ARCHIVE_PREFIX_INVALID", "ARCHIVE_PROPERTIES_INVALID",
    "ARCHIVE_ROOT_MISMATCH", "ARCHIVE_SIZE_MISMATCH", "ARCHIVE_STREAM_INVALID",
    "COMPONENT_INCOHERENT", "CNPG_METADATA_INVALID", "EMBEDDED_MANIFEST_MISMATCH",
    "EXCLUDED_ARTIFACT_UNAPPROVED", "MANIFEST_COMPONENT_INVALID", "MANIFEST_DIGEST_MISMATCH",
    "MANIFEST_IDENTITY_INVALID", "MANIFEST_INVALID", "MANIFEST_NOT_PRODUCTION",
    "MANIFEST_SELECTION_INVALID", "MANIFEST_TIMESTAMP_INVALID", "MANIFEST_VERSION_UNSUPPORTED",
    "MARKER_INVALID", "MARKER_MISSING", "MARKER_TOO_LARGE", "PUBLICATION_INCOMPLETE", "READ_SAS_EXPIRED",
    "READ_SAS_EXPIRING", "READ_SAS_FIELDS_INVALID", "READ_SAS_MALFORMED", "READ_SAS_MISSING",
    "READ_SAS_NOT_YET_VALID", "READ_SAS_PERMISSIONS_INVALID", "READ_SAS_SCOPE_INVALID",
    "READ_SAS_START_INVALID", "RECOVERY_SET_ID_MISMATCH", "RECOVERY_SET_INCOHERENT",
    "SIDECAR_INVALID", "SIDECAR_MISSING", "SIDECAR_SIZE_MISMATCH", "SIDECAR_TOO_LARGE", "SNAPSHOT_MISMATCH",
    "SOURCE_CHANGED", "SOURCE_COUNTS_INVALID", "SOURCE_INDEX_INVALID", "SOURCE_STATE_DIGEST_INVALID",
    "STATE_DOCUMENT_INVALID", "STATE_MISSING", "STATE_TOO_LARGE", "TARGET_CHANGED", "TARGET_LSN_INVALID",
    "TARGET_NOT_EMPTY", "TARGET_PARENT_INVALID", "TARGET_UNSAFE", "VALIDATION_CONFIG_INVALID",
    "VALIDATION_NOT_ACCEPTED", "WAL_FENCE_TIMESTAMP_INVALID", "WAL_FENCE_UNSUPPORTED",
}
FAILURE_CODE_ALLOWLIST = {
    "selection": BACKUP_FAILURE_CODES,
    "source-restore": BACKUP_FAILURE_CODES,
    "db-validation": LOCAL_FAILURE_CODES,
    "consistency": LOCAL_FAILURE_CODES,
}


def make_run_id(now: datetime, suffix: str | None = None) -> str:
    suffix = suffix or secrets.token_hex(4)
    if re.fullmatch(r"[0-9a-f]{8}", suffix) is None:
        raise ValidationError("RUN_ID_INVALID")
    return f"rv-{now.astimezone(timezone.utc).strftime('%Y%m%dt%H%M%Sz').lower()}-{suffix}"


def child_name(run_id: str, role: str) -> str:
    suffix = run_id.rsplit("-", 1)[-1]
    names = {"selection": "select", "source-pvc": "source", "cnpg": "pg", "db-validation": "db-check", "source-restore": "source-restore", "consistency": "consistency"}
    return f"rv-{suffix}-{names[role]}"


def normalize_lease_time(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValidationError("LEASE_TIMESTAMP_INVALID")
    return value.astimezone(timezone.utc).replace(microsecond=0)


def holder_identity(job_uid: str, run_id: str, acquired: datetime, renewed: datetime) -> str:
    return f"v1|{job_uid}|{run_id}|{utc(normalize_lease_time(acquired))}|{utc(normalize_lease_time(renewed))}"


def parse_holder(value: str) -> tuple[str, str, datetime, datetime]:
    parts = value.split("|")
    if len(parts) != 5 or parts[0] != "v1" or UID_RE.fullmatch(parts[1]) is None or re.fullmatch(r"rv-\d{8}t\d{6}z-[0-9a-f]{8}", parts[2]) is None:
        raise ValidationError("LEASE_IDENTITY_INVALID")
    if RFC3339_RE.fullmatch(parts[3]) is None or RFC3339_RE.fullmatch(parts[4]) is None:
        raise ValidationError("LEASE_IDENTITY_INVALID")
    return parts[1], parts[2], _date(parts[3]), _date(parts[4])


def _date(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _strict_utc(value: Any, name: str) -> tuple[str, datetime]:
    text = bounded_string(value, name, 32, RFC3339_RE)
    parsed = _date(text)
    if parsed.utcoffset() != timedelta(0):
        raise ValidationError("TIMESTAMP_INVALID")
    canonical = parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if canonical != text:
        raise ValidationError("TIMESTAMP_INVALID")
    return canonical, parsed


class Controller:
    def __init__(self, gateway: Gateway, config: Config, profile: SourceProfile, policy: SourcePolicy, templates: Templates, *, clock: Callable[[], datetime] | None = None) -> None:
        self.gateway, self.config, self.profile, self.policy, self.templates = gateway, config, profile, policy, templates
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.store = StateStore(gateway, config.state_config_map, config.cas_retries, self.clock, config.state_max_bytes)

    def run(self, trigger: Trigger, run_id: str) -> str:
        now = normalize_lease_time(self.clock())
        trigger_id = f"trigger-{run_id[3:19]}-{hashlib.sha256(trigger.job_uid.encode()).hexdigest()[:8]}"
        state, _ = self.store.read()
        if state["active_run"] and state["active_run"]["run_id"] == run_id and state["active_run"]["job_uid"] == trigger.job_uid:
            self._verify_lease(trigger, run_id)
            return self._reconcile(trigger, run_id)
        if not self._acquire(trigger, run_id, trigger_id, now):
            return "rejected"
        try:
            self._initialize(trigger, run_id, trigger_id, now)
        except Exception:
            self._release(trigger, run_id)
            raise
        return self._reconcile(trigger, run_id)

    def _acquire(self, trigger: Trigger, run_id: str, trigger_id: str, now: datetime) -> bool:
        lease = self.gateway.read_lease(self.config.lease_name)
        if lease.holder_identity:
            try:
                uid, held_run, acquired, renewed = parse_holder(lease.holder_identity)
            except ValidationError:
                return self._reject(trigger, trigger_id, now, "OVERLAP_ACTIVE")
            if lease.acquire_time is None or lease.renew_time is None or normalize_lease_time(lease.acquire_time) != acquired or normalize_lease_time(lease.renew_time) != renewed or not lease.duration_seconds:
                return self._reject(trigger, trigger_id, now, "OVERLAP_ACTIVE")
            state, _ = self.store.read()
            latest = state["latest_run"]
            terminal = latest and latest.get("run_id") == held_run and latest.get("state") in {"SUCCEEDED", "FAILED_RETAIN"}
            expired = now > renewed + timedelta(seconds=lease.duration_seconds)
            if terminal:
                retained = any(item["run_id"] == held_run for item in state["retained_runs"])
                if (latest["state"] == "FAILED_RETAIN" and (not retained or not self._ownership_intact(latest))) or (latest["state"] == "SUCCEEDED" and self.gateway.list_run_children(held_run)):
                    return self._reject(trigger, trigger_id, now, "OVERLAP_ACTIVE")
                self.gateway.replace_lease(self.config.lease_name, Lease(lease.resource_version, None, None, None, None))
            elif latest is None:
                if (uid, held_run) == (trigger.job_uid, run_id) and not self.gateway.list_run_children(held_run):
                    return True
                if not expired or now <= renewed + timedelta(seconds=lease.duration_seconds + self.config.initialization_grace_seconds):
                    return self._reject(trigger, trigger_id, now, "OVERLAP_ACTIVE")
                if self.gateway.holder_job_status("", uid) not in {"absent", "terminal"} or self.gateway.list_run_children(held_run):
                    return self._reject(trigger, trigger_id, now, "OVERLAP_ACTIVE")
                self._reject(Trigger("recovered", "", uid), f"trigger-{held_run[3:19]}-{hashlib.sha256(uid.encode()).hexdigest()[:8]}", now, "LEASE_STATE_INITIALIZATION_LOST")
            else:
                started = _date(latest["started_at"])
                if not expired or now <= started + timedelta(seconds=self.config.max_runtime_seconds) or self.gateway.holder_job_status(latest["job_name"], uid) not in {"absent", "terminal"} or not self._ownership_intact(latest):
                    return self._reject(trigger, trigger_id, now, "OVERLAP_ACTIVE")
                self._retain(held_run, "INTERRUPTED_STALE_HOLDER", latest["current_stage"])
                self._clear_active(held_run, uid)
            lease = self.gateway.read_lease(self.config.lease_name)
        try:
            self.gateway.replace_lease(self.config.lease_name, Lease(lease.resource_version, holder_identity(trigger.job_uid, run_id, now, now), now, now, self.config.lease_seconds))
            return True
        except self.gateway.conflict_error:
            return self._reject(trigger, trigger_id, now, "OVERLAP_ACTIVE")

    def _reject(self, trigger: Trigger, trigger_id: str, now: datetime, code: str) -> bool:
        self.store.trigger_only({"entry_kind": "rejected_trigger", "trigger_id": trigger_id, "trigger": trigger.trigger, "outcome": "rejected", "failure_code": code, "started_at": utc(now), "completed_at": utc(now)})
        return False

    def _initialize(self, trigger: Trigger, run_id: str, trigger_id: str, now: datetime) -> None:
        def mutate(state: dict[str, Any]) -> None:
            if state["active_run"] is not None or len(state["retained_runs"]) >= self.config.max_retained_runs:
                raise ValidationError("RETAINED_RUN_LIMIT")
            run = {"run_id": run_id, "trigger": trigger.trigger, "job_name": trigger.job_name, "job_uid": trigger.job_uid, "state": "SELECT", "current_stage": "SELECT", "sequence": 1, "started_at": utc(now), "heartbeat_at": utc(now), "selected_source": None, "child_resources": [], "stages": {"SELECT": {"outcome": "running", "started_at": utc(now)}}, "outcome": "running", "failure_stage": None, "failure_code": None, "cleanup": {"outcome": "pending", "requested_at": None, "completed_at": None, "remaining_resource_count": 0, "failure_code": None}, "core_succeeded": None, "orchestrator_evidence": {"job_name": trigger.job_name, "job_uid": trigger.job_uid, "pod_uid": trigger.pod_uid}}
            state["latest_run"] = run
            state["active_run"] = self._summary(run)
            state["attempt_history"] = merge_history(state["attempt_history"], [{"entry_kind": "accepted_run", "run_id": run_id, "trigger": trigger.trigger, "state": "SELECT", "outcome": "running", "failure_stage": None, "failure_code": None, "cleanup_outcome": "pending", "remaining_resource_count": 0, "started_at": utc(now), "completed_at": None}])
            state["latest_trigger"] = {"trigger_id": trigger_id, "trigger": trigger.trigger, "outcome": "accepted", "failure_code": None, "started_at": utc(now), "completed_at": utc(now)}
        self.store.update(mutate)

    def _reconcile(self, trigger: Trigger, run_id: str) -> str:
        state, _ = self.store.read()
        run = state["latest_run"]
        if not run or run["run_id"] != run_id or run["job_uid"] != trigger.job_uid:
            raise ValidationError("STATE_OWNERSHIP_INVALID")
        try:
            if run["selected_source"] is not None:
                self._validate_selected_source(run["selected_source"])
            if run["state"] in {"SUCCEEDED", "FAILED_RETAIN"}:
                return self._finish_terminal(trigger, run_id, run["outcome"])
            if self.clock() > _date(run["started_at"]) + timedelta(seconds=self.config.max_runtime_seconds):
                self._retain(run_id, "MAX_RUNTIME_EXCEEDED", run["current_stage"])
                return self._finish_terminal(trigger, run_id, "retained")
            stage_entry = run["stages"].get(run["current_stage"], {})
            if stage_entry.get("started_at") and self.clock() > _date(stage_entry["started_at"]) + timedelta(seconds=self.config.stage_timeout_seconds):
                self._retain(run_id, "STAGE_TIMEOUT", run["current_stage"])
                return self._finish_terminal(trigger, run_id, "retained")
            return self._execute_stage(trigger, run_id, run)
        except ValidationError as exc:
            self._retain(run_id, exc.code, run["current_stage"])
            return self._finish_terminal(trigger, run_id, "retained")
        except Exception:
            # Unexpected implementation/API failures have one stable public code. Never
            # persist or print exception text, which may contain URLs or credentials.
            current_refs = self._current_child_ownership(run_id)
            self._retain(run_id, "INTERNAL_ERROR", run["current_stage"], current_refs)
            return self._finish_terminal(trigger, run_id, "retained")

    def _execute_stage(self, trigger: Trigger, run_id: str, run: dict[str, Any]) -> str:
        stage = run["current_stage"]
        if stage == "SELECT":
            if run["selected_source"] is None:
                manifest = copy.deepcopy(self.templates.selection_job)
                container = self._container(manifest)
                container["args"] = ["validation-select"]
                self._set_env(container, "CNPG_CLUSTER_NAME", self.profile.source_cluster)
                result = self._job(run_id, "selection", manifest)
                if result is None:
                    return "running"
                self._bind(run_id, self._selection(result))
            self._advance(run_id, "PREFLIGHT")
        elif stage == "PREFLIGHT":
            self._preflight(run)
            self._advance(run_id, "PROVISION")
        elif stage == "PROVISION":
            selected = self.store.read()[0]["latest_run"]["selected_source"]
            required_source_bytes = selected["source_total_bytes"] + max(
                1024**3, selected["source_total_bytes"] // 20
            )
            if (
                _quantity_bytes(
                    self.templates.source_pvc["spec"]["resources"]["requests"]["storage"]
                )
                < required_source_bytes
            ):
                raise ValidationError("CAPACITY_INSUFFICIENT")
            self._resource(run_id, "source-pvc", self.templates.source_pvc)
            cluster = copy.deepcopy(self.templates.cnpg_cluster)
            spec = cluster.setdefault("spec", {})
            spec.update(
                {
                    "imageName": self.profile.postgresql_image,
                    "enableSuperuserAccess": True,
                    "storage": {
                        "size": self.profile.postgresql_storage_size,
                        "storageClass": "longhorn",
                    },
                }
            )
            spec["bootstrap"] = {"recovery": {"source": self.profile.external_cluster, "database": self.profile.database, "owner": self.profile.owner, "recoveryTarget": {"targetLSN": selected["target_lsn"], "targetTLI": str(selected["target_timeline"])}}}
            spec["externalClusters"] = [{"name": self.profile.external_cluster, "plugin": {"name": "barman-cloud.cloudnative-pg.io", "parameters": {"barmanObjectName": self.profile.object_store, "serverName": self.profile.server_name}}}]
            self._validate_cluster_target(cluster)
            self._resource(run_id, "cnpg", cluster)
            self._advance(run_id, "WAIT_CNPG")
        elif stage == "WAIT_CNPG":
            if not self._owned_observation(run_id, "cnpg", {"Healthy"}):
                return "running"
            self._advance(run_id, "VALIDATE_DB")
        elif stage == "VALIDATE_DB":
            selected = self.store.read()[0]["latest_run"]["selected_source"]
            manifest = self._database_manifest(run_id, self.templates.db_validation_job)
            self._container(manifest)["args"] = ["validate-database", "--host", f"{child_name(run_id, 'cnpg')}-rw", "--capture-started-at", selected["capture_started_at"], "--wal-fence-committed-at", selected["wal_fence_committed_at"], "--target-lsn", selected["target_lsn"], "--target-tli", str(selected["target_timeline"])]
            result = self._job(run_id, "db-validation", manifest)
            if result is None:
                return "running"
            self._database_result(result, selected)
            self._advance(run_id, "RESTORE_FILES")
        elif stage == "RESTORE_FILES":
            selected = self.store.read()[0]["latest_run"]["selected_source"]
            manifest = self._database_manifest(run_id, self.templates.source_restore_job)
            self._container(manifest)["args"] = ["restore-filesystem-stateless", selected["snapshot_name"], "--data-dir", "/restore/data", "--expected-recovery-set-id", selected["recovery_set_id"], "--expected-manifest-sha256", selected["manifest_sha256"]]
            result = self._job(run_id, "source-restore", manifest)
            if result is None:
                return "running"
            self._restore_result(result, selected)
            self._advance(run_id, "VALIDATE_CONSISTENCY")
        elif stage == "VALIDATE_CONSISTENCY":
            selected = self.store.read()[0]["latest_run"]["selected_source"]
            manifest = self._database_manifest(run_id, self.templates.consistency_job)
            self._container(manifest)["args"] = ["validate-consistency", "--host", f"{child_name(run_id, 'cnpg')}-rw", "--source", "/restore/data/source_images"]
            result = self._job(run_id, "consistency", manifest)
            if result is None:
                return "running"
            self._consistency_result(result, selected)
            self._advance(run_id, "CLEANUP")
        elif stage == "CLEANUP":
            if not self._cleanup(run_id):
                return "running"
            self._succeed_core(run_id)
            return self._finish_terminal(trigger, run_id, "succeeded")
        return "running"

    @staticmethod
    def _validate_cluster_target(cluster: dict[str, Any]) -> None:
        target = cluster.get("spec", {}).get("bootstrap", {}).get("recovery", {}).get("recoveryTarget")
        if not isinstance(target, dict) or set(target) != {"targetLSN", "targetTLI"} or LSN_RE.fullmatch(str(target.get("targetLSN", ""))) is None or target.get("targetLSN", "").lower() == "latest" or re.fullmatch(r"[1-9][0-9]{0,9}", str(target.get("targetTLI", ""))) is None:
            raise ValidationError("RECOVERY_TARGET_INVALID")

    def _preflight(self, run: dict[str, Any]) -> None:
        usage = self.gateway.namespace_usage()
        fixed_child_maximum = 10  # four Jobs, four Job Pods, one source PVC, one CNPG Cluster
        if len(self.store.read()[0]["retained_runs"]) >= self.config.max_retained_runs or usage.get("jobs", 0) + 3 > self.config.max_jobs or usage.get("pvcs", 0) + 2 > self.config.max_pvcs or fixed_child_maximum > self.config.max_child_resources:
            raise ValidationError("CAPACITY_INSUFFICIENT")

    def _database_manifest(self, run_id: str, template: dict[str, Any]) -> dict[str, Any]:
        manifest = copy.deepcopy(template)
        for volume in manifest["spec"]["template"]["spec"].get("volumes", []):
            if volume.get("name") == "credentials":
                volume["secret"]["secretName"] = f"{child_name(run_id, 'cnpg')}-superuser"
            if volume.get("name") == "source":
                volume["persistentVolumeClaim"]["claimName"] = child_name(run_id, "source-pvc")
        return manifest

    @staticmethod
    def _container(manifest: dict[str, Any]) -> dict[str, Any]:
        return manifest["spec"]["template"]["spec"]["containers"][0]

    @staticmethod
    def _set_env(container: dict[str, Any], name: str, value: str) -> None:
        env = container.setdefault("env", [])
        env[:] = [item for item in env if item.get("name") != name]
        env.append({"name": name, "value": value})

    def _manifest(self, run_id: str, role: str, template: dict[str, Any]) -> dict[str, Any]:
        result = copy.deepcopy(template)
        labels = {"app.kubernetes.io/managed-by": MANAGED_BY, RUN_LABEL: run_id, ROLE_LABEL: role}
        annotations = {"hriv.bcit.ca/created-at": utc(self.clock()), "hriv.bcit.ca/expires-at": utc(self.clock() + timedelta(seconds=self.config.retained_seconds))}
        selected = self.store.read()[0]["latest_run"]["selected_source"]
        if selected:
            annotations["hriv.bcit.ca/source-recovery-set"] = selected["recovery_set_id"]
        result["metadata"] = {"name": child_name(run_id, role), "namespace": self.config.namespace, "labels": labels, "annotations": annotations}
        if result["kind"] == "Job":
            result["spec"]["template"]["metadata"] = {"labels": labels, "annotations": annotations}
        result["metadata"]["annotations"][TEMPLATE_IDENTITY_ANNOTATION] = template_identity(result)
        return result

    def _resource(self, run_id: str, role: str, template: dict[str, Any]) -> ResourceRef:
        state, _ = self.store.read()
        existing = self._find_ref(state["latest_run"], child_name(run_id, role))
        if existing:
            self._verify_ref(existing, run_id, role)
            return existing
        ref = self.gateway.create_child(self._manifest(run_id, role, template))
        self._append_ref(run_id, ref)
        return ref

    def _job(self, run_id: str, role: str, template: dict[str, Any]) -> str | None:
        ref = self._resource(run_id, role, template)
        observation = self.gateway.observe_child(ref)
        for child in observation.resources:
            self._append_ref(run_id, child)
        if observation.phase in {"Failed", "Error"}:
            generic = f"{role.upper().replace('-', '_')}_FAILED"
            raise ValidationError(self._failure_code(observation.result, role) or generic)
        if observation.phase != "Succeeded":
            return None
        if observation.result is None:
            raise ValidationError("RESULT_MISSING")
        return observation.result

    @staticmethod
    def _failure_code(raw: str | None, role: str) -> str | None:
        if raw is None:
            return None
        operations = {"selection": "validation-select", "db-validation": "validate-database", "source-restore": "restore-filesystem-stateless", "consistency": "validate-consistency"}
        try:
            value = exact_object(
                parse_json(raw, max_bytes=4096),
                required={"schema_version", "operation", "success", "failure_code"},
                optional={"failure_stage"},
            )
        except ValidationError:
            return None
        code = value.get("failure_code")
        backup_role = role in {"selection", "source-restore"}
        failure_stage = value.get("failure_stage")
        if (
            value.get("schema_version") != 1
            or value.get("operation") != operations.get(role)
            or value.get("success") is not False
            or code not in FAILURE_CODE_ALLOWLIST.get(role, set())
            or (backup_role and not isinstance(failure_stage, str))
            or (not backup_role and "failure_stage" in value)
            or (isinstance(failure_stage, str) and not 1 <= len(failure_stage) <= 64)
        ):
            return None
        return code

    def _owned_observation(self, run_id: str, role: str, healthy: set[str]) -> bool:
        ref = self._find_ref(self.store.read()[0]["latest_run"], child_name(run_id, role))
        if not ref:
            raise ValidationError("OWNERSHIP_CONFLICT")
        self._verify_ref(ref, run_id, role)
        observation = self.gateway.observe_child(ref)
        if observation.phase in {"Failed", "Error"}:
            raise ValidationError("CNPG_RECOVERY_FAILED")
        return observation.phase in healthy

    def _verify_ref(self, ref: ResourceRef, run_id: str, role: str) -> None:
        actual = self.gateway.get_child(ref)
        if actual is None:
            raise ValidationError("OWNERSHIP_CONFLICT")
        metadata = actual.get("metadata", {})
        labels = metadata.get("labels", {})
        expected = {"app.kubernetes.io/managed-by": MANAGED_BY, RUN_LABEL: run_id, ROLE_LABEL: role}
        if str(metadata.get("uid")) != ref.uid or any(labels.get(key) != value for key, value in expected.items()):
            raise ValidationError("OWNERSHIP_CONFLICT")

    @staticmethod
    def _excluded_artifacts(value: Any) -> list[dict[str, str]]:
        if not isinstance(value, list) or len(value) > 256:
            raise ValidationError("SELECTION_RESULT_INVALID")
        result: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for item in value:
            obj = exact_object(item, required={"path", "reason"})
            path = bounded_string(obj["path"], "excluded_artifact.path", 512)
            if len(path.encode("utf-8")) > 512 or "\\" in path or path.startswith("/") or any(part in {"", ".", ".."} for part in path.split("/")):
                raise ValidationError("SELECTION_RESULT_INVALID")
            reason = obj["reason"]
            parts = path.split("/")
            if reason == "non_authoritative_production_data":
                accepted = len(parts) == 2 and parts[0] == "data" and parts[1] != "source_images"
            elif reason == "incomplete_or_non_authoritative":
                incomplete_names = {"admin", "scratch", "maintenance", "staging", "incomplete"}
                incomplete_suffixes = (".part", ".partial", ".tmp", ".uploading")
                accepted = path.startswith("data/source_images/") and (any(part.lower().lstrip(".") in incomplete_names for part in parts[2:]) or parts[-1].lower().endswith(incomplete_suffixes))
            else:
                accepted = False
            identity = (path, str(reason))
            if not accepted or identity in seen:
                raise ValidationError("SELECTION_RESULT_INVALID")
            seen.add(identity)
            result.append({"path": path, "reason": reason})
        canonical = sorted(result, key=lambda item: (item["path"], item["reason"]))
        if result != canonical:
            raise ValidationError("SELECTION_RESULT_INVALID")
        return canonical

    @staticmethod
    def _canonical_archive_etag(value: Any) -> str:
        text = bounded_string(value, "archive_etag", 130)
        token = text[1:-1] if text.startswith('"') and text.endswith('"') else text
        if ETAG_TOKEN_RE.fullmatch(token) is None:
            raise ValidationError("IMMUTABLE_BINDING_INVALID")
        return f'"{token}"'

    def _validate_selected_source(self, binding: Any) -> dict[str, Any]:
        try:
            value = exact_object(binding, required=SELECTED_SOURCE_FIELDS)
            if integer(value["selection_schema_version"], "selection_schema_version", 1, 1) != 1 or value["selection_operation"] != "validation-select":
                raise ValidationError("IMMUTABLE_BINDING_INVALID")
            bounded_string(value["backup_run_id"], "backup_run_id", 128, re.compile(r"[A-Za-z0-9._:-]{1,128}"))
            snapshot = bounded_string(value["snapshot_name"], "snapshot_name", 128, SNAPSHOT_RE)
            recovery_set = bounded_string(value["recovery_set_id"], "recovery_set_id", 128, SNAPSHOT_RE)
            if snapshot != recovery_set:
                raise ValidationError("IMMUTABLE_BINDING_INVALID")
            for name in ("manifest_sha256", "source_files_sha256", "source_state_sha256", "source_profile_sha256", "source_state_policy_sha256"):
                bounded_string(value[name], name, 64, SHA256_RE)
            archive_blob = bounded_string(value["archive_blob"], "archive_blob", 256)
            if archive_blob != f"{self.profile.source_prefix}/{snapshot}.tar.gz":
                raise ValidationError("IMMUTABLE_BINDING_INVALID")
            integer(value["archive_size"], "archive_size", 1, 2**63 - 1)
            if self._canonical_archive_etag(value["archive_etag"]) != value["archive_etag"]:
                raise ValidationError("IMMUTABLE_BINDING_INVALID")
            capture_text, capture = _strict_utc(value["capture_started_at"], "capture_started_at")
            committed_text, committed = _strict_utc(value["wal_fence_committed_at"], "wal_fence_committed_at")
            archived_text, archived = _strict_utc(value["wal_fence_archived_at"], "wal_fence_archived_at")
            completed_text, completed = _strict_utc(value["completed_at"], "completed_at")
            if (capture_text, committed_text, archived_text, completed_text) != (value["capture_started_at"], value["wal_fence_committed_at"], value["wal_fence_archived_at"], value["completed_at"]) or not capture <= committed <= archived <= completed:
                raise ValidationError("IMMUTABLE_BINDING_INVALID")
            timeline = integer(value["target_timeline"], "target_timeline", 1, 2**31 - 1)
            bounded_string(value["target_lsn"], "target_lsn", 17, LSN_RE)
            fence_file = bounded_string(value["wal_fence_file"], "wal_fence_file", 24, re.compile(r"[0-9A-F]{24}"))
            if int(fence_file[:8], 16) != timeline:
                raise ValidationError("IMMUTABLE_BINDING_INVALID")
            source_files = integer(value["source_file_count"], "source_file_count", 0, 10_000_000)
            integer(value["source_total_bytes"], "source_total_bytes", 0, 2**63 - 1)
            database_rows = integer(value["database_row_count"], "database_row_count", 0, 10_000_000)
            missing = integer(value["missing_count"], "missing_count", 0, 256)
            orphan = integer(value["orphan_count"], "orphan_count", 0, 256)
            exclusions = integer(value["exclusion_count"], "exclusion_count", 0, 256)
            excluded = self._excluded_artifacts(value["excluded_artifacts"])
            if database_rows != source_files + missing or exclusions != len(excluded):
                raise ValidationError("IMMUTABLE_BINDING_INVALID")
            integer(value["source_profile_version"], "source_profile_version", 1, 1000)
            integer(value["source_state_policy_version"], "source_state_policy_version", 1, 1000)
            profile_values = (value["source_profile_id"], value["source_profile_version"], value["source_profile_sha256"], value["database"], value["owner"], value["expected_system_identifier"], value["server_name"], value["external_cluster"], value["object_store"])
            expected_profile = (self.profile.profile_id, self.profile.profile_version, self.profile.sha256, self.profile.database, self.profile.owner, self.profile.expected_system_identifier, self.profile.server_name, self.profile.external_cluster, self.profile.object_store)
            if profile_values != expected_profile:
                raise ValidationError("IMMUTABLE_BINDING_INVALID")
            try:
                source_state = exact_object(value["source_state"], required={"missing_sources", "orphan_sources"})
                if source_state != self.policy.document() or value["source_state_sha256"] != self.policy.sha256 or value["source_state_policy_version"] != self.policy.policy_version or value["source_state_policy_sha256"] != self.policy.sha256 or missing != len(self.policy.missing_sources) or orphan != len(self.policy.orphan_sources) or database_rows != self.profile.expected_source_image_count:
                    raise ValidationError("SOURCE_POLICY_MISMATCH")
            except ValidationError as exc:
                raise ValidationError("SOURCE_POLICY_MISMATCH") from exc
            return value
        except ValidationError as exc:
            if exc.code == "SOURCE_POLICY_MISMATCH":
                raise
            raise ValidationError("IMMUTABLE_BINDING_INVALID") from exc

    def _selection(self, raw: str) -> dict[str, Any]:
        value = exact_object(parse_json(raw, max_bytes=128 * 1024), required=SELECTION_FIELDS)
        if value["schema_version"] != 1 or value["operation"] != "validation-select" or value["success"] is not True:
            raise ValidationError("SELECTION_RESULT_INVALID")
        binding = {
            "selection_schema_version": 1, "selection_operation": "validation-select", "backup_run_id": value["run_id"],
            "snapshot_name": value["snapshot_name"], "recovery_set_id": value["recovery_set_id"], "manifest_sha256": value["manifest_sha256"],
            "archive_blob": value["archive_blob"], "archive_size": value["archive_size"], "archive_etag": self._canonical_archive_etag(value["archive_etag"]),
            "completed_at": value["completed_at"], "target_lsn": value["target_lsn"], "target_timeline": value["target_timeline"],
            "source_file_count": value["source_file_count"], "source_total_bytes": value["source_total_bytes"], "source_files_sha256": value["source_files_sha256"], "database_row_count": value["database_row_count"],
            "missing_count": value["missing_count"], "orphan_count": value["orphan_count"], "exclusion_count": value["exclusion_count"],
            "source_state": copy.deepcopy(value["source_state"]), "source_state_sha256": value["source_state_sha256"], "excluded_artifacts": copy.deepcopy(value["excluded_artifacts"]),
            "capture_started_at": value["capture_started_at"], "wal_fence_file": value["wal_fence_file"], "wal_fence_committed_at": value["wal_fence_committed_at"], "wal_fence_archived_at": value["wal_fence_archived_at"],
            "source_profile_id": self.profile.profile_id, "source_profile_version": self.profile.profile_version, "source_profile_sha256": self.profile.sha256,
            "source_state_policy_version": self.policy.policy_version, "source_state_policy_sha256": self.policy.sha256,
            "database": self.profile.database, "owner": self.profile.owner, "expected_system_identifier": self.profile.expected_system_identifier,
            "server_name": self.profile.server_name, "external_cluster": self.profile.external_cluster, "object_store": self.profile.object_store,
        }
        return self._validate_selected_source(binding)

    def _database_result(self, raw: str, selected: dict[str, Any]) -> None:
        required = {"schema_version", "operation", "success", "system_identifier", "timeline", "recovery_complete", "database_inventory", "static_role_inventory", "migration_version", "row_counts", "source_image_count", "synthetic_row", "current_lsn", "target_lsn", "fence_generation", "fence_fenced_at"}
        value = exact_object(parse_json(raw, max_bytes=32 * 1024), required=required)
        fenced_text, fenced_at = _strict_utc(value.get("fence_fenced_at"), "fence_fenced_at")
        _, capture_started = _strict_utc(selected["capture_started_at"], "capture_started_at")
        _, fence_committed = _strict_utc(selected["wal_fence_committed_at"], "wal_fence_committed_at")
        expected = {"schema_version": 1, "operation": "validate-database", "success": True, "system_identifier": self.profile.expected_system_identifier, "timeline": selected["target_timeline"], "recovery_complete": True, "database_inventory": [dict(item) for item in self.profile.expected_database_inventory], "static_role_inventory": [dict(item) for item in self.profile.expected_static_role_inventory], "migration_version": self.profile.expected_migration_version, "row_counts": self.profile.expected_row_counts, "source_image_count": self.profile.expected_source_image_count, "synthetic_row": self.profile.synthetic_row, "current_lsn": value.get("current_lsn"), "target_lsn": selected["target_lsn"], "fence_generation": value.get("fence_generation"), "fence_fenced_at": fenced_text}
        generation = value.get("fence_generation")
        fenced_comparison = fenced_at.replace(microsecond=0) if fence_committed.microsecond == 0 else fenced_at
        if value != expected or LSN_RE.fullmatch(str(value.get("current_lsn", ""))) is None or not isinstance(generation, int) or isinstance(generation, bool) or generation <= 0 or not capture_started <= fenced_comparison <= fence_committed:
            raise ValidationError("DB_VALIDATION_INVALID")

    def _restore_result(self, raw: str, selected: dict[str, Any]) -> None:
        required = SELECTION_FIELDS | {"target_data_dir", "restored_file_count", "restored_total_bytes", "selection_duration_seconds", "restore_duration_seconds", "duration_seconds", "outcome"}
        value = exact_object(parse_json(raw, max_bytes=128 * 1024), required=required)
        durations = [value[name] for name in ("selection_duration_seconds", "restore_duration_seconds", "duration_seconds")]
        if value["schema_version"] != 1 or value["operation"] != "restore-filesystem-stateless" or value["success"] is not True or value["snapshot_name"] != selected["snapshot_name"] or value["recovery_set_id"] != selected["recovery_set_id"] or value["manifest_sha256"] != selected["manifest_sha256"] or value["outcome"] != "restored" or value["target_data_dir"] != "/restore/data" or value["restored_file_count"] != selected["source_file_count"] or value["restored_total_bytes"] != selected["source_total_bytes"] or value["source_files_sha256"] != selected["source_files_sha256"] or any(isinstance(item, bool) or not isinstance(item, (int, float)) or item < 0 for item in durations):
            raise ValidationError("RESTORE_RESULT_INVALID")

    def _consistency_result(self, raw: str, selected: dict[str, Any]) -> None:
        required = {"schema_version", "operation", "success", "database_source_count", "restored_file_count", "restored_total_bytes", "source_files_sha256", "missing_sources", "orphan_sources", "source_state_policy_sha256"}
        value = exact_object(parse_json(raw, max_bytes=128 * 1024), required=required)
        expected = {"schema_version": 1, "operation": "validate-consistency", "success": True, "database_source_count": selected["database_row_count"], "restored_file_count": selected["source_file_count"], "restored_total_bytes": selected["source_total_bytes"], "source_files_sha256": selected["source_files_sha256"], "missing_sources": self.policy.document()["missing_sources"], "orphan_sources": self.policy.document()["orphan_sources"], "source_state_policy_sha256": self.policy.sha256}
        if value != expected:
            raise ValidationError("CONSISTENCY_RESULT_INVALID")

    def _bind(self, run_id: str, binding: dict[str, Any]) -> None:
        def mutate(state: dict[str, Any]) -> None:
            run = self._holder(state, run_id)
            if run["selected_source"] is not None and run["selected_source"] != binding:
                raise ValidationError("IMMUTABLE_BINDING_CHANGED")
            run["selected_source"] = binding
        self.store.update(mutate)

    def _advance(self, run_id: str, next_stage: str) -> None:
        now = utc(self.clock())
        def mutate(state: dict[str, Any]) -> None:
            run = self._holder(state, run_id)
            entry = run["stages"][run["current_stage"]]
            entry.update({"outcome": "succeeded", "completed_at": now, "duration_seconds": max(0, int((_date(now) - _date(entry["started_at"])).total_seconds()))})
            run["state"] = run["current_stage"] = next_stage
            run["sequence"] += 1
            run["heartbeat_at"] = now
            run["stages"].setdefault(next_stage, {"outcome": "running", "started_at": now})
            state["active_run"] = self._summary(run)
        self.store.update(mutate)

    def _append_ref(self, run_id: str, ref: ResourceRef) -> None:
        def mutate(state: dict[str, Any]) -> None:
            run = self._holder(state, run_id)
            if not any(item["apiVersion"] == ref.api_version and item["kind"] == ref.kind and item["name"] == ref.name for item in run["child_resources"]):
                if len(run["child_resources"]) >= self.config.max_child_resources:
                    raise ValidationError("STATE_SIZE_EXCEEDED")
                run["child_resources"].append(ref.document())
                run["cleanup"]["remaining_resource_count"] = len(run["child_resources"])
                run["sequence"] += 1
                state["active_run"] = self._summary(run)
        self.store.update(mutate)

    def _cleanup(self, run_id: str) -> bool:
        run = self._holder(self.store.read()[0], run_id)
        refs = [ResourceRef(item["apiVersion"], item["kind"], item["name"], item["uid"]) for item in run["child_resources"]]
        self._mark_cleanup(run_id)
        for ref in refs:
            actual = self.gateway.get_child(ref)
            if actual is None:
                continue
            self._verify_ref(ref, run_id, self._role_for_ref(run, ref, actual))
            if not actual.get("metadata", {}).get("deletionTimestamp"):
                self.gateway.delete_child(ref)
        remaining = [ref for ref in refs if self.gateway.get_child(ref) is not None]
        labelled = self.gateway.list_run_children(run_id)
        self._set_remaining(run_id, len(remaining) + len([item for item in labelled if item not in remaining]))
        return not remaining and not labelled

    def _mark_cleanup(self, run_id: str) -> None:
        def mutate(state: dict[str, Any]) -> None:
            run = self._holder(state, run_id)
            if run["cleanup"]["requested_at"] is None:
                run["cleanup"]["requested_at"] = utc(self.clock())
                run["cleanup"]["outcome"] = "running"
        self.store.update(mutate)

    def _set_remaining(self, run_id: str, count: int) -> None:
        def mutate(state: dict[str, Any]) -> None:
            self._holder(state, run_id)["cleanup"]["remaining_resource_count"] = count
        self.store.update(mutate)

    def _succeed_core(self, run_id: str) -> None:
        now = utc(self.clock())
        def mutate(state: dict[str, Any]) -> None:
            run = self._holder(state, run_id)
            entry = run["stages"]["CLEANUP"]
            entry.update({"outcome": "succeeded", "completed_at": now, "duration_seconds": max(0, int((_date(now) - _date(entry["started_at"])).total_seconds()))})
            run.update({"state": "SUCCEEDED", "current_stage": None, "sequence": run["sequence"] + 1, "heartbeat_at": now, "completed_at": now, "outcome": "succeeded", "core_succeeded": {"stage": "core_succeeded", "completed_at": now, "contract_boundary": "1251"}})
            run["cleanup"].update({"outcome": "succeeded", "completed_at": now, "remaining_resource_count": 0})
            state["active_run"] = self._summary(run)
            self._history_for_run(state, run)
        self.store.update(mutate)

    def _current_child_ownership(self, run_id: str) -> list[ResourceRef]:
        try:
            candidates = self.gateway.list_run_children(run_id)
            captured: list[ResourceRef] = []
            for ref in candidates:
                actual = self.gateway.get_child(ref)
                metadata = (actual or {}).get("metadata", {})
                labels = metadata.get("labels", {})
                role = labels.get(ROLE_LABEL)
                expected = {"app.kubernetes.io/managed-by": MANAGED_BY, RUN_LABEL: run_id, ROLE_LABEL: role}
                if role not in {"selection", "source-pvc", "cnpg", "db-validation", "source-restore", "consistency"} or ref.name != child_name(run_id, role) or UID_RE.fullmatch(ref.uid) is None or str(metadata.get("uid")) != ref.uid or any(labels.get(key) != value for key, value in expected.items()):
                    continue
                captured.append(ref)
            return captured
        except Exception:
            return []

    def _retain(self, run_id: str, code: str, failure_stage: str | None, current_refs: list[ResourceRef] | None = None) -> None:
        now = utc(self.clock())
        def mutate(state: dict[str, Any]) -> None:
            run = self._holder(state, run_id)
            for ref in current_refs or []:
                if not any(item["apiVersion"] == ref.api_version and item["kind"] == ref.kind and item["name"] == ref.name for item in run["child_resources"]):
                    if len(run["child_resources"]) >= self.config.max_child_resources:
                        raise ValidationError("STATE_SIZE_EXCEEDED")
                    run["child_resources"].append(ref.document())
            run["cleanup"]["remaining_resource_count"] = len(run["child_resources"])
            run.update({"state": "FAILED_RETAIN", "current_stage": None, "sequence": run["sequence"] + 1, "heartbeat_at": now, "completed_at": now, "expires_at": utc(self.clock() + timedelta(seconds=self.config.retained_seconds)), "outcome": "retained", "failure_stage": failure_stage, "failure_code": code})
            if failure_stage and failure_stage in run["stages"]:
                run["stages"][failure_stage].update({"outcome": "failed", "completed_at": now, "failure_code": code})
            record = {"run_id": run_id, "outcome": "retained", "failure_stage": failure_stage, "failure_code": code, "expires_at": run["expires_at"], "cleanup": copy.deepcopy(run["cleanup"]) | {"outcome": "retained"}, "child_resources": copy.deepcopy(run["child_resources"])}
            retained = {item["run_id"]: item for item in state["retained_runs"]}
            retained[run_id] = record
            if len(retained) > self.config.max_retained_runs:
                raise ValidationError("RETAINED_RUN_LIMIT")
            state["retained_runs"] = list(retained.values())
            state["active_run"] = self._summary(run)
            self._history_for_run(state, run)
        self.store.update(mutate)

    def _history_for_run(self, state: dict[str, Any], run: dict[str, Any]) -> None:
        state["attempt_history"] = merge_history(state["attempt_history"], [{"entry_kind": "accepted_run", "run_id": run["run_id"], "trigger": run["trigger"], "state": run["state"], "outcome": run["outcome"], "failure_stage": run["failure_stage"], "failure_code": run["failure_code"], "cleanup_outcome": run["cleanup"]["outcome"], "remaining_resource_count": run["cleanup"]["remaining_resource_count"], "started_at": run["started_at"], "completed_at": run.get("completed_at")}])

    def _release(self, trigger: Trigger, run_id: str) -> None:
        lease = self.gateway.read_lease(self.config.lease_name)
        if lease.holder_identity:
            uid, held_run, _, _ = parse_holder(lease.holder_identity)
            if (uid, held_run) == (trigger.job_uid, run_id):
                self.gateway.replace_lease(self.config.lease_name, Lease(lease.resource_version, None, None, None, None))

    def renew(self, trigger: Trigger, run_id: str) -> None:
        lease = self.gateway.read_lease(self.config.lease_name)
        uid, held_run, acquired, _ = parse_holder(lease.holder_identity or "")
        if (uid, held_run) != (trigger.job_uid, run_id):
            raise ValidationError("LEASE_OWNERSHIP_LOST")
        now = normalize_lease_time(self.clock())
        acquired = normalize_lease_time(acquired)
        self.gateway.replace_lease(self.config.lease_name, Lease(lease.resource_version, holder_identity(uid, run_id, acquired, now), acquired, now, self.config.lease_seconds))
        def heartbeat(state: dict[str, Any]) -> None:
            run = self._holder(state, run_id)
            run["heartbeat_at"] = utc(now)
            run["sequence"] += 1
            state["active_run"] = self._summary(run)
        self.store.update(heartbeat)

    def _verify_lease(self, trigger: Trigger, run_id: str) -> None:
        lease = self.gateway.read_lease(self.config.lease_name)
        uid, held_run, acquired, renewed = parse_holder(lease.holder_identity or "")
        if (uid, held_run) != (trigger.job_uid, run_id) or lease.acquire_time is None or lease.renew_time is None or normalize_lease_time(lease.acquire_time) != acquired or normalize_lease_time(lease.renew_time) != renewed:
            raise ValidationError("LEASE_OWNERSHIP_LOST")

    def _clear_active(self, run_id: str, uid: str) -> None:
        def mutate(state: dict[str, Any]) -> None:
            active = state["active_run"]
            if active and (active["run_id"], active["job_uid"]) == (run_id, uid):
                state["active_run"] = None
        self.store.update(mutate)

    def _finish_terminal(self, trigger: Trigger, run_id: str, outcome: str) -> str:
        self._release(trigger, run_id)
        self._clear_active(run_id, trigger.job_uid)
        return outcome

    def _ownership_intact(self, run: dict[str, Any]) -> bool:
        expected = {(item["apiVersion"], item["kind"], item["name"], item["uid"]) for item in run["child_resources"]}
        observed_refs = self.gateway.list_run_children(run["run_id"])
        observed = {(item.api_version, item.kind, item.name, item.uid) for item in observed_refs}
        if not expected <= observed:
            return False
        owner_roles = {item["uid"]: self._role_for_name(run["run_id"], item["name"]) for item in run["child_resources"] if item["kind"] in {"Job", "Cluster"}}
        for ref in observed_refs:
            identity = (ref.api_version, ref.kind, ref.name, ref.uid)
            if identity in expected:
                continue
            if ref.kind not in {"Pod", "Service"}:
                return False
            actual = self.gateway.get_child(ref)
            metadata = (actual or {}).get("metadata", {})
            labels = metadata.get("labels", {})
            owners = metadata.get("ownerReferences", [])
            owner_uid = str(owners[0].get("uid")) if len(owners) == 1 else ""
            required = {"app.kubernetes.io/managed-by": MANAGED_BY, RUN_LABEL: run["run_id"], ROLE_LABEL: owner_roles.get(owner_uid)}
            if any(value is None or labels.get(key) != value for key, value in required.items()) or len(owners) != 1 or owner_uid not in owner_roles or owners[0].get("controller") is not True:
                return False
        return True

    @staticmethod
    def _summary(run: dict[str, Any]) -> dict[str, Any]:
        return {key: run[key] for key in ("run_id", "job_name", "job_uid", "state", "current_stage", "sequence", "started_at", "heartbeat_at")}

    @staticmethod
    def _holder(state: dict[str, Any], run_id: str) -> dict[str, Any]:
        run = state["latest_run"]
        if not run or run["run_id"] != run_id or not state["active_run"] or state["active_run"]["run_id"] != run_id:
            raise ValidationError("STATE_OWNERSHIP_INVALID")
        return run

    @staticmethod
    def _role_for_name(run_id: str, name: str) -> str:
        for role in ("selection", "source-pvc", "cnpg", "db-validation", "source-restore", "consistency"):
            if child_name(run_id, role) == name:
                return role
        raise ValidationError("OWNERSHIP_CONFLICT")

    @classmethod
    def _role_for_ref(cls, run: dict[str, Any], ref: ResourceRef, actual: dict[str, Any]) -> str:
        if ref.kind != "Pod":
            return cls._role_for_name(run["run_id"], ref.name)
        owners = actual.get("metadata", {}).get("ownerReferences", [])
        if len(owners) != 1 or owners[0].get("kind") != "Job":
            raise ValidationError("OWNERSHIP_CONFLICT")
        owner_uid = str(owners[0].get("uid"))
        for item in run["child_resources"]:
            if item["kind"] == "Job" and item["uid"] == owner_uid:
                return cls._role_for_name(run["run_id"], item["name"])
        raise ValidationError("OWNERSHIP_CONFLICT")

    @staticmethod
    def _find_ref(run: dict[str, Any], name: str) -> ResourceRef | None:
        for item in run["child_resources"]:
            if item["name"] == name:
                return ResourceRef(item["apiVersion"], item["kind"], item["name"], item["uid"])
        return None
