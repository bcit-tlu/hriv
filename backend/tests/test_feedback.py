"""Tests for feedback delivery providers and configuration."""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.feedback import (
    FeedbackDeliveryError,
    FeedbackNotConfiguredError,
    FeedbackSubmission,
    GitHubFeedbackDelivery,
    TeamsFeedbackDelivery,
    get_feedback_delivery,
    get_feedback_app_version,
    get_feedback_submission_timestamp,
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
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("FEEDBACK_GITHUB_REPOSITORY", "owner/repo")
    monkeypatch.delenv("GITHUB_REPO", raising=False)

    with pytest.raises(FeedbackNotConfiguredError):
        get_feedback_delivery()


def test_get_feedback_delivery_rejects_domain_only_github_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "github")
    monkeypatch.setenv("FEEDBACK_GITHUB_TOKEN", "token")
    monkeypatch.setenv("FEEDBACK_GITHUB_REPOSITORY", "https://github.com/")

    with pytest.raises(FeedbackNotConfiguredError):
        get_feedback_delivery()


def test_get_feedback_delivery_uses_teams_provider_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "teams")
    monkeypatch.setenv("FEEDBACK_TEAMS_WEBHOOK_URL", "https://teams.example/webhook")

    provider = get_feedback_delivery()

    assert isinstance(provider, TeamsFeedbackDelivery)
    assert provider.webhook_url == "https://teams.example/webhook"


def test_get_feedback_delivery_requires_complete_teams_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "teams")
    monkeypatch.delenv("FEEDBACK_TEAMS_WEBHOOK_URL", raising=False)

    with pytest.raises(FeedbackNotConfiguredError):
        get_feedback_delivery()


def test_get_feedback_delivery_rejects_unknown_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "email")

    with pytest.raises(FeedbackNotConfiguredError) as exc:
        get_feedback_delivery()

    assert "Unsupported feedback delivery provider" in str(exc.value)


async def test_github_feedback_delivery_success() -> None:
    submission = FeedbackSubmission(
        description="Found a bug",
        page_url="http://localhost/page",
        user_id=123,
        user_role="student",
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
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
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
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

    with (
        patch("app.feedback.httpx.AsyncClient", return_value=mock_client),
        patch("app.feedback.logger.warning") as mock_warning,
    ):
        result = await delivery.submit(submission)

    assert result.tracking_url == "https://github.com/repo/issues/2"
    mock_warning.assert_called_once()


async def test_github_feedback_delivery_create_error() -> None:
    submission = FeedbackSubmission(
        description="Bug",
        page_url="http://localhost/page",
        user_id=789,
        user_role="admin",
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
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


async def test_github_feedback_delivery_create_transport_error() -> None:
    submission = FeedbackSubmission(
        description="Bug",
        page_url="http://localhost/page",
        user_id=790,
        user_role="admin",
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
    )

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("request timed out"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    delivery = GitHubFeedbackDelivery(token="fake-token", repo="owner/repo")

    with patch("app.feedback.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(FeedbackDeliveryError) as exc:
            await delivery.submit(submission)

    assert "GitHub API request failed:" in str(exc.value)


async def test_teams_feedback_delivery_success() -> None:
    submission = FeedbackSubmission(
        description="Found a bug",
        page_url="https://hriv.example.ca/images/12",
        user_id=123,
        user_role="student",
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
    )
    response = MagicMock()
    response.is_success = True
    response.text = "1"

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    delivery = TeamsFeedbackDelivery(webhook_url="https://teams.example/webhook")

    with patch("app.feedback.httpx.AsyncClient", return_value=mock_client):
        result = await delivery.submit(submission)

    assert result.destination == "teams"
    assert result.tracking_url is None
    assert result.external_id is None

    post_call = mock_client.post.call_args
    assert post_call.args[0] == "https://teams.example/webhook"
    payload = post_call.kwargs["json"]
    assert payload["type"] == "message"
    attachment = payload["attachments"][0]
    assert attachment["contentType"] == "application/vnd.microsoft.card.adaptive"
    card = attachment["content"]
    assert card["type"] == "AdaptiveCard"
    assert card["version"] == "1.2"
    assert card["body"][1]["text"] == "Found a bug"
    facts = {fact["title"]: fact["value"] for fact in card["body"][2]["facts"]}
    assert facts == {
        "Role": "student",
        "Internal user id": "123",
        "Page": "https://hriv.example.ca/images/12",
        "App version": "0.27.1",
        "Submitted": "2026-07-03T00:00:00Z",
    }
    assert card["actions"] == [
        {
            "type": "Action.OpenUrl",
            "title": "Open reported page",
            "url": "https://hriv.example.ca/images/12",
        }
    ]


async def test_teams_feedback_delivery_rate_limit_signal_in_body() -> None:
    submission = FeedbackSubmission(
        description="Found a bug",
        page_url="https://hriv.example.ca/images/12",
        user_id=123,
        user_role="student",
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
    )
    response = MagicMock()
    response.is_success = True
    response.text = "Microsoft Teams endpoint returned HTTP error 429"

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    delivery = TeamsFeedbackDelivery(webhook_url="https://teams.example/webhook")

    with patch("app.feedback.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(FeedbackDeliveryError) as exc:
            await delivery.submit(submission)

    assert "rate limit exceeded" in str(exc.value)


async def test_teams_feedback_delivery_http_error() -> None:
    submission = FeedbackSubmission(
        description="Found a bug",
        page_url="https://hriv.example.ca/images/12",
        user_id=123,
        user_role="student",
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
    )
    response = MagicMock()
    response.is_success = False
    response.status_code = 500
    response.text = "Internal Server Error"

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    delivery = TeamsFeedbackDelivery(webhook_url="https://teams.example/webhook")

    with patch("app.feedback.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(FeedbackDeliveryError) as exc:
            await delivery.submit(submission)

    assert "Teams webhook error: 500" in str(exc.value)


async def test_teams_feedback_delivery_transport_error() -> None:
    submission = FeedbackSubmission(
        description="Found a bug",
        page_url="https://hriv.example.ca/images/12",
        user_id=123,
        user_role="student",
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
    )

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.ConnectTimeout("request timed out"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    delivery = TeamsFeedbackDelivery(webhook_url="https://teams.example/webhook")

    with patch("app.feedback.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(FeedbackDeliveryError) as exc:
            await delivery.submit(submission)

    assert "Teams webhook request failed:" in str(exc.value)


def test_get_feedback_app_version_defaults_to_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("APP_VERSION", raising=False)

    assert get_feedback_app_version() == "unknown"


def test_get_feedback_app_version_uses_env_var(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_VERSION", "0.27.1")

    assert get_feedback_app_version() == "0.27.1"


def test_get_feedback_submission_timestamp_returns_utc_isoformat() -> None:
    timestamp = get_feedback_submission_timestamp()

    assert timestamp.endswith("Z")
    assert "T" in timestamp
