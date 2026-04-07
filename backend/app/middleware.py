"""Request audit logging and correlation-ID middleware."""

import logging
import time
import uuid
from contextvars import ContextVar

from fastapi import Request, Response
from jose import jwt
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from .auth import auth_settings

logger = logging.getLogger(__name__)

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

            logger.info(
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
