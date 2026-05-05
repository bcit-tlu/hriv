"""Request audit logging, correlation-ID, and maintenance-mode middleware."""

import logging
import time
import uuid
from contextvars import ContextVar

from fastapi import Request, Response
from jose import jwt
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse

from .auth import auth_settings
from .database import settings
from .maintenance import is_maintenance_mode

logger = logging.getLogger(__name__)


def _parse_exclude_prefixes(raw: str) -> tuple[str, ...]:
    """Normalise a comma-separated path-prefix list into a tuple."""
    return tuple(p.strip() for p in raw.split(",") if p.strip())


def _parse_content_length(raw: str | None) -> int | str | None:
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return raw


def _is_upload_path(path: str) -> bool:
    return (
        path == "/api/source-images/upload"
        or path.startswith("/api/admin/bulk-import")
        or path in {"/api/admin/tasks/db-import", "/api/admin/tasks/files-import"}
        or (path.startswith("/api/images/") and path.endswith("/replace"))
    )


# Snapshot the configured prefixes at import time so the per-request
# comparison is a single tuple-membership walk rather than a re-parse
# of the env var on every call.
_EXCLUDE_PREFIXES: tuple[str, ...] = _parse_exclude_prefixes(
    settings.audit_exclude_prefixes
)

# ── Correlation ID context ──────────────────────────────
# Available to any code running within the same async task so that downstream
# log calls can include the request's correlation ID automatically.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")


def get_request_id() -> str:
    """Return the correlation ID for the current request, or empty string."""
    return request_id_ctx.get()


# ── Audit middleware ────────────────────────────────────

class AuditMiddleware(BaseHTTPMiddleware):
    """Log every HTTP request with correlation ID, client info, and timing.

    Emits a structured JSON log line at the end of every request containing:
    - ``request_id``: UUID correlation ID (generated or forwarded from
      ``X-Request-ID`` header)
    - ``client_ip``: best-effort client IP (respects ``X-Forwarded-For``)
    - ``session_id``: browser tab fingerprint from ``X-Session-ID`` header
      (useful for distinguishing users sharing the same account)
    - ``user_id`` / ``user_email`` / ``user_role``: extracted from the JWT
      bearer token when present (no DB lookup — purely from token claims)
    - ``method``, ``path``, ``status``, ``duration_ms``: standard HTTP fields
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Generate or accept correlation ID (validate client-supplied values
        # to prevent log injection / bloat via oversized or non-alphanumeric IDs)
        raw_id = request.headers.get("X-Request-ID") or ""
        req_id = (
            raw_id
            if raw_id and len(raw_id) <= 128 and raw_id.replace("-", "").isalnum()
            else uuid.uuid4().hex
        )
        request_id_ctx.set(req_id)

        start = time.monotonic()
        status_code = 500  # default if call_next raises
        response: Response | None = None
        path = request.url.path
        content_length = _parse_content_length(request.headers.get("content-length"))
        if request.method in {"POST", "PUT", "PATCH"} and _is_upload_path(path):
            extra: dict[str, object] = {
                "event": "http.upload_started",
                "request_id": req_id,
                "method": request.method,
                "path": path,
            }
            if content_length is not None:
                extra["content_length"] = content_length
            logger.info(
                "%s %s upload started",
                request.method,
                path,
                extra=extra,
            )
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception:
            # Ensure audit log is still emitted for unhandled errors, then
            # re-raise so Starlette's ServerErrorMiddleware returns a 500.
            raise
        finally:
            duration_ms = round((time.monotonic() - start) * 1000)

            # Best-effort client IP (respect reverse proxy header)
            forwarded_for = request.headers.get("X-Forwarded-For")
            client_ip = (
                forwarded_for.split(",")[0].strip()
                if forwarded_for
                else (request.client.host if request.client else "unknown")
            )

            # Browser tab fingerprint (set by frontend) — validate like X-Request-ID
            raw_session_id = request.headers.get("X-Session-ID") or ""
            session_id = (
                raw_session_id
                if raw_session_id and len(raw_session_id) <= 128 and raw_session_id.replace("-", "").isalnum()
                else ""
            )

            # Extract user identity from JWT (no DB hit)
            user_id: int | None = None
            user_email: str | None = None
            user_role: str | None = None
            auth_header = request.headers.get("Authorization") or ""
            if auth_header.startswith("Bearer "):
                try:
                    # Skip expiry check so we still capture identity for
                    # expired-but-validly-signed tokens in the audit trail.
                    payload = jwt.decode(
                        auth_header[7:],
                        auth_settings.jwt_secret,
                        algorithms=[auth_settings.jwt_algorithm],
                        options={"verify_exp": False},
                    )
                    sub = payload.get("sub")
                    if sub is not None:
                        user_id = int(sub)
                    user_email = payload.get("email")
                    user_role = payload.get("role")
                except Exception:
                    pass  # invalid/malformed token — skip identity fields

            extra: dict[str, object] = {
                "event": "http.request",
                "request_id": req_id,
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
                "duration_ms": duration_ms,
                "client_ip": client_ip,
            }
            if session_id:
                extra["session_id"] = session_id
            if user_id is not None:
                extra["user_id"] = user_id
            if user_email:
                extra["user_email"] = user_email
            if user_role:
                extra["user_role"] = user_role

            if content_length is not None:
                extra["content_length"] = content_length

            # High-volume, low-signal endpoints (container healthchecks,
            # tile serving, …) are logged at DEBUG to keep local-dev and
            # production audit logs free of noise. DEBUG is below the
            # default INFO threshold so they won't appear unless explicitly
            # enabled. The list is configurable via AUDIT_EXCLUDE_PREFIXES.
            is_excluded = any(path.startswith(p) for p in _EXCLUDE_PREFIXES)
            _log = logger.debug if is_excluded else logger.info
            _log(
                "%s %s %s %dms",
                request.method,
                request.url.path,
                status_code,
                duration_ms,
                extra=extra,
            )

        # Echo correlation ID back to the client
        if response is not None:
            response.headers["X-Request-ID"] = req_id
        return response  # type: ignore[return-value]


# ── Maintenance-mode middleware ─────────────────────────

# Paths that must remain reachable during a restore so that health
# probes, the status endpoint, and the maintenance toggle keep working.
_MAINTENANCE_EXEMPT: tuple[str, ...] = (
    "/api/health",
    "/api/status",
    "/api/admin/maintenance",
)


class MaintenanceMiddleware(BaseHTTPMiddleware):
    """Return 503 for non-exempt endpoints when the maintenance flag is set."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if is_maintenance_mode():
            path = request.url.path
            if not any(path.startswith(p) for p in _MAINTENANCE_EXEMPT):
                return JSONResponse(
                    status_code=503,
                    content={
                        "detail": "The application is undergoing maintenance. Please try again shortly.",
                        "maintenance": True,
                    },
                )
        return await call_next(request)
