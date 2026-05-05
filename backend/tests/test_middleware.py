"""Tests for the audit middleware and correlation-ID context."""

from unittest.mock import AsyncMock, MagicMock, patch

from app.middleware import (
    AuditMiddleware,
    MaintenanceMiddleware,
    _is_upload_path,
    _parse_content_length,
    _parse_exclude_prefixes,
    get_request_id,
    request_id_ctx,
)


# ── helpers ───────────────────────────────────────────────────────────────


def _make_scope(
    method: str = "GET",
    path: str = "/api/test",
    headers: dict[str, str] | None = None,
    client: tuple[str, int] | None = ("127.0.0.1", 0),
) -> dict:
    """Build a minimal ASGI HTTP scope."""
    raw_headers: list[tuple[bytes, bytes]] = []
    for k, v in (headers or {}).items():
        raw_headers.append((k.lower().encode("latin-1"), v.encode("latin-1")))
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": raw_headers,
    }
    if client is not None:
        scope["client"] = client
    return scope


async def _noop_receive() -> dict:
    return {"type": "http.request", "body": b""}


_captured_messages: list[dict] = []


async def _noop_send(message: dict) -> None:
    _captured_messages.append(message)


async def _invoke(
    middleware: AuditMiddleware | MaintenanceMiddleware,
    scope: dict,
    *,
    response_status: int = 200,
) -> list[dict]:
    """Call the middleware with a tiny inner ASGI app that sends a response."""
    captured: list[dict] = []

    async def inner_app(scope, receive, send):
        await send({"type": "http.response.start", "status": response_status, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    # Replace the middleware's inner app so responses are actually sent.
    middleware.app = inner_app

    async def capturing_send(message: dict) -> None:
        captured.append(message)

    await middleware(scope, _noop_receive, capturing_send)
    return captured


def _response_headers(messages: list[dict]) -> dict[str, str]:
    """Extract response headers from captured ASGI messages."""
    for msg in messages:
        if msg["type"] == "http.response.start":
            return {
                k.decode("latin-1"): v.decode("latin-1")
                for k, v in msg.get("headers", [])
            }
    return {}


# ── context var tests ─────────────────────────────────────────────────────


def test_get_request_id_returns_empty_string_by_default() -> None:
    token = request_id_ctx.set("")
    try:
        assert get_request_id() == ""
    finally:
        request_id_ctx.reset(token)


def test_get_request_id_returns_set_value() -> None:
    token = request_id_ctx.set("test-id-123")
    try:
        assert get_request_id() == "test-id-123"
    finally:
        request_id_ctx.reset(token)


# ── AuditMiddleware ──────────────────────────────────────────────────────


async def test_audit_generates_request_id() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(path="/api/health")

    messages = await _invoke(mw, scope)
    headers = _response_headers(messages)
    assert "x-request-id" in headers
    assert len(headers["x-request-id"]) > 0


async def test_audit_uses_client_supplied_request_id() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(headers={"X-Request-ID": "my-custom-id"})

    messages = await _invoke(mw, scope)
    headers = _response_headers(messages)
    assert headers["x-request-id"] == "my-custom-id"


async def test_audit_rejects_invalid_request_id() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(headers={"X-Request-ID": "x" * 200})

    messages = await _invoke(mw, scope)
    headers = _response_headers(messages)
    assert headers["x-request-id"] != "x" * 200


async def test_audit_uses_forwarded_for_ip() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(headers={"X-Forwarded-For": "1.2.3.4, 5.6.7.8"})

    with patch("app.middleware.logger") as mock_logger:
        await _invoke(mw, scope)
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert extra["client_ip"] == "1.2.3.4"


async def test_audit_extracts_session_id() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(headers={"X-Session-ID": "session-abc"})

    with patch("app.middleware.logger") as mock_logger:
        await _invoke(mw, scope)
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert extra["session_id"] == "session-abc"


async def test_audit_extracts_user_from_jwt() -> None:
    mw = AuditMiddleware(app=AsyncMock())

    from jose import jwt as jose_jwt
    token = jose_jwt.encode(
        {"sub": "42", "email": "test@example.com", "role": "admin"},
        "test-secret",
        algorithm="HS256",
    )
    scope = _make_scope(headers={"Authorization": f"Bearer {token}"})

    with patch("app.middleware.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with patch("app.middleware.logger") as mock_logger:
            await _invoke(mw, scope)
            call_args = mock_logger.info.call_args
            extra = call_args.kwargs.get("extra", {})
            assert extra["user_id"] == 42
            assert extra["user_email"] == "test@example.com"
            assert extra["user_role"] == "admin"


async def test_audit_handles_invalid_jwt_gracefully() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(headers={"Authorization": "Bearer invalid-token"})

    with patch("app.middleware.logger") as mock_logger:
        messages = await _invoke(mw, scope)
        headers = _response_headers(messages)
        # Should still succeed; invalid JWT just means no user info in logs
        for msg in messages:
            if msg["type"] == "http.response.start":
                assert msg["status"] == 200
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert "user_id" not in extra


async def test_audit_handles_no_client() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(client=None)

    with patch("app.middleware.logger") as mock_logger:
        await _invoke(mw, scope)
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert extra["client_ip"] == "unknown"


async def test_audit_handles_exception_in_inner_app() -> None:
    """Audit log is still emitted when the inner app raises."""
    async def failing_app(scope, receive, send):
        raise RuntimeError("boom")

    mw = AuditMiddleware(app=failing_app)
    scope = _make_scope()

    import pytest
    with pytest.raises(RuntimeError, match="boom"):
        with patch("app.middleware.logger"):
            await mw(scope, _noop_receive, _noop_send)


async def test_audit_logs_health_check_at_debug() -> None:
    """Health-check endpoints should be logged at DEBUG, not INFO."""
    mw = AuditMiddleware(app=AsyncMock())

    for path in ("/api/health", "/api/health/ready"):
        scope = _make_scope(path=path)
        with patch("app.middleware.logger") as mock_logger:
            await _invoke(mw, scope)
            mock_logger.debug.assert_called_once()
            mock_logger.info.assert_not_called()


async def test_audit_logs_non_health_at_info() -> None:
    """Non-health-check endpoints should still be logged at INFO."""
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(path="/api/images")

    with patch("app.middleware.logger") as mock_logger:
        await _invoke(mw, scope)
        mock_logger.info.assert_called_once()


async def test_audit_logs_numeric_content_length() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(
        method="POST",
        path="/api/admin/bulk-import/",
        headers={"content-length": "3607772528"},
    )

    with patch("app.middleware.logger") as mock_logger:
        await _invoke(mw, scope)
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert extra["content_length"] == 3607772528


async def test_audit_passes_through_non_http_scope() -> None:
    """Non-HTTP scopes (websocket, lifespan) are passed through untouched."""
    inner = AsyncMock()
    mw = AuditMiddleware(app=inner)
    scope = {"type": "lifespan"}

    await mw(scope, _noop_receive, _noop_send)
    inner.assert_called_once_with(scope, _noop_receive, _noop_send)


# ── helper function tests ────────────────────────────────────────────────


def test_parse_exclude_prefixes_strips_whitespace_and_blanks() -> None:
    assert _parse_exclude_prefixes("") == ()
    assert _parse_exclude_prefixes(" , , ") == ()
    assert _parse_exclude_prefixes("/a,/b") == ("/a", "/b")
    assert _parse_exclude_prefixes(" /a , /b , ") == ("/a", "/b")


def test_parse_content_length() -> None:
    assert _parse_content_length(None) is None
    assert _parse_content_length("") is None
    assert _parse_content_length("3607772528") == 3607772528
    assert _parse_content_length("unknown") == "unknown"


def test_is_upload_path() -> None:
    assert _is_upload_path("/api/source-images/upload")
    assert _is_upload_path("/api/admin/bulk-import/")
    assert _is_upload_path("/api/images/123/replace")
    assert not _is_upload_path("/api/images")


async def test_audit_logs_upload_start_for_upload_paths() -> None:
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(
        method="POST",
        path="/api/admin/bulk-import/",
        headers={"content-length": "3607772528"},
    )

    with patch("app.middleware.logger") as mock_logger:
        await _invoke(mw, scope)
        upload_call = mock_logger.info.call_args_list[0]
        extra = upload_call.kwargs.get("extra", {})
        assert extra["event"] == "http.upload_started"
        assert extra["content_length"] == 3607772528


async def test_audit_logs_tiles_at_debug() -> None:
    """Tile-serving endpoints match the default prefix list and log at DEBUG."""
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(path="/api/tiles/123/4/2/2.jpg")

    with patch("app.middleware._EXCLUDE_PREFIXES", ("/api/tiles/",)):
        with patch("app.middleware.logger") as mock_logger:
            await _invoke(mw, scope)
            mock_logger.debug.assert_called_once()
            mock_logger.info.assert_not_called()


async def test_audit_respects_configured_exclude_prefixes() -> None:
    """Paths not matching any configured prefix are still logged at INFO."""
    mw = AuditMiddleware(app=AsyncMock())
    scope = _make_scope(path="/api/images/42")

    with patch("app.middleware._EXCLUDE_PREFIXES", ("/api/tiles/", "/api/health")):
        with patch("app.middleware.logger") as mock_logger:
            await _invoke(mw, scope)
            mock_logger.info.assert_called_once()
            mock_logger.debug.assert_not_called()


# ── MaintenanceMiddleware ────────────────────────────────────────────────


async def test_maintenance_returns_503_when_active() -> None:
    mw = MaintenanceMiddleware(app=AsyncMock())
    scope = _make_scope(path="/api/images")

    with patch("app.middleware.is_maintenance_mode", return_value=True):
        messages = await _invoke(mw, scope)
        for msg in messages:
            if msg["type"] == "http.response.start":
                assert msg["status"] == 503


async def test_maintenance_allows_exempt_paths() -> None:
    mw = MaintenanceMiddleware(app=AsyncMock())

    for path in ("/api/health", "/api/status", "/api/admin/maintenance"):
        scope = _make_scope(path=path)
        with patch("app.middleware.is_maintenance_mode", return_value=True):
            messages = await _invoke(mw, scope)
            for msg in messages:
                if msg["type"] == "http.response.start":
                    assert msg["status"] == 200


async def test_maintenance_passes_through_when_inactive() -> None:
    mw = MaintenanceMiddleware(app=AsyncMock())
    scope = _make_scope(path="/api/images")

    with patch("app.middleware.is_maintenance_mode", return_value=False):
        messages = await _invoke(mw, scope)
        for msg in messages:
            if msg["type"] == "http.response.start":
                assert msg["status"] == 200


async def test_maintenance_passes_through_non_http_scope() -> None:
    """Non-HTTP scopes are passed through untouched."""
    inner = AsyncMock()
    mw = MaintenanceMiddleware(app=inner)
    scope = {"type": "lifespan"}

    await mw(scope, _noop_receive, _noop_send)
    inner.assert_called_once_with(scope, _noop_receive, _noop_send)
