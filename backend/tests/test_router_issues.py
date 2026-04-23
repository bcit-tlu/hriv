"""Tests for the issues router endpoints."""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.routers.issues import (
    _check_rate_limit,
    _normalize_repo,
    _user_timestamps,
    report_issue,
    ReportIssueRequest,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("owner/repo", "owner/repo"),
        ("https://github.com/owner/repo", "owner/repo"),
        ("http://github.com/owner/repo", "owner/repo"),
        ("https://github.com/owner/repo/", "owner/repo"),
        ("", ""),
    ],
)
def test_github_repo_normalization(raw: str, expected: str) -> None:
    """GITHUB_REPO is normalized to owner/repo at module load time."""
    assert _normalize_repo(raw) == expected


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
    user = SimpleNamespace(id=1, name="Test", email="t@example.com", role="student")
    body = ReportIssueRequest(description="Bug", page_url="http://localhost/page")

    with patch("app.routers.issues.GITHUB_TOKEN", ""):
        with patch("app.routers.issues.GITHUB_REPO", ""):
            with pytest.raises(HTTPException) as exc:
                await report_issue(body, user)
            assert exc.value.status_code == 503


async def test_report_issue_success() -> None:
    user_id = 8888
    _user_timestamps.pop(user_id, None)
    user = SimpleNamespace(id=user_id, name="Test User", email="t@example.com", role="student")
    body = ReportIssueRequest(description="Found a bug", page_url="http://localhost/page")

    # First call: issue creation (201). Second call: label application (200).
    create_resp = MagicMock()
    create_resp.status_code = 201
    create_resp.json.return_value = {
        "html_url": "https://github.com/repo/issues/1",
        "number": 1,
    }
    label_resp = MagicMock()
    label_resp.status_code = 200

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=[create_resp, label_resp])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.issues.GITHUB_TOKEN", "fake-token"):
        with patch("app.routers.issues.GITHUB_REPO", "owner/repo"):
            with patch("app.routers.issues.httpx.AsyncClient", return_value=mock_client):
                result = await report_issue(body, user)

    assert result.issue_url == "https://github.com/repo/issues/1"

    # Verify the issue-creation call (first POST)
    create_call = mock_client.post.call_args_list[0]
    payload = create_call.kwargs["json"]
    assert payload["title"] == "feedback: Issue report from student"
    assert "labels" not in payload  # labels applied separately
    # Description appears before the metadata separator
    body_text = payload["body"]
    sep_pos = body_text.index("---")
    assert body_text.index("Found a bug") < sep_pos
    assert body_text.index("**Reported by:**") > sep_pos
    assert body_text.index("**Page:**") > sep_pos

    # Verify the label call (second POST)
    label_call = mock_client.post.call_args_list[1]
    assert "/issues/1/labels" in label_call.args[0]
    assert label_call.kwargs["json"] == {"labels": ["feedback"]}

    _user_timestamps.pop(user_id, None)


async def test_report_issue_label_failure_still_succeeds() -> None:
    """Issue is returned even when the label call raises an exception."""
    user_id = 8886
    _user_timestamps.pop(user_id, None)
    user = SimpleNamespace(id=user_id, name="Test User", email="t@example.com", role="instructor")
    body = ReportIssueRequest(description="Bug report", page_url="http://localhost/page")

    create_resp = MagicMock()
    create_resp.status_code = 201
    create_resp.json.return_value = {
        "html_url": "https://github.com/repo/issues/2",
        "number": 2,
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(
        side_effect=[create_resp, httpx.TimeoutException("label timed out")]
    )
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.issues.GITHUB_TOKEN", "fake-token"):
        with patch("app.routers.issues.GITHUB_REPO", "owner/repo"):
            with patch("app.routers.issues.httpx.AsyncClient", return_value=mock_client):
                result = await report_issue(body, user)

    assert result.issue_url == "https://github.com/repo/issues/2"
    _user_timestamps.pop(user_id, None)


async def test_report_issue_github_error() -> None:
    user_id = 8887
    _user_timestamps.pop(user_id, None)
    user = SimpleNamespace(id=user_id, name="Test", email="t@example.com", role="admin")
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
