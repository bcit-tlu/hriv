"""Feedback delivery providers and provider selection."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import smtplib
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Protocol

import httpx

from .component_versions import get_app_version


_FEEDBACK_TYPE_LABELS = {
    "problem_or_issue": "Problem or issue",
    "comment_or_suggestion": "Comment or suggestion",
}

logger = logging.getLogger(__name__)

_TEAMS_RATE_LIMIT_SIGNAL = "Microsoft Teams endpoint returned HTTP error 429"


@dataclass(frozen=True)
class FeedbackSubmission:
    description: str
    page_url: str
    user_id: int
    user_role: str
    app_version: str
    submitted_at: str
    feedback_type: str


@dataclass(frozen=True)
class FeedbackDeliveryResult:
    destination: str
    tracking_url: str | None = None
    external_id: str | None = None


class FeedbackDelivery(Protocol):
    async def submit(self, submission: FeedbackSubmission) -> FeedbackDeliveryResult:
        """Deliver a feedback submission to an external system."""


class FeedbackNotConfiguredError(RuntimeError):
    """Raised when no usable feedback provider is configured."""


class FeedbackDeliveryError(RuntimeError):
    """Raised when a configured feedback provider fails."""


class EmailFeedbackDelivery:
    """Deliver feedback by sending email via SMTP."""

    def __init__(
        self,
        *,
        smtp_server: str,
        smtp_port: int,
        username: str,
        password: str,
        from_addr: str,
        to_addr: str,
        security: str = "auto",
    ) -> None:
        self.smtp_server = smtp_server
        self.smtp_port = smtp_port
        self.username = username
        self.password = password
        self.from_addr = from_addr
        self.to_addr = to_addr
        self.security = _resolve_email_security(
            security.lower().strip(), self.smtp_port
        )

    async def submit(self, submission: FeedbackSubmission) -> FeedbackDeliveryResult:
        await asyncio.to_thread(self._send, submission)
        return FeedbackDeliveryResult(destination="email")

    def _send(self, submission: FeedbackSubmission) -> None:
        label = _FEEDBACK_TYPE_LABELS.get(
            submission.feedback_type, submission.feedback_type
        )
        msg = EmailMessage()
        msg["Subject"] = f"HRIV feedback: {label}"
        msg["From"] = self.from_addr
        msg["To"] = self.to_addr
        msg.set_content(
            f"Feedback type: {label}\n\n"
            f"Description:\n{submission.description}\n\n"
            f"Page URL: {submission.page_url}\n"
            f"User role: {submission.user_role}\n"
            f"User ID: {submission.user_id}\n"
            f"App version: {submission.app_version}\n"
            f"Submitted at: {submission.submitted_at}"
        )

        try:
            if self.security == "ssl":
                server = smtplib.SMTP_SSL(
                    self.smtp_server, self.smtp_port, timeout=15.0
                )
            else:
                server = smtplib.SMTP(
                    self.smtp_server, self.smtp_port, timeout=15.0
                )

            with server:
                if self.security == "starttls":
                    server.starttls()
                if self.username and self.password:
                    server.login(self.username, self.password)
                server.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            raise FeedbackDeliveryError(f"Failed to send feedback email: {exc}") from exc


class TeamsFeedbackDelivery:
    """Deliver feedback by posting a card to a Teams webhook."""

    def __init__(self, *, webhook_url: str) -> None:
        self.webhook_url = webhook_url

    async def submit(self, submission: FeedbackSubmission) -> FeedbackDeliveryResult:
        payload = {
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "content": {
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "type": "AdaptiveCard",
                        "version": "1.2",
                        "msteams": {"width": "Full"},
                        "body": [
                            {
                                "type": "TextBlock",
                                "text": "HRIV feedback submitted",
                                "weight": "Bolder",
                                "size": "Medium",
                            },
                            {
                                "type": "TextBlock",
                                "text": submission.description,
                                "wrap": True,
                            },
                            {
                                "type": "FactSet",
                                "facts": [
                                    {
                                        "title": "Feedback type",
                                        "value": _FEEDBACK_TYPE_LABELS.get(
                                            submission.feedback_type,
                                            submission.feedback_type,
                                        ),
                                    },
                                    {"title": "Role", "value": submission.user_role},
                                    {
                                        "title": "Internal user id",
                                        "value": str(submission.user_id),
                                    },
                                    {"title": "Page", "value": submission.page_url},
                                    {
                                        "title": "App version",
                                        "value": submission.app_version,
                                    },
                                    {
                                        "title": "Submitted",
                                        "value": submission.submitted_at,
                                    },
                                ],
                            },
                        ],
                        "actions": [
                            {
                                "type": "Action.OpenUrl",
                                "title": "Open reported page",
                                "url": submission.page_url,
                            }
                        ],
                    },
                }
            ],
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    self.webhook_url,
                    json=payload,
                    timeout=15.0,
                )
            except httpx.HTTPError as exc:
                raise FeedbackDeliveryError(
                    f"Teams webhook request failed: {exc}"
                ) from exc
            response_text = response.text.strip()
            # Teams channel webhooks may return HTTP 200 while embedding a
            # 429-style rate-limit signal in the response body.
            if response.is_success and _TEAMS_RATE_LIMIT_SIGNAL in response_text:
                raise FeedbackDeliveryError("Teams webhook rate limit exceeded")
            if not response.is_success:
                detail = f": {response_text}" if response_text else ""
                raise FeedbackDeliveryError(
                    f"Teams webhook error: {response.status_code}{detail}"
                )

        return FeedbackDeliveryResult(destination="teams")


def _resolve_email_security(security: str, port: int) -> str:
    """Resolve an explicit or 'auto' SMTP security mode."""
    if security in {"", "auto"}:
        return "ssl" if port == 465 else "starttls"
    if security not in {"starttls", "ssl", "none"}:
        raise ValueError(f"Invalid SMTP security mode: {security!r}")
    return security


def _parse_smtp_port(raw: str) -> tuple[int, str]:
    """Return (port, inferred_security) from an integer or JSON port value."""
    raw = raw.strip()
    try:
        return int(raw), "auto"
    except ValueError:
        pass

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid SMTP port value: {raw!r}") from exc

    if not isinstance(data, dict):
        raise ValueError(f"Invalid SMTP port value: {raw!r}")

    tls_ports = data.get("tls")
    ssl_port = data.get("ssl")

    if tls_ports is not None:
        if isinstance(tls_ports, list) and tls_ports:
            return int(tls_ports[0]), "starttls"
        raise ValueError(f"Invalid SMTP port value: {raw!r}")

    if ssl_port is not None:
        return int(ssl_port), "ssl"

    raise ValueError(f"Invalid SMTP port value: {raw!r}")


def get_feedback_app_version() -> str:
    """Return the deployed app version for provider payloads."""
    return get_app_version()


def get_feedback_submission_timestamp() -> str:
    """Return an ISO-8601 UTC timestamp for a feedback submission."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_feedback_delivery() -> FeedbackDelivery:
    """Resolve the configured feedback delivery provider."""
    provider = os.environ.get("FEEDBACK_DELIVERY_PROVIDER", "").strip().lower()

    if provider in {"", "disabled", "none"}:
        raise FeedbackNotConfiguredError("Feedback delivery is not configured")

    if provider == "email":
        smtp_server = os.environ.get("FEEDBACK_EMAIL_SMTP_SERVER", "").strip()
        smtp_port = os.environ.get("FEEDBACK_EMAIL_SMTP_PORT", "").strip()
        username = os.environ.get("FEEDBACK_EMAIL_USERNAME", "").strip()
        password = os.environ.get("FEEDBACK_EMAIL_PASSWORD", "")
        from_addr = os.environ.get("FEEDBACK_EMAIL_FROM", username).strip()
        to_addr = os.environ.get("FEEDBACK_EMAIL_TO", "tlu_techops@bcit.ca").strip()
        security = os.environ.get("FEEDBACK_EMAIL_SMTP_SECURITY", "auto").strip()

        if not smtp_server:
            raise FeedbackNotConfiguredError(
                "Email feedback delivery is not fully configured: SMTP server is missing"
            )
        if not smtp_port:
            raise FeedbackNotConfiguredError(
                "Email feedback delivery is not fully configured: SMTP port is missing"
            )
        if not username:
            raise FeedbackNotConfiguredError(
                "Email feedback delivery is not fully configured: username is missing"
            )
        if not password:
            raise FeedbackNotConfiguredError(
                "Email feedback delivery is not fully configured: password is missing"
            )
        if not from_addr:
            raise FeedbackNotConfiguredError(
                "Email feedback delivery is not fully configured: from address is missing"
            )
        if not to_addr:
            raise FeedbackNotConfiguredError(
                "Email feedback delivery is not fully configured: to address is missing"
            )

        try:
            port, default_security = _parse_smtp_port(smtp_port)
        except ValueError as exc:
            raise FeedbackNotConfiguredError(str(exc)) from exc

        if security in {"", "auto"}:
            security = default_security

        return EmailFeedbackDelivery(
            smtp_server=smtp_server,
            smtp_port=port,
            username=username,
            password=password,
            from_addr=from_addr,
            to_addr=to_addr,
            security=security,
        )

    if provider == "teams":
        webhook_url = os.environ.get("FEEDBACK_TEAMS_WEBHOOK_URL", "").strip()
        if not webhook_url:
            raise FeedbackNotConfiguredError(
                "Teams feedback delivery is not fully configured"
            )
        return TeamsFeedbackDelivery(webhook_url=webhook_url)

    raise FeedbackNotConfiguredError(
        f"Unsupported feedback delivery provider: {provider}"
    )
