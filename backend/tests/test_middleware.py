"""Tests for the audit middleware and correlation-ID context."""

from unittest.mock import AsyncMock, MagicMock, patch

from app.middleware import (
    AuditMiddleware,
    _is_upload_path,
    _parse_content_length,
    _parse_exclude_prefixes,
    get_request_id,
    request_id_ctx,
)


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


async def test_dispatch_generates_request_id() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {}
    request.method = "GET"
    request.url.path = "/api/health"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    response = await middleware.dispatch(request, call_next)
    assert "X-Request-ID" in response.headers


async def test_dispatch_uses_client_supplied_request_id() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {"X-Request-ID": "my-custom-id"}
    request.method = "GET"
    request.url.path = "/api/test"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    response = await middleware.dispatch(request, call_next)
    assert response.headers["X-Request-ID"] == "my-custom-id"


async def test_dispatch_rejects_invalid_request_id() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    # Oversized ID should be rejected
    request.headers = {"X-Request-ID": "x" * 200}
    request.method = "GET"
    request.url.path = "/api/test"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    response = await middleware.dispatch(request, call_next)
    # Should have generated a new ID, not the oversized one
    assert response.headers["X-Request-ID"] != "x" * 200


async def test_dispatch_uses_forwarded_for_ip() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    captured_extra = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {"X-Forwarded-For": "1.2.3.4, 5.6.7.8"}
    request.method = "GET"
    request.url.path = "/api/test"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware.logger") as mock_logger:
        await middleware.dispatch(request, call_next)
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert extra["client_ip"] == "1.2.3.4"


async def test_dispatch_extracts_session_id() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {"X-Session-ID": "session-abc"}
    request.method = "GET"
    request.url.path = "/api/test"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware.logger") as mock_logger:
        await middleware.dispatch(request, call_next)
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert extra["session_id"] == "session-abc"


async def test_dispatch_extracts_user_from_jwt() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    # Create a valid JWT for testing
    from jose import jwt as jose_jwt
    token = jose_jwt.encode(
        {"sub": "42", "email": "test@example.com", "role": "admin"},
        "test-secret",
        algorithm="HS256",
    )

    request = MagicMock()
    request.headers = {"Authorization": f"Bearer {token}"}
    request.method = "GET"
    request.url.path = "/api/test"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with patch("app.middleware.logger") as mock_logger:
            await middleware.dispatch(request, call_next)
            call_args = mock_logger.info.call_args
            extra = call_args.kwargs.get("extra", {})
            assert extra["user_id"] == 42
            assert extra["user_email"] == "test@example.com"
            assert extra["user_role"] == "admin"


async def test_dispatch_handles_invalid_jwt_gracefully() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {"Authorization": "Bearer invalid-token"}
    request.method = "GET"
    request.url.path = "/api/test"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware.logger") as mock_logger:
        response = await middleware.dispatch(request, call_next)
        # Should still succeed; invalid JWT just means no user info in logs
        assert response.status_code == 200
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert "user_id" not in extra


async def test_dispatch_handles_no_client() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {}
    request.method = "GET"
    request.url.path = "/api/test"
    request.client = None

    with patch("app.middleware.logger") as mock_logger:
        await middleware.dispatch(request, call_next)
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert extra["client_ip"] == "unknown"


async def test_dispatch_handles_exception_in_call_next() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    async def call_next(request):
        raise RuntimeError("boom")

    request = MagicMock()
    request.headers = {}
    request.method = "GET"
    request.url.path = "/api/test"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    import pytest
    with pytest.raises(RuntimeError, match="boom"):
        with patch("app.middleware.logger"):
            await middleware.dispatch(request, call_next)


async def test_dispatch_logs_health_check_at_debug() -> None:
    """Health-check endpoints should be logged at DEBUG, not INFO."""
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    for path in ("/api/health", "/api/health/ready"):
        request = MagicMock()
        request.headers = {}
        request.method = "GET"
        request.url.path = path
        request.client = MagicMock()
        request.client.host = "127.0.0.1"

        with patch("app.middleware.logger") as mock_logger:
            await middleware.dispatch(request, call_next)
            mock_logger.debug.assert_called_once()
            mock_logger.info.assert_not_called()


async def test_dispatch_logs_non_health_at_info() -> None:
    """Non-health-check endpoints should still be logged at INFO."""
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {}
    request.method = "GET"
    request.url.path = "/api/images"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware.logger") as mock_logger:
        await middleware.dispatch(request, call_next)
        mock_logger.info.assert_called_once()


async def test_dispatch_logs_numeric_content_length() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {"content-length": "3607772528"}
    request.method = "POST"
    request.url.path = "/api/admin/bulk-import/"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware.logger") as mock_logger:
        await middleware.dispatch(request, call_next)
        call_args = mock_logger.info.call_args
        extra = call_args.kwargs.get("extra", {})
        assert extra["content_length"] == 3607772528


def test_parse_exclude_prefixes_strips_whitespace_and_blanks() -> None:
    """Exclude-prefix parsing should ignore empty entries and strip padding."""
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


async def test_dispatch_logs_upload_start_for_upload_paths() -> None:
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 201
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {"content-length": "3607772528"}
    request.method = "POST"
    request.url.path = "/api/admin/bulk-import/"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware.logger") as mock_logger:
        await middleware.dispatch(request, call_next)
        upload_call = mock_logger.info.call_args_list[0]
        extra = upload_call.kwargs.get("extra", {})
        assert extra["event"] == "http.upload_started"
        assert extra["content_length"] == 3607772528


async def test_dispatch_logs_tiles_at_debug() -> None:
    """Tile-serving endpoints match the default prefix list and log at DEBUG."""
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {}
    request.method = "GET"
    request.url.path = "/api/tiles/123/4/2/2.jpg"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware._EXCLUDE_PREFIXES", ("/api/tiles/",)):
        with patch("app.middleware.logger") as mock_logger:
            await middleware.dispatch(request, call_next)
            mock_logger.debug.assert_called_once()
            mock_logger.info.assert_not_called()


async def test_dispatch_respects_configured_exclude_prefixes() -> None:
    """Paths not matching any configured prefix are still logged at INFO."""
    middleware = AuditMiddleware(app=MagicMock())

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {}

    async def call_next(request):
        return mock_response

    request = MagicMock()
    request.headers = {}
    request.method = "GET"
    request.url.path = "/api/images/42"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("app.middleware._EXCLUDE_PREFIXES", ("/api/tiles/", "/api/health")):
        with patch("app.middleware.logger") as mock_logger:
            await middleware.dispatch(request, call_next)
            mock_logger.info.assert_called_once()
            mock_logger.debug.assert_not_called()
