"""Tests for feedback delivery providers and configuration."""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.feedback import (
    FeedbackDeliveryError,
    FeedbackNotConfiguredError,
    FeedbackSubmission,
    GitHubFeedbackDelivery,
    get_feedback_delivery,
    normalize_github_repo,
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
    assert normalize_github_repo(raw) == expected


def test_get_feedback_delivery_uses_github_provider_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "github")
    monkeypatch.setenv("FEEDBACK_GITHUB_TOKEN", "token")
    monkeypatch.setenv("FEEDBACK_GITHUB_REPOSITORY", "owner/repo")

    provider = get_feedback_delivery()

    assert isinstance(provider, GitHubFeedbackDelivery)
    assert provider.repo == "owner/repo"


def test_get_feedback_delivery_supports_legacy_github_env_vars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("FEEDBACK_DELIVERY_PROVIDER", raising=False)
    monkeypatch.delenv("FEEDBACK_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("FEEDBACK_GITHUB_REPOSITORY", raising=False)
    monkeypatch.setenv("GITHUB_TOKEN", "token")
    monkeypatch.setenv("GITHUB_REPO", "https://github.com/owner/repo")

    provider = get_feedback_delivery()

    assert isinstance(provider, GitHubFeedbackDelivery)
    assert provider.repo == "owner/repo"


def test_get_feedback_delivery_requires_complete_github_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "github")
    monkeypatch.delenv("FEEDBACK_GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("FEEDBACK_GITHUB_REPOSITORY", "owner/repo")

    with pytest.raises(FeedbackNotConfiguredError):
        get_feedback_delivery()


def test_get_feedback_delivery_rejects_unknown_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "teams")

    with pytest.raises(FeedbackNotConfiguredError) as exc:
        get_feedback_delivery()

    assert "Unsupported feedback delivery provider" in str(exc.value)


async def test_github_feedback_delivery_success() -> None:
    submission = FeedbackSubmission(
        description="Found a bug",
        page_url="http://localhost/page",
        user_id=123,
        user_role="student",
    )
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

    delivery = GitHubFeedbackDelivery(token="fake-token", repo="owner/repo")

    with patch("app.feedback.httpx.AsyncClient", return_value=mock_client):
        result = await delivery.submit(submission)

    assert result.destination == "github"
    assert result.tracking_url == "https://github.com/repo/issues/1"
    assert result.external_id == "1"

    create_call = mock_client.post.call_args_list[0]
    payload = create_call.kwargs["json"]
    assert payload["title"] == "feedback: Issue report from student"
    assert "labels" not in payload
    body_text = payload["body"]
    sep_pos = body_text.index("---")
    assert body_text.index("Found a bug") < sep_pos
    assert body_text.index("**Reported by:**") > sep_pos
    assert body_text.index("**Page:**") > sep_pos
    assert "student (user \u200b#123)" in body_text

    label_call = mock_client.post.call_args_list[1]
    assert "/issues/1/labels" in label_call.args[0]
    assert label_call.kwargs["json"] == {"labels": ["feedback"]}


async def test_github_feedback_delivery_label_failure_still_succeeds() -> None:
    submission = FeedbackSubmission(
        description="Bug report",
        page_url="http://localhost/page",
        user_id=456,
        user_role="instructor",
    )
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

    delivery = GitHubFeedbackDelivery(token="fake-token", repo="owner/repo")

    with patch("app.feedback.httpx.AsyncClient", return_value=mock_client):
        result = await delivery.submit(submission)

    assert result.tracking_url == "https://github.com/repo/issues/2"


async def test_github_feedback_delivery_create_error() -> None:
    submission = FeedbackSubmission(
        description="Bug",
        page_url="http://localhost/page",
        user_id=789,
        user_role="admin",
    )
    create_resp = MagicMock()
    create_resp.status_code = 500

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=create_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    delivery = GitHubFeedbackDelivery(token="fake-token", repo="owner/repo")

    with patch("app.feedback.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(FeedbackDeliveryError) as exc:
            await delivery.submit(submission)

    assert "GitHub API error creating issue: 500" in str(exc.value)
