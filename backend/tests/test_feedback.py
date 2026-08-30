"""Tests for feedback delivery providers and configuration."""
import smtplib
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.feedback import (
    EmailFeedbackDelivery,
    FeedbackDeliveryError,
    FeedbackNotConfiguredError,
    FeedbackSubmission,
    TeamsFeedbackDelivery,
    get_feedback_app_version,
    get_feedback_delivery,
    get_feedback_submission_timestamp,
)


def _make_submission(feedback_type: str = "problem_or_issue") -> FeedbackSubmission:
    return FeedbackSubmission(
        description="Found a bug",
        page_url="http://localhost/page",
        user_id=123,
        user_role="student",
        app_version="0.27.1",
        submitted_at="2026-07-03T00:00:00Z",
        feedback_type=feedback_type,
    )


def test_get_feedback_delivery_uses_email_provider_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "email")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_SERVER", "smtp.example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_PORT", "587")
    monkeypatch.setenv("FEEDBACK_EMAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_PASSWORD", "secret")

    provider = get_feedback_delivery()

    assert isinstance(provider, EmailFeedbackDelivery)
    assert provider.smtp_server == "smtp.example.com"
    assert provider.smtp_port == 587
    assert provider.username == "user@example.com"
    assert provider.password == "secret"
    assert provider.from_addr == "user@example.com"
    assert provider.to_addr == "tlu_techops@bcit.ca"


def test_get_feedback_delivery_uses_custom_from_and_to(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "email")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_SERVER", "smtp.example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_PORT", "465")
    monkeypatch.setenv("FEEDBACK_EMAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_PASSWORD", "secret")
    monkeypatch.setenv("FEEDBACK_EMAIL_FROM", "hriv@example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_TO", "support@example.com")

    provider = get_feedback_delivery()

    assert isinstance(provider, EmailFeedbackDelivery)
    assert provider.from_addr == "hriv@example.com"
    assert provider.to_addr == "support@example.com"
    assert provider.security == "ssl"


def test_get_feedback_delivery_parses_json_smtp_port(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "email")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_SERVER", "smtp.example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_PORT", '{"ssl": 465, "tls": [587, 25]}')
    monkeypatch.setenv("FEEDBACK_EMAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_PASSWORD", "secret")

    provider = get_feedback_delivery()

    assert isinstance(provider, EmailFeedbackDelivery)
    assert provider.smtp_port == 587
    assert provider.security == "starttls"


def test_get_feedback_delivery_parses_ssl_only_json_smtp_port(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "email")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_SERVER", "smtp.example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_PORT", '{"ssl": 465}')
    monkeypatch.setenv("FEEDBACK_EMAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_PASSWORD", "secret")

    provider = get_feedback_delivery()

    assert isinstance(provider, EmailFeedbackDelivery)
    assert provider.smtp_port == 465
    assert provider.security == "ssl"


def test_get_feedback_delivery_security_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "email")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_SERVER", "smtp.example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_PORT", "25")
    monkeypatch.setenv("FEEDBACK_EMAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_PASSWORD", "secret")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_SECURITY", "none")

    provider = get_feedback_delivery()

    assert isinstance(provider, EmailFeedbackDelivery)
    assert provider.security == "none"


def test_get_feedback_delivery_email_requires_complete_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "email")
    monkeypatch.delenv("FEEDBACK_EMAIL_SMTP_SERVER", raising=False)
    monkeypatch.delenv("FEEDBACK_EMAIL_SMTP_PORT", raising=False)
    monkeypatch.delenv("FEEDBACK_EMAIL_USERNAME", raising=False)
    monkeypatch.delenv("FEEDBACK_EMAIL_PASSWORD", raising=False)

    with pytest.raises(FeedbackNotConfiguredError):
        get_feedback_delivery()


def test_get_feedback_delivery_rejects_invalid_smtp_port(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "email")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_SERVER", "smtp.example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_SMTP_PORT", "not-a-port")
    monkeypatch.setenv("FEEDBACK_EMAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("FEEDBACK_EMAIL_PASSWORD", "secret")

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
    monkeypatch.setenv("FEEDBACK_DELIVERY_PROVIDER", "github")

    with pytest.raises(FeedbackNotConfiguredError) as exc:
        get_feedback_delivery()

    assert "Unsupported feedback delivery provider" in str(exc.value)


async def test_email_feedback_delivery_success() -> None:
    submission = _make_submission(feedback_type="problem_or_issue")
    mock_server = MagicMock()
    mock_server.__enter__ = MagicMock(return_value=mock_server)
    mock_server.__exit__ = MagicMock(return_value=False)

    delivery = EmailFeedbackDelivery(
        smtp_server="smtp.example.com",
        smtp_port=587,
        username="user@example.com",
        password="secret",
        from_addr="hriv@example.com",
        to_addr="tlu_techops@bcit.ca",
        security="starttls",
    )

    with patch("app.feedback.smtplib.SMTP") as mock_smtp_class:
        mock_smtp_class.return_value = mock_server
        result = await delivery.submit(submission)

    assert result.destination == "email"
    assert result.tracking_url is None
    assert result.external_id is None

    mock_smtp_class.assert_called_once_with("smtp.example.com", 587, timeout=15.0)
    mock_server.starttls.assert_called_once()
    mock_server.login.assert_called_once_with("user@example.com", "secret")
    mock_server.send_message.assert_called_once()

    sent_msg = mock_server.send_message.call_args[0][0]
    assert sent_msg["Subject"] == "HRIV feedback: Problem or issue"
    assert sent_msg["From"] == "hriv@example.com"
    assert sent_msg["To"] == "tlu_techops@bcit.ca"
    assert "Found a bug" in sent_msg.get_content()
    assert "http://localhost/page" in sent_msg.get_content()
    assert "student" in sent_msg.get_content()
    assert "123" in sent_msg.get_content()
    assert "0.27.1" in sent_msg.get_content()
    assert "2026-07-03T00:00:00Z" in sent_msg.get_content()


async def test_email_feedback_delivery_ssl() -> None:
    submission = _make_submission()
    mock_server = MagicMock()
    mock_server.__enter__ = MagicMock(return_value=mock_server)
    mock_server.__exit__ = MagicMock(return_value=False)

    delivery = EmailFeedbackDelivery(
        smtp_server="smtp.example.com",
        smtp_port=465,
        username="user@example.com",
        password="secret",
        from_addr="hriv@example.com",
        to_addr="tlu_techops@bcit.ca",
        security="ssl",
    )

    with patch("app.feedback.smtplib.SMTP_SSL") as mock_smtp_ssl_class:
        mock_smtp_ssl_class.return_value = mock_server
        result = await delivery.submit(submission)

    assert result.destination == "email"
    mock_smtp_ssl_class.assert_called_once_with("smtp.example.com", 465, timeout=15.0)
    mock_server.starttls.assert_not_called()
    mock_server.login.assert_called_once()
    mock_server.send_message.assert_called_once()


async def test_email_feedback_delivery_smtp_error() -> None:
    submission = _make_submission()

    delivery = EmailFeedbackDelivery(
        smtp_server="smtp.example.com",
        smtp_port=587,
        username="user@example.com",
        password="secret",
        from_addr="hriv@example.com",
        to_addr="tlu_techops@bcit.ca",
    )

    with patch(
        "app.feedback.smtplib.SMTP",
        side_effect=smtplib.SMTPConnectError(421, "Unable to connect"),
    ):
        with pytest.raises(FeedbackDeliveryError) as exc:
            await delivery.submit(submission)

    assert "Failed to send feedback email" in str(exc.value)


async def test_teams_feedback_delivery_success() -> None:
    submission = _make_submission()
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
        "Feedback type": "Problem or issue",
        "Role": "student",
        "Internal user id": "123",
        "Page": "http://localhost/page",
        "App version": "0.27.1",
        "Submitted": "2026-07-03T00:00:00Z",
    }
    assert card["actions"] == [
        {
            "type": "Action.OpenUrl",
            "title": "Open reported page",
            "url": "http://localhost/page",
        }
    ]


async def test_teams_feedback_delivery_comment_or_suggestion_label() -> None:
    submission = _make_submission(feedback_type="comment_or_suggestion")
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
    post_call = mock_client.post.call_args
    payload = post_call.kwargs["json"]
    card = payload["attachments"][0]["content"]
    facts = {fact["title"]: fact["value"] for fact in card["body"][2]["facts"]}
    assert facts["Feedback type"] == "Comment or suggestion"


async def test_teams_feedback_delivery_rate_limit_signal_in_body() -> None:
    submission = _make_submission()
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
    submission = _make_submission()
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
    submission = _make_submission()

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
