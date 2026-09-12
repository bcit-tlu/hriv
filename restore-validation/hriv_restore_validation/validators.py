from __future__ import annotations

import hashlib
import json
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from .models import SourcePolicy, SourceProfile, canonical_source_state
from .strict import LSN_RE, ValidationError, bounded_string, canonical_json

MAX_RESULT_BYTES = 32 * 1024


def _strict_utc(value: str) -> datetime:
    if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{6})?Z", value) is None:
        raise ValidationError("TIMESTAMP_INVALID")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() != timedelta(0):
        raise ValidationError("TIMESTAMP_INVALID")
    return parsed.astimezone(timezone.utc)


def _utc_text(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValidationError("DATABASE_RESULT_INVALID")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _credentials(path: Path) -> tuple[str, str]:
    username = (path / "username").read_text(encoding="utf-8").strip()
    password = (path / "password").read_text(encoding="utf-8").strip()
    if not username or len(username) > 128 or not password or len(password) > 4096:
        raise ValidationError("DATABASE_CREDENTIAL_INVALID")
    return username, password


def _connect(factory: Callable[..., Any], host: str, database: str, credentials: Path) -> Any:
    username, password = _credentials(credentials)
    return factory(host=host, dbname=database, user=username, password=password, connect_timeout=10, autocommit=True, options="-c default_transaction_read_only=on", row_factory=dict_row)


def _one(connection: Any, query: Any, params: tuple[Any, ...] = ()) -> dict[str, Any]:
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        row = cursor.fetchone()
    if not isinstance(row, dict):
        raise ValidationError("DATABASE_RESULT_INVALID")
    return row


def _all(connection: Any, query: Any, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValidationError("DATABASE_RESULT_INVALID")
    return rows


def validate_database(profile: SourceProfile, host: str, capture_started_at: str, wal_fence_committed_at: str, target_lsn: str, target_tli: int, expected_source_image_count: int, credentials: Path, *, connect: Callable[..., Any] = psycopg.connect, recovery_attempts: int = 12, sleeper: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    bounded_string(host, "host", 253)
    capture_started = _strict_utc(capture_started_at)
    fence_committed = _strict_utc(wal_fence_committed_at)
    if capture_started > fence_committed or LSN_RE.fullmatch(target_lsn) is None or target_lsn.lower() == "latest" or target_tli < 1 or isinstance(expected_source_image_count, bool) or not isinstance(expected_source_image_count, int) or not 0 <= expected_source_image_count <= 10_000_000 or isinstance(recovery_attempts, bool) or not 1 <= recovery_attempts <= 12:
        raise ValidationError("RECOVERY_TARGET_INVALID")
    with _connect(connect, host, "postgres", credentials) as cluster:
        identity = _one(cluster, "SELECT system_identifier::text AS system_identifier FROM pg_control_system()")
        for attempt in range(recovery_attempts):
            recovery = _one(cluster, "SELECT pg_is_in_recovery() AS in_recovery, timeline_id::bigint AS timeline FROM pg_control_checkpoint()")
            if recovery == {"in_recovery": False, "timeline": target_tli}:
                break
            if attempt + 1 < recovery_attempts:
                sleeper(5.0)
        databases = _all(cluster, "SELECT d.datname AS name, r.rolname AS owner, d.datallowconn AS allow_connections FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datallowconn ORDER BY d.datname")
        roles = _all(cluster, "SELECT r.rolname AS name, jsonb_build_object('superuser',r.rolsuper,'inherit',r.rolinherit,'createrole',r.rolcreaterole,'createdb',r.rolcreatedb,'canlogin',r.rolcanlogin,'replication',r.rolreplication,'bypassrls',r.rolbypassrls) AS attributes, COALESCE((SELECT jsonb_agg(parent.rolname ORDER BY parent.rolname) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid),'[]'::jsonb) AS memberships FROM pg_roles r WHERE r.rolname !~ '^pg_' ORDER BY r.rolname")
        reached = _one(cluster, "SELECT pg_current_wal_insert_lsn() >= %s::pg_lsn AS reached, pg_current_wal_insert_lsn()::text AS current_lsn", (target_lsn,))
    roles = [row for row in roles if not any(row["name"].startswith(prefix) for prefix in profile.dynamic_role_prefixes)]
    required_databases = [dict(item) for item in profile.required_database_inventory]
    required_roles = [dict(item) for item in profile.required_static_role_inventory]
    databases_by_name = {row.get("name"): row for row in databases}
    roles_by_name = {row.get("name"): row for row in roles}
    observed_required_databases = [databases_by_name.get(item["name"]) for item in required_databases]
    observed_required_roles = [roles_by_name.get(item["name"]) for item in required_roles]
    with _connect(connect, host, profile.application_database, credentials) as app:
        migration = _one(app, "SELECT version_num FROM public.alembic_version")
        row_counts: dict[str, int] = {}
        for table in profile.minimum_row_counts:
            row_counts[table] = int(_one(app, sql.SQL("SELECT count(*)::bigint AS count FROM public.{}").format(sql.Identifier(table)))["count"])
        source_count = int(_one(app, "SELECT count(*)::bigint AS count FROM public.source_images")["count"])
        synthetic_rows = _all(app, "SELECT id::text AS id, email FROM public.users WHERE metadata->>'synthetic'='true' ORDER BY id")
        fences = _all(app, "SELECT generation::bigint AS generation, fenced_at FROM public.backup_recovery_wal_fence WHERE singleton IS TRUE ORDER BY generation")
    if len(fences) != 1:
        raise ValidationError("DATABASE_FIDELITY_MISMATCH")
    fence = fences[0]
    fenced_at = fence.get("fenced_at")
    fenced_comparison = fenced_at
    if isinstance(fenced_at, datetime) and fence_committed.microsecond == 0:
        fenced_comparison = fenced_at.replace(microsecond=0)
    synthetic = []
    for row in synthetic_rows:
        email = row.get("email")
        if set(row) != {"id", "email"} or not isinstance(email, str):
            raise ValidationError("DATABASE_RESULT_INVALID")
        synthetic.append({"id": row.get("id"), "email_sha256": hashlib.sha256(email.lower().encode("utf-8")).hexdigest()})
    valid = (
        identity.get("system_identifier") == profile.expected_system_identifier
        and recovery == {"in_recovery": False, "timeline": target_tli}
        and observed_required_databases == required_databases
        and observed_required_roles == required_roles
        and migration.get("version_num") == profile.expected_migration_version
        and all(row_counts[name] >= minimum for name, minimum in profile.minimum_row_counts.items())
        and source_count == expected_source_image_count
        and synthetic == [profile.synthetic_row]
        and reached.get("reached") is True
        and isinstance(fence.get("generation"), int)
        and not isinstance(fence.get("generation"), bool)
        and fence["generation"] > 0
        and isinstance(fenced_at, datetime)
        and fenced_at.tzinfo is not None
        and fenced_at.utcoffset() is not None
        and isinstance(fenced_comparison, datetime)
        and capture_started <= fenced_comparison.astimezone(timezone.utc) <= fence_committed
    )
    if not valid:
        raise ValidationError("DATABASE_FIDELITY_MISMATCH")
    result = {"schema_version": 1, "operation": "validate-database", "success": True, "required_database_inventory": observed_required_databases, "required_static_role_inventory": observed_required_roles, "system_identifier": identity["system_identifier"], "timeline": target_tli, "recovery_complete": True, "migration_version": migration["version_num"], "observed_row_counts": row_counts, "source_image_count": source_count, "synthetic_row": synthetic[0], "current_lsn": reached["current_lsn"], "target_lsn": target_lsn, "fence_generation": fence["generation"], "fence_fenced_at": _utc_text(fenced_at)}
    _bounded_result(result)
    return result


def _canonical_source_path(value: str) -> str:
    value = value.replace("\\", "/")
    for prefix in ("/data/source_images/", "data/source_images/", "source_images/"):
        if value.startswith(prefix):
            value = value[len(prefix):]
            break
    parts = Path(value).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValidationError("SOURCE_PATH_INVALID")
    return "data/source_images/" + "/".join(parts)


def validate_consistency(profile: SourceProfile, policy: SourcePolicy, selected_source_state: Any, host: str, source: Path, credentials: Path, *, connect: Callable[..., Any] = psycopg.connect) -> dict[str, Any]:
    selected, selected_digest = canonical_source_state(selected_source_state)
    if selected_digest != policy.source_state_sha256 or len(selected["missing_sources"]) != policy.missing_count or len(selected["orphan_sources"]) != policy.orphan_count:
        raise ValidationError("SOURCE_POLICY_MISMATCH")
    if source.name != "source_images" or source.is_symlink() or not source.is_dir():
        raise ValidationError("SOURCE_ROOT_INVALID")
    with _connect(connect, host, profile.application_database, credentials) as app:
        rows = _all(app, "SELECT id::text AS row_id, stored_path, status FROM public.source_images ORDER BY id")
    db_rows: list[tuple[str, dict[str, Any]]] = []
    for row in rows:
        exact = set(row) == {"row_id", "stored_path", "status"}
        row_id, status = str(row.get("row_id", "")), unicodedata.normalize("NFC", str(row.get("status", "")))
        if not exact or re.fullmatch(r"[1-9][0-9]{0,18}", row_id) is None or len(status.encode("utf-8")) > 512:
            raise ValidationError("DATABASE_RESULT_INVALID")
        db_rows.append((_canonical_source_path(str(row["stored_path"])), {"row_id": row_id, "status": status}))
    files: dict[str, dict[str, Any]] = {}
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValidationError("SOURCE_SYMLINK_FORBIDDEN")
        if path.is_file():
            relative = "data/source_images/" + path.relative_to(source).as_posix()
            digest = hashlib.sha256()
            size = 0
            with path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    digest.update(chunk)
            files[relative] = {"size": size, "sha256": digest.hexdigest()}
    selected_by_identity = {(item["row_id"], item["status"], item["stored_path"]): item for item in selected["missing_sources"]}
    missing = []
    for path, row in db_rows:
        identity = (row["row_id"], row["status"], path)
        reviewed = selected_by_identity.get(identity)
        if reviewed is not None and reviewed["reason"] in {"unsafe_or_out_of_root", "duplicate_source_reference"}:
            missing.append(dict(reviewed))
        elif path not in files:
            derived = {"row_id": row["row_id"], "status": row["status"], "stored_path": path, "reason": "missing_source"}
            missing.append(dict(reviewed) if reviewed is not None and reviewed["reason"] == "missing_source" else derived)
    missing.sort(key=lambda item: (int(item["row_id"]), item["status"], item["stored_path"], item["reason"]))
    db_paths = {path for path, _ in db_rows}
    unexpected_orphans = [path for path in sorted(files) if path not in db_paths]
    # The selected canonical state is the reviewed expectation, not data to echo.
    # Validate every absent row's complete identity/status/path/reason internally and
    # expose only bounded counts and digests to the controller.
    if missing != selected["missing_sources"] or unexpected_orphans:
        raise ValidationError("SOURCE_POLICY_MISMATCH")
    source_files_sha256 = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    missing_sources_sha256 = hashlib.sha256(canonical_json(missing).encode("utf-8")).hexdigest()
    result = {"schema_version": 1, "operation": "validate-consistency", "success": True, "database_source_count": len(rows), "restored_file_count": len(files), "restored_total_bytes": sum(item["size"] for item in files.values()), "source_files_sha256": source_files_sha256, "missing_count": len(missing), "missing_sources_sha256": missing_sources_sha256, "unexpected_orphan_count": 0, "source_state_policy_sha256": policy.identity_sha256}
    _bounded_result(result)
    return result


def _bounded_result(value: dict[str, Any]) -> None:
    if len(canonical_json(value).encode()) > MAX_RESULT_BYTES:
        raise ValidationError("RESULT_TOO_LARGE")


def emit_result(value: dict[str, Any]) -> None:
    print(canonical_json(value), flush=True)
