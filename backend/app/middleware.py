"""Request audit logging, correlation-ID, and maintenance-mode middleware.

These are implemented as pure ASGI middleware (not ``BaseHTTPMiddleware``)
so that request bodies are **never buffered in memory**.  This is critical
for large image uploads (1 GB+) where ``BaseHTTPMiddleware`` would hold
the entire body in RAM before the streaming-to-disk handler runs.
"""

import logging
import time
import uuid
from contextvars import ContextVar

from jose import jwt
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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


def _header_value(scope: Scope, name: bytes) -> str:
    """Extract a single header value from an ASGI scope (case-insensitive)."""
    for key, value in scope.get("headers", []):
        if key.lower() == name:
            return value.decode("latin-1")
    return ""


# ── Audit middleware ────────────────────────────────────

class AuditMiddleware:
    """Log every HTTP request with correlation ID, client info, and timing.

    Implemented as a pure ASGI middleware to avoid body buffering.  The
    ``receive`` callable is passed through untouched — only ``send`` is
    wrapped to capture the response status code and inject the
    ``X-Request-ID`` response header.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope["path"]

        # Generate or accept correlation ID (validate client-supplied values
        # to prevent log injection / bloat via oversized or non-alphanumeric IDs)
        raw_id = _header_value(scope, b"x-request-id")
        req_id = (
            raw_id
            if raw_id and len(raw_id) <= 128 and raw_id.replace("-", "").isalnum()
            else uuid.uuid4().hex
        )
        request_id_ctx.set(req_id)

        method: str = scope["method"]
        content_length = _parse_content_length(
            _header_value(scope, b"content-length") or None,
        )

        if method in {"POST", "PUT", "PATCH"} and _is_upload_path(path):
            extra: dict[str, object] = {
                "event": "http.upload_started",
                "request_id": req_id,
                "method": method,
                "path": path,
            }
            if content_length is not None:
                extra["content_length"] = content_length
            logger.info("%s %s upload started", method, path, extra=extra)

        start = time.monotonic()
        status_code = 500  # default if the inner app raises

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                # Inject X-Request-ID into the response headers
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", req_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            raise
        finally:
            duration_ms = round((time.monotonic() - start) * 1000)

            # Best-effort client IP (respect reverse proxy header)
            forwarded_for = _header_value(scope, b"x-forwarded-for")
            if forwarded_for:
                client_ip = forwarded_for.split(",")[0].strip()
            else:
                client_pair = scope.get("client")
                client_ip = client_pair[0] if client_pair else "unknown"

            # Browser tab fingerprint (set by frontend) — validate like X-Request-ID
            raw_session_id = _header_value(scope, b"x-session-id")
            session_id = (
                raw_session_id
                if raw_session_id and len(raw_session_id) <= 128 and raw_session_id.replace("-", "").isalnum()
                else ""
            )

            # Extract user identity from JWT (no DB hit)
            user_id: int | None = None
            user_email: str | None = None
            user_role: str | None = None
            auth_header = _header_value(scope, b"authorization")
            if auth_header.startswith("Bearer "):
                try:
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

            log_extra: dict[str, object] = {
                "event": "http.request",
                "request_id": req_id,
                "method": method,
                "path": path,
                "status": status_code,
                "duration_ms": duration_ms,
                "client_ip": client_ip,
            }
            if session_id:
                log_extra["session_id"] = session_id
            if user_id is not None:
                log_extra["user_id"] = user_id
            if user_email:
                log_extra["user_email"] = user_email
            if user_role:
                log_extra["user_role"] = user_role

            if content_length is not None:
                log_extra["content_length"] = content_length

            is_excluded = any(path.startswith(p) for p in _EXCLUDE_PREFIXES)
            _log = logger.debug if is_excluded else logger.info
            _log(
                "%s %s %s %dms",
                method,
                path,
                status_code,
                duration_ms,
                extra=log_extra,
            )


# ── Maintenance-mode middleware ─────────────────────────

# Paths that must remain reachable during a restore so that health
# probes, the status endpoint, and the maintenance toggle keep working.
_MAINTENANCE_EXEMPT: tuple[str, ...] = (
    "/api/health",
    "/api/status",
    "/api/admin/maintenance",
)


class MaintenanceMiddleware:
    """Return 503 for non-exempt endpoints when the maintenance flag is set.

    Pure ASGI implementation — does not buffer request bodies.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if is_maintenance_mode():
            path: str = scope["path"]
            if not any(path.startswith(p) for p in _MAINTENANCE_EXEMPT):
                response = JSONResponse(
                    status_code=503,
                    content={
                        "detail": "The application is undergoing maintenance. Please try again shortly.",
                        "maintenance": True,
                    },
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)
