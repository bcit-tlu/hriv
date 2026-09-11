from __future__ import annotations

import copy
import re
from datetime import datetime, timezone
from typing import Any, Callable

from .strict import RFC3339_RE, ValidationError, bounded_string, canonical_json, exact_object, integer, parse_json

MAX_HISTORY = 10
MAX_RETAINED = 2
MAX_CHILDREN = 64
STAGES = ("SELECT", "PREFLIGHT", "PROVISION", "WAIT_CNPG", "VALIDATE_DB", "RESTORE_FILES", "VALIDATE_CONSISTENCY", "CLEANUP")
TERMINAL = {"SUCCEEDED", "FAILED_RETAIN"}


def utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def empty_state(now: datetime) -> dict[str, Any]:
    return {"schema_version": 1, "generation": 0, "updated_at": utc(now), "active_run": None, "latest_run": None, "latest_trigger": None, "retained_runs": [], "attempt_history": [], "last_complete_success": None}


def parse_state(raw: str | bytes | None, now: datetime) -> dict[str, Any]:
    if raw is None:
        return empty_state(now)
    value = exact_object(parse_json(raw), required={"schema_version", "generation", "updated_at", "active_run", "latest_run", "latest_trigger", "retained_runs", "attempt_history", "last_complete_success"})
    _bounded_tree(value)
    if value["schema_version"] != 1:
        raise ValidationError("STATE_SCHEMA_UNSUPPORTED")
    integer(value["generation"], "generation", 0, 2**63 - 1)
    bounded_string(value["updated_at"], "updated_at", 32, RFC3339_RE)
    if not isinstance(value["retained_runs"], list) or len(value["retained_runs"]) > MAX_RETAINED:
        raise ValidationError("STATE_INVARIANT")
    if not isinstance(value["attempt_history"], list) or len(value["attempt_history"]) > MAX_HISTORY:
        raise ValidationError("STATE_INVARIANT")
    latest = value["latest_run"]
    active = value["active_run"]
    if latest is not None:
        _run(latest)
    if active is not None:
        exact_object(active, required={"run_id", "job_name", "job_uid", "state", "current_stage", "sequence", "started_at", "heartbeat_at"})
        if latest is None or any(active[k] != latest[k] for k in ("run_id", "job_name", "job_uid", "state", "current_stage", "sequence")):
            raise ValidationError("STATE_OWNERSHIP_INVALID")
    seen: set[str] = set()
    for retained in value["retained_runs"]:
        exact_object(retained, required={"run_id", "outcome", "failure_stage", "failure_code", "expires_at", "cleanup", "child_resources"})
        run_id = bounded_string(retained["run_id"], "run_id", 63)
        if run_id in seen or retained["outcome"] != "retained" or len(retained["child_resources"]) > MAX_CHILDREN:
            raise ValidationError("STATE_INVARIANT")
        seen.add(run_id)
    canonical_json(value)
    return value


def _bounded_tree(value: Any) -> None:
    if isinstance(value, str) and len(value) > 512:
        raise ValidationError("STATE_INVARIANT")
    if isinstance(value, dict):
        if len(value) > 64 or any(not isinstance(key, str) or len(key) > 64 for key in value):
            raise ValidationError("STATE_INVARIANT")
        for item in value.values():
            _bounded_tree(item)
    elif isinstance(value, list):
        # Selected source-state evidence is bounded independently to 256 missing and
        # orphan entries; the serialized state byte limit remains the outer bound.
        if len(value) > 256:
            raise ValidationError("STATE_INVARIANT")
        for item in value:
            _bounded_tree(item)


def _run(run: dict[str, Any]) -> None:
    required = {"run_id", "trigger", "job_name", "job_uid", "state", "current_stage", "sequence", "started_at", "heartbeat_at", "selected_source", "child_resources", "stages", "outcome", "failure_stage", "failure_code", "cleanup", "core_succeeded"}
    exact_object(run, required=required, optional={"completed_at", "expires_at", "orchestrator_evidence"})
    state = run["state"]
    if state not in STAGES + tuple(TERMINAL):
        raise ValidationError("STATE_INVARIANT")
    projected = "succeeded" if state == "SUCCEEDED" else "retained" if state == "FAILED_RETAIN" else "running"
    if run["outcome"] != projected or run["current_stage"] != (None if state in TERMINAL else state):
        raise ValidationError("STATE_INVARIANT")
    integer(run["sequence"], "sequence", 1, 2**63 - 1)
    if not isinstance(run["child_resources"], list) or len(run["child_resources"]) > MAX_CHILDREN or not isinstance(run["stages"], dict) or len(run["stages"]) > 32:
        raise ValidationError("STATE_INVARIANT")
    resources: set[tuple[str, str, str]] = set()
    for item in run["child_resources"]:
        exact_object(item, required={"apiVersion", "kind", "name", "uid"}, optional={"template_sha256"})
        identity = (bounded_string(item["apiVersion"], "apiVersion", 64), bounded_string(item["kind"], "kind", 64), bounded_string(item["name"], "name", 253))
        bounded_string(item["uid"], "uid", 128)
        if "template_sha256" in item:
            bounded_string(item["template_sha256"], "template_sha256", 64, re.compile(r"[0-9a-f]{64}"))
        if identity in resources:
            raise ValidationError("STATE_INVARIANT")
        resources.add(identity)


def history_key(entry: dict[str, Any]) -> tuple[str, str]:
    kind = entry.get("entry_kind")
    identity = entry.get("run_id") if kind == "accepted_run" else entry.get("trigger_id")
    if kind not in {"accepted_run", "rejected_trigger"} or not isinstance(identity, str):
        raise ValidationError("STATE_INVARIANT")
    return kind, identity


def merge_history(current: list[dict[str, Any]], additions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = {history_key(entry): copy.deepcopy(entry) for entry in current}
    merged.update({history_key(entry): copy.deepcopy(entry) for entry in additions})
    return sorted(merged.values(), key=lambda item: (item.get("completed_at") or item["started_at"], item["started_at"], *history_key(item)), reverse=True)[:MAX_HISTORY]


class StateStore:
    def __init__(self, gateway: Any, name: str, retries: int, clock: Callable[[], datetime], max_bytes: int) -> None:
        if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or not 1 <= max_bytes <= 512 * 1024:
            raise ValidationError("STATE_SIZE_INVALID")
        self.gateway, self.name, self.retries, self.clock, self.max_bytes = gateway, name, retries, clock, max_bytes

    def read(self) -> tuple[dict[str, Any], str]:
        raw, version = self.gateway.read_state(self.name)
        if raw is not None and len(raw.encode("utf-8")) > self.max_bytes:
            raise ValidationError("STATE_SIZE_EXCEEDED")
        return parse_state(raw, self.clock()), version

    def update(self, mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        for _ in range(self.retries):
            state, version = self.read()
            mutate(state)
            state["generation"] += 1
            state["updated_at"] = utc(self.clock())
            raw = canonical_json(state)
            if len(raw.encode("utf-8")) > self.max_bytes:
                raise ValidationError("STATE_SIZE_EXCEEDED")
            try:
                self.gateway.replace_state(self.name, raw, version)
                return state
            except self.gateway.conflict_error:
                continue
        raise ValidationError("STATE_CAS_EXHAUSTED")

    def trigger_only(self, trigger: dict[str, Any]) -> dict[str, Any]:
        def mutate(state: dict[str, Any]) -> None:
            state["attempt_history"] = merge_history(state["attempt_history"], [trigger])
            latest = state["latest_trigger"]
            if latest is None or (trigger["started_at"], trigger["trigger_id"]) > (latest["started_at"], latest["trigger_id"]):
                state["latest_trigger"] = {key: value for key, value in trigger.items() if key != "entry_kind"}
        return self.update(mutate)
