"""Tests for the issues router endpoints."""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.issues import (
    _check_rate_limit,
    _user_timestamps,
    report_issue,
    ReportIssueRequest,
)


def test_check_rate_limit_allows_first_request() -> None:
    user_id = 9999
    _user_timestamps.pop(user_id, None)
    _check_rate_limit(user_id)  # Should not raise


def test_check_rate_limit_allows_second_request() -> None:
    user_id = 9998
    _user_timestamps[user_id] = [time.monotonic()]
    _check_rate_limit(user_id)  # Should not raise
    _user_timestamps.pop(user_id, None)


def test_check_rate_limit_blocks_third_request() -> None:
    user_id = 9997
    now = time.monotonic()
    _user_timestamps[user_id] = [now, now + 1]

    with pytest.raises(HTTPException) as exc:
        _check_rate_limit(user_id)
    assert exc.value.status_code == 429
    _user_timestamps.pop(user_id, None)


def test_check_rate_limit_prunes_old_entries() -> None:
    user_id = 9996
    old_time = time.monotonic() - 100000  # Way past the window
    _user_timestamps[user_id] = [old_time, old_time + 1]

    _check_rate_limit(user_id)  # Should not raise, old entries pruned
    _user_timestamps.pop(user_id, None)


async def test_report_issue_not_configured() -> None:
    user = SimpleNamespace(id=1, name="Test", email="t@example.com")
    body = ReportIssueRequest(description="Bug", page_url="http://localhost/page")

    with patch("app.routers.issues.GITHUB_TOKEN", ""):
        with patch("app.routers.issues.GITHUB_REPO", ""):
            with pytest.raises(HTTPException) as exc:
                await report_issue(body, user)
            assert exc.value.status_code == 503


async def test_report_issue_success() -> None:
    user_id = 8888
    _user_timestamps.pop(user_id, None)
    user = SimpleNamespace(id=user_id, name="Test User", email="t@example.com")
    body = ReportIssueRequest(description="Found a bug", page_url="http://localhost/page")

    mock_resp = MagicMock()
    mock_resp.status_code = 201
    mock_resp.json.return_value = {"html_url": "https://github.com/repo/issues/1"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.issues.GITHUB_TOKEN", "fake-token"):
        with patch("app.routers.issues.GITHUB_REPO", "owner/repo"):
            with patch("app.routers.issues.httpx.AsyncClient", return_value=mock_client):
                result = await report_issue(body, user)

    assert result.issue_url == "https://github.com/repo/issues/1"
    _user_timestamps.pop(user_id, None)


async def test_report_issue_github_error() -> None:
    user_id = 8887
    _user_timestamps.pop(user_id, None)
    user = SimpleNamespace(id=user_id, name="Test", email="t@example.com")
    body = ReportIssueRequest(description="Bug", page_url="http://localhost/page")

    mock_resp = MagicMock()
    mock_resp.status_code = 500

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.issues.GITHUB_TOKEN", "fake-token"):
        with patch("app.routers.issues.GITHUB_REPO", "owner/repo"):
            with patch("app.routers.issues.httpx.AsyncClient", return_value=mock_client):
                with pytest.raises(HTTPException) as exc:
                    await report_issue(body, user)
                assert exc.value.status_code == 502
    _user_timestamps.pop(user_id, None)
