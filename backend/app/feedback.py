"""Feedback delivery providers and provider selection."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)


def normalize_github_repo(raw: str) -> str:
    """Normalize a full GitHub URL to ``owner/repo`` format."""
    return (
        raw.removeprefix("https://github.com/")
        .removeprefix("http://github.com/")
        .strip("/")
    )


@dataclass(frozen=True)
class FeedbackSubmission:
    description: str
    page_url: str
    user_id: int
    user_role: str


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


class GitHubFeedbackDelivery:
    """Deliver feedback by creating GitHub issues."""

    def __init__(self, *, token: str, repo: str) -> None:
        self.token = token
        self.repo = normalize_github_repo(repo)

    async def submit(self, submission: FeedbackSubmission) -> FeedbackDeliveryResult:
        issue_number, tracking_url = await self._create_issue(submission)
        return FeedbackDeliveryResult(
            destination="github",
            tracking_url=tracking_url,
            external_id=str(issue_number),
        )

    async def _create_issue(self, submission: FeedbackSubmission) -> tuple[int, str]:
        issue_body = (
            f"{submission.description}\n\n"
            f"---\n\n"
            f"**Reported by:** {submission.user_role} (user \u200b#{submission.user_id})\n"
            f"**Page:** {submission.page_url}"
        )
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

        async with httpx.AsyncClient() as client:
            create_resp = await client.post(
                f"https://api.github.com/repos/{self.repo}/issues",
                headers=headers,
                json={
                    "title": f"feedback: Issue report from {submission.user_role}",
                    "body": issue_body,
                },
                timeout=15.0,
            )
            if create_resp.status_code != 201:
                raise FeedbackDeliveryError(
                    f"GitHub API error creating issue: {create_resp.status_code}"
                )

            data = create_resp.json()
            issue_number = data["number"]

            # Best-effort label application — do not fail the submission if the
            # label is missing or the token cannot apply it.
            try:
                await client.post(
                    f"https://api.github.com/repos/{self.repo}/issues/{issue_number}/labels",
                    headers=headers,
                    json={"labels": ["feedback"]},
                    timeout=10.0,
                )
            except Exception:
                logger.warning(
                    "Failed to apply feedback label on GitHub issue",
                    extra={"repo": self.repo, "issue_number": issue_number},
                    exc_info=True,
                )

        return issue_number, data["html_url"]


def get_feedback_delivery() -> FeedbackDelivery:
    """Resolve the configured feedback delivery provider."""
    provider = os.environ.get("FEEDBACK_DELIVERY_PROVIDER", "").strip().lower()

    # Backward compatibility for older deployments that only set GITHUB_*.
    if not provider and (
        os.environ.get("FEEDBACK_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN")
    ) and (
        os.environ.get("FEEDBACK_GITHUB_REPOSITORY") or os.environ.get("GITHUB_REPO")
    ):
        provider = "github"

    if provider in {"", "disabled", "none"}:
        raise FeedbackNotConfiguredError("Feedback delivery is not configured")

    if provider == "github":
        token = os.environ.get("FEEDBACK_GITHUB_TOKEN") or os.environ.get(
            "GITHUB_TOKEN", ""
        )
        repo = os.environ.get("FEEDBACK_GITHUB_REPOSITORY") or os.environ.get(
            "GITHUB_REPO", ""
        )
        repo = normalize_github_repo(repo)
        if not token or not repo:
            raise FeedbackNotConfiguredError(
                "GitHub feedback delivery is not fully configured"
            )
        return GitHubFeedbackDelivery(token=token, repo=repo)

    raise FeedbackNotConfiguredError(
        f"Unsupported feedback delivery provider: {provider}"
    )
