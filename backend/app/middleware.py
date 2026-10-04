"""Request audit logging, correlation-ID, and maintenance-mode middleware.

These are implemented as pure ASGI middleware (not ``BaseHTTPMiddleware``)
so that request bodies are **never buffered in memory**.  This is critical
for large image uploads (1 GB+) where ``BaseHTTPMiddleware`` would hold
the entire body in RAM before the streaming-to-disk handler runs.
"""

import asyncio
import contextlib
import logging
import os
import re
import time
import uuid
from contextvars import ContextVar

import jwt
from opentelemetry import metrics, trace
from python_multipart.multipart import parse_options_header
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .auth import auth_settings
from .database import settings
from .image_validation import UPLOAD_MAX_BYTES
from .maintenance import is_maintenance_mode
from .task_constants import (
    BULK_IMPORT_MAX_REQUEST_BYTES,
    BULK_IMPORT_MAX_UPLOAD_BYTES,
)
from .upload_staging import UPLOAD_SPOOL_DIR_NAME

logger = logging.getLogger(__name__)
_meter = metrics.get_meter(__name__)

_tile_request_counter = _meter.create_counter(
    "hriv.tile.requests",
    description="Number of tile-delivery HTTP responses",
    unit="1",
)
_tile_error_counter = _meter.create_counter(
    "hriv.tile.errors",
    description="Number of tile-delivery HTTP responses classified as errors",
    unit="1",
)
_tile_duration_histogram = _meter.create_histogram(
    "hriv.tile.response.duration",
    description="Duration of tile-delivery HTTP responses",
    unit="s",
)
_tile_response_size_histogram = _meter.create_histogram(
    "hriv.tile.response.size",
    description="Response size of tile-delivery HTTP responses",
    unit="By",
)

_UUID_PATH_SEGMENT = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_TILE_DZI_ROUTE = re.compile(r"/api/tiles/[0-9]+/image\.dzi")
_TILE_THUMBNAIL_ROUTE = re.compile(r"/api/tiles/[0-9]+/thumbnail\.[A-Za-z0-9]+")
_TILE_IMAGE_FILE_ROUTE = re.compile(
    r"/api/tiles/[0-9]+/image_files/[0-9]+/[0-9]+_[0-9]+\.[A-Za-z0-9]+"
)
_IMAGE_REPLACE_ROUTE = re.compile(r"/api/images/[0-9]+/replace")
_ADMIN_TASK_UPLOAD_ROUTE = re.compile(r"/api/admin/tasks/[^/]+/upload(?:/finalize)?")
_CATCH_ALL_ROUTE_PARAM = re.compile(r"\{[^/{}:]+:path\}")
_TILE_METRIC_ROUTES = frozenset({
    "/api/tiles/{image_id}/image.dzi",
    "/api/tiles/{image_id}/thumbnail.{format}",
    "/api/tiles/{image_id}/image_files/{level}/{col}_{row}.{format}",
})


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


def _is_tile_route(route: str) -> bool:
    return route in _TILE_METRIC_ROUTES


def _status_class(status_code: int) -> str:
    if 100 <= status_code <= 599:
        return f"{status_code // 100}xx"
    return "other"


def _tile_outcome(status_code: int) -> str:
    if status_code == 404:
        return "not_found"
    if status_code in {401, 403}:
        return "access_denied"
    if 400 <= status_code <= 499:
        return "client_error"
    if 500 <= status_code <= 599:
        return "server_error"
    return "success"


def _record_tile_metrics(
    *,
    method: str,
    route: str,
    status_code: int,
    duration_s: float,
    response_size_bytes: int,
) -> None:
    if not _is_tile_route(route):
        return

    attrs = {
        "http.method": method,
        "http.route": route,
        "http.status_code": status_code,
        "status_class": _status_class(status_code),
        "outcome": _tile_outcome(status_code),
    }
    _tile_request_counter.add(1, attrs)
    _tile_duration_histogram.record(duration_s, attrs)
    _tile_response_size_histogram.record(response_size_bytes, attrs)
    if status_code >= 400:
        _tile_error_counter.add(1, attrs)


def _normalize_path_fallback(path: str) -> str:
    """Normalize a raw URL path when no framework route template is available.

    This fallback is intentionally conservative: generic segment rewriting only
    covers purely numeric ids and UUIDs. Routes that introduce other dynamic
    high-cardinality segments should add an explicit normalization rule above
    rather than broadening the heuristic and risking false positives for stable
    literals such as ``db-import``.
    """
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
        if _is_ascii_numeric_segment(segment) or _UUID_PATH_SEGMENT.fullmatch(segment):
            normalized_segments.append("{id}")
        else:
            normalized_segments.append(segment)
    return "/".join(normalized_segments) or "/"


def _is_ascii_numeric_segment(segment: str) -> bool:
    """Return True only for non-empty ASCII decimal path segments."""
    return bool(segment) and segment.isascii() and segment.isdecimal()


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


def get_client_ip(scope: Scope, trusted_proxy_hops: int | None = None) -> str:
    """Real client IP from an ASGI scope, resolved at the trusted-proxy boundary.

    Every reverse proxy in front of the backend *appends* its downstream
    peer to ``X-Forwarded-For`` (nginx ``$proxy_add_x_forwarded_for``), so
    the leftmost entry is whatever the original client sent and must never be
    trusted. With ``trusted_proxy_hops`` = N (``TRUSTED_PROXY_HOPS``, default
    1 for the frontend nginx alone), the N-th entry from the right is the
    address recorded by the outermost trusted proxy. When the header is
    missing or has fewer entries than expected, ``X-Real-IP`` (nginx
    ``$remote_addr``) is used, then the direct connection address. With
    N = 0 forwarding headers are ignored entirely.
    """
    hops = (
        settings.trusted_proxy_hops if trusted_proxy_hops is None else trusted_proxy_hops
    )
    if hops > 0:
        forwarded_for = _header_value(scope, b"x-forwarded-for")
        entries = [e.strip() for e in forwarded_for.split(",") if e.strip()]
        if len(entries) >= hops:
            return entries[-hops]
        real_ip = _header_value(scope, b"x-real-ip").strip()
        if real_ip:
            return real_ip
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
        response_size_bytes = 0

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, response_size_bytes
            if message["type"] == "http.response.start":
                status_code = message["status"]
                # Inject X-Request-ID into the response headers
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", req_id.encode("latin-1")))
                message = {**message, "headers": headers}
            elif message["type"] == "http.response.body":
                response_size_bytes += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            raise
        finally:
            duration_s = time.monotonic() - start
            duration_ms = round(duration_s * 1000)
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

            _record_tile_metrics(
                method=method,
                route=route,
                status_code=status_code,
                duration_s=duration_s,
                response_size_bytes=response_size_bytes,
            )

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
    "/api/_probe",
    "/api/status",
    "/api/metrics",
    "/api/admin/maintenance",
    # Synthetic result ingestion must stay reachable during maintenance so
    # the monitor can publish its (typically failing) journey result instead
    # of leaving Prometheus on a stale previous run. The endpoint enforces
    # its own credential — exemption only skips the maintenance 503 (#1495).
    "/api/telemetry/synthetic-result",
)


class CollectionsFeatureMiddleware:
    """Return 404 for every ``/api/collections`` request while the
    ``COLLECTIONS_ENABLED`` dark-launch flag is off.

    Runs before FastAPI parses the request body, so a disabled deployment
    answers a malformed collection write with the same 404 as an unknown
    route rather than a 422 (docs/collections.md). The router keeps its own
    ``require_collections_enabled`` dependency as a second layer.
    """

    _PREFIX = "/api/collections"

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope["path"]
        if not settings.collections_enabled and (
            path == self._PREFIX or path.startswith(self._PREFIX + "/")
        ):
            response = JSONResponse(status_code=404, content={"detail": "Not Found"})
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


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


# ── Upload body limits (#1432) ───────────────────────────────────────────
# python-multipart streams each uploaded part into a SpooledTemporaryFile
# on pod-local temp storage *before* the endpoint runs, so per-file caps
# inside the handlers cannot stop an oversized request body from
# exhausting the pod's ephemeral-storage budget first. This middleware
# counts the streamed request bytes and answers 413 the moment a cap is
# crossed — including chunked requests, which a Content-Length pre-check
# cannot see. The handler-side caps remain as a second layer.

# Multipart boundary strings, part headers, and non-file form fields ride
# inside the same request body as the capped file part. The middleware's
# per-part counter also absorbs each part's header block, so it gets the
# same slack the endpoint read loops do not need.
_MULTIPART_OVERHEAD_BYTES = 1024 * 1024


def _upload_body_limits(path: str) -> tuple[int, int] | None:
    """Return ``(per-part cap, whole-request cap)`` for an upload path.

    ``None`` means the path is not a capped multipart upload route. The
    per-part cap mirrors the endpoint's per-file limit (plus framing
    slack); the request cap is the absolute spool bound for the whole
    body — on the bulk-import route a valid batch is a *list* of parts
    whose sum legitimately exceeds the per-part cap, so it gets its own
    ``BULK_IMPORT_MAX_REQUEST_BYTES`` ceiling.
    """
    if path == "/api/source-images/upload" or _IMAGE_REPLACE_ROUTE.fullmatch(
        path
    ):
        limit = UPLOAD_MAX_BYTES + _MULTIPART_OVERHEAD_BYTES
        return limit, limit
    if path.startswith("/api/admin/bulk-import"):
        return (
            BULK_IMPORT_MAX_UPLOAD_BYTES + _MULTIPART_OVERHEAD_BYTES,
            BULK_IMPORT_MAX_REQUEST_BYTES + _MULTIPART_OVERHEAD_BYTES,
        )
    return None


def _multipart_boundary(scope: Scope) -> bytes | None:
    """Extract the multipart boundary parameter, if this is a multipart body.

    Uses the same ``parse_options_header`` Starlette's MultipartParser
    does, so quoted boundaries (including ones containing ``;``) are
    interpreted identically to the parser being guarded.
    """
    content_type = _header_value(scope, b"content-type")
    if not content_type.lower().startswith("multipart/"):
        return None
    _maintype, params = parse_options_header(content_type.encode("latin-1"))
    boundary = params.get(b"boundary")
    return boundary[:256] if boundary else None


def _upload_body_limit_detail(path: str, per_part: bool) -> str:
    if path.startswith("/api/admin/bulk-import"):
        if per_part:
            return (
                "File exceeds the per-file size limit of "
                f"{BULK_IMPORT_MAX_UPLOAD_BYTES / (1024 ** 3):g} GiB"
            )
        return (
            "Bulk import request exceeds the size limit of "
            f"{BULK_IMPORT_MAX_REQUEST_BYTES / (1024 ** 3):g} GiB"
        )
    return (
        "File exceeds the per-upload size limit of "
        f"{UPLOAD_MAX_BYTES / (1024 ** 3):g} GiB"
    )


class UploadBodyLimitMiddleware:
    """Answer 413 for oversized upload bodies while they stream (#1432).

    Pure ASGI (no buffering): a declared ``Content-Length`` over the
    request cap is rejected without reading the body, and a streamed body
    is aborted mid-request — the downstream app sees a client disconnect
    and stops parsing, so nothing more reaches the temp spool.

    Two counters run over the streamed bytes:

    - *per-part*: bytes since the last ``--boundary`` delimiter, enforcing
      the same per-file cap the endpoint applies, so a batch of
      individually valid files is not rejected for its combined size;
    - *whole-request*: every byte of the body, enforcing the route's
      spool bound (``BULK_IMPORT_MAX_REQUEST_BYTES`` on bulk import,
      where a batch may carry many parts; the per-part cap plus 1 MiB of
      framing slack on the single-file routes).

    A delimiter forged inside file content only under-counts the forged
    part — the endpoint's own read-loop cap still applies, so the
    middleware stays a protective layer, not the semantic one.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return

        limits = _upload_body_limits(scope["path"])
        if limits is None:
            await self.app(scope, receive, send)
            return
        part_limit, request_limit = limits

        # TMPDIR points inside the source-images tree and a filesystem
        # import can replace that tree wholesale, so ensure the spool dir
        # exists before the parser's first tempfile rollover needs it
        # (#1365). If it truly cannot be created the subsequent spool
        # fails the request anyway, so a failure here is not fatal.
        with contextlib.suppress(OSError):
            await asyncio.to_thread(
                os.makedirs,
                os.path.join(
                    settings.source_images_dir, UPLOAD_SPOOL_DIR_NAME
                ),
                exist_ok=True,
            )

        part_detail = _upload_body_limit_detail(scope["path"], per_part=True)
        request_detail = _upload_body_limit_detail(scope["path"], per_part=False)

        # Fast path: a declared Content-Length over the request cap never
        # reads a single body byte.
        declared = _parse_content_length(
            _header_value(scope, b"content-length") or None
        )
        if isinstance(declared, int) and declared > request_limit:
            await JSONResponse(
                status_code=413, content={"detail": request_detail}
            )(scope, receive, send)
            return

        # Per RFC 2046 part delimiters are CRLF + "--" + boundary; the
        # body's first delimiter has no CRLF, so seeding `tail` with one
        # makes the opening "--boundary" match the same pattern. `tail`
        # keeps the trailing bytes of the previous chunk so a delimiter
        # split across message chunks is still found.
        boundary = _multipart_boundary(scope)
        delimiter = b"\r\n--" + boundary if boundary else None
        tail = b"\r\n" if boundary else b""
        # Absolute stream offset where the in-progress part began.
        part_start = 0
        received = 0
        answered = False

        async def limited_receive() -> Message:
            nonlocal received, part_start, tail, answered
            if answered:
                # The connection is dead from the app's perspective once
                # we have answered; never touch the real channel again.
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] != "http.request":
                return message

            body = message.get("body", b"")
            received += len(body)
            detail = request_detail if received > request_limit else None

            if delimiter is not None and detail is None:
                window = tail + body
                base = received - len(window)  # absolute offset of window[0]
                pos = 0
                while True:
                    idx = window.find(delimiter, pos)
                    if idx < 0:
                        break
                    # The bytes this delimiter closes belong to the
                    # current part; a new part starts after it.
                    if base + idx - part_start > part_limit:
                        detail = part_detail
                        break
                    part_start = base + idx + len(delimiter)
                    pos = idx + len(delimiter)
                if detail is None and received - part_start > part_limit:
                    detail = part_detail
                tail = window[-(len(delimiter) - 1) :]
            elif delimiter is None and detail is None:
                # Non-multipart bodies have no parts to separate; the
                # whole body counts as a single part.
                if received > part_limit:
                    detail = part_detail

            if detail is not None:
                answered = True
                await JSONResponse(
                    status_code=413, content={"detail": detail}
                )(scope, receive, send)
                return {"type": "http.disconnect"}
            return message

        async def limited_send(message: Message) -> None:
            # Once we have answered, drop whatever response the
            # disconnected downstream app tries to send.
            if answered:
                return
            await send(message)

        await self.app(scope, limited_receive, limited_send)
