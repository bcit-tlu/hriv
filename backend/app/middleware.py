"""Request audit logging, correlation-ID, and maintenance-mode middleware.

These are implemented as pure ASGI middleware (not ``BaseHTTPMiddleware``)
so that request bodies are **never buffered in memory**.  This is critical
for large image uploads (1 GB+) where ``BaseHTTPMiddleware`` would hold
the entire body in RAM before the streaming-to-disk handler runs.
"""

import logging
import re
import time
import uuid
from contextvars import ContextVar

from jose import jwt
from opentelemetry import trace
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .auth import auth_settings
from .database import settings
from .maintenance import is_maintenance_mode

logger = logging.getLogger(__name__)

_UUID_PATH_SEGMENT = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_TILE_DZI_ROUTE = re.compile(r"/api/tiles/\d+/image\.dzi")
_TILE_THUMBNAIL_ROUTE = re.compile(r"/api/tiles/\d+/thumbnail\.[A-Za-z0-9]+")
_TILE_IMAGE_FILE_ROUTE = re.compile(
    r"/api/tiles/\d+/image_files/\d+/\d+_\d+\.[A-Za-z0-9]+"
)
_IMAGE_REPLACE_ROUTE = re.compile(r"/api/images/\d+/replace")
_ADMIN_TASK_UPLOAD_ROUTE = re.compile(r"/api/admin/tasks/[^/]+/upload(?:/finalize)?")
_CATCH_ALL_ROUTE_PARAM = re.compile(r"\{[^/{}:]+:path\}")


def _parse_exclude_prefixes(raw: str) -> tuple[str, ...]:
    """Normalise a comma-separated path-prefix list into a tuple."""
    return tuple(p.strip() for p in raw.split(",") if p.strip())


def _path_matches_excluded(path: str, prefix: str) -> bool:
    """Return True if ``path`` is covered by an audit-exclude prefix.

    Prefixes that end with ``/`` are treated as directory prefixes.
    Prefixes without a trailing slash match the exact path or the path plus a
    ``/`` sub-path, but do not match sibling paths that merely start with the
    same characters (e.g. ``/api/metrics`` must not match ``/api/metrics_custom``).
    """
    if prefix.endswith("/"):
        return path.startswith(prefix)
    return path == prefix or path.startswith(prefix + "/")


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
        or (path.startswith("/api/admin/tasks/") and path.endswith("/upload"))
        or (path.startswith("/api/images/") and path.endswith("/replace"))
    )


def _normalize_path_fallback(path: str) -> str:
    """Normalize a raw URL path when no framework route template is available."""
    if _TILE_DZI_ROUTE.fullmatch(path):
        return "/api/tiles/{image_id}/image.dzi"
    if _TILE_THUMBNAIL_ROUTE.fullmatch(path):
        return "/api/tiles/{image_id}/thumbnail.{format}"
    if _TILE_IMAGE_FILE_ROUTE.fullmatch(path):
        return "/api/tiles/{image_id}/image_files/{level}/{col}_{row}.{format}"
    if _IMAGE_REPLACE_ROUTE.fullmatch(path):
        return "/api/images/{image_id}/replace"
    if _ADMIN_TASK_UPLOAD_ROUTE.fullmatch(path):
        if path.endswith("/finalize"):
            return "/api/admin/tasks/{task_id}/upload/finalize"
        return "/api/admin/tasks/{task_id}/upload"

    normalized_segments: list[str] = []
    for segment in path.split("/"):
        if segment.isdigit() or _UUID_PATH_SEGMENT.fullmatch(segment):
            normalized_segments.append("{id}")
        else:
            normalized_segments.append(segment)
    return "/".join(normalized_segments) or "/"


def normalize_http_route(scope: Scope) -> str:
    """Return a low-cardinality route template for the current request.

    Prefer the framework-provided route template when available. Mounted static
    paths such as tile delivery do not provide one, so apply explicit
    normalization rules there and fall back to replacing numeric/UUID-like path
    segments with ``{id}``.
    """
    route = scope.get("route")
    route_path = getattr(route, "path", None)
    # Starlette ``Mount`` routes can surface a catch-all template such as
    # ``/api/tiles/{path:path}`` or ``/api/files/{filepath:path}``, which is
    # less descriptive than the explicit path rules below. Prefer the fallback
    # normalization for any catch-all ``:path`` mount template.
    if (
        isinstance(route_path, str)
        and route_path
        and _CATCH_ALL_ROUTE_PARAM.search(route_path) is None
    ):
        return route_path

    return _normalize_path_fallback(scope["path"])


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


def get_client_ip(scope: Scope) -> str:
    """Best-effort real client IP from an ASGI scope.

    Checks ``X-Forwarded-For`` (leftmost entry) first, then ``X-Real-IP``,
    and finally falls back to the direct connection address.
    """
    forwarded_for = _header_value(scope, b"x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = _header_value(scope, b"x-real-ip")
    if real_ip:
        return real_ip.strip()
    client_pair = scope.get("client")
    return client_pair[0] if client_pair else "unknown"


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
            upload_route = _normalize_path_fallback(path)
            extra: dict[str, object] = {
                "event": "http.upload_started",
                "request_id": req_id,
                "method": method,
                "path": path,
                "route": upload_route,
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
            route = normalize_http_route(scope)

            client_ip = get_client_ip(scope)

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
                "route": route,
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

            # Propagate identity and correlation IDs to the current
            # OTEL span so distributed traces carry user context.
            span = trace.get_current_span()
            if span.is_recording():
                span.set_attribute("http.route", route)
                span.set_attribute("request.id", req_id)
                if session_id:
                    span.set_attribute("session.id", session_id)
                if user_id is not None:
                    span.set_attribute("enduser.id", user_id)
                if user_role:
                    span.set_attribute("enduser.role", user_role)

            is_excluded = any(_path_matches_excluded(path, p) for p in _EXCLUDE_PREFIXES)
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
# probes, the status endpoint, metrics scraping, and the maintenance toggle
# keep working.
_MAINTENANCE_EXEMPT: tuple[str, ...] = (
    "/api/health",
    "/api/status",
    "/api/metrics",
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
            if not any(_path_matches_excluded(path, p) for p in _MAINTENANCE_EXEMPT):
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
