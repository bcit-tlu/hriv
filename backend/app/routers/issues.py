"""Router for reporting issues to GitHub."""

import os
import time
from collections import defaultdict
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..models import User

router = APIRouter(tags=["issues"])

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")


def _normalize_repo(raw: str) -> str:
    """Normalize a full GitHub URL to ``owner/repo`` format."""
    return (
        raw.removeprefix("https://github.com/")
        .removeprefix("http://github.com/")
        .strip("/")
    )


GITHUB_REPO = _normalize_repo(os.environ.get("GITHUB_REPO", ""))

# Per-user rate limiting: max 2 issues per 24-hour window
_RATE_LIMIT = 2
_RATE_WINDOW = 86400  # 24 hours in seconds
_user_timestamps: dict[int, list[float]] = defaultdict(list)


def _check_rate_limit(user_id: int) -> None:
    """Raise 429 if the user has exceeded the issue-creation rate limit."""
    now = time.monotonic()
    timestamps = _user_timestamps[user_id]
    # Prune entries older than the window
    _user_timestamps[user_id] = [t for t in timestamps if now - t < _RATE_WINDOW]
    if len(_user_timestamps[user_id]) >= _RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded \u2014 you may submit up to 2 reports per 24 hours.",
        )


class ReportIssueRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=2000)
    page_url: str = Field(..., min_length=1, max_length=2000)


class ReportIssueResponse(BaseModel):
    issue_url: str


@router.post(
    "/issues/report",
    response_model=ReportIssueResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_issue(
    body: ReportIssueRequest,
    current_user: Annotated[User, Depends(get_current_user)],
) -> ReportIssueResponse:
    """Create a GitHub issue from a user-submitted report."""
    if not GITHUB_TOKEN or not GITHUB_REPO:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Issue reporting is not configured",
        )

    _check_rate_limit(current_user.id)

    title = f"feedback: Issue report from {current_user.role}"
    issue_body = (
        f"{body.description}\n\n"
        f"---\n\n"
        f"**Reported by:** {current_user.name} ({current_user.email})\n"
        f"**Page:** {body.page_url}"
    )

    gh_headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.github.com/repos/{GITHUB_REPO}/issues",
            headers=gh_headers,
            json={"title": title, "body": issue_body},
            timeout=15.0,
        )

        if resp.status_code != 201:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"GitHub API error: {resp.status_code}",
            )

        data = resp.json()
        issue_number = data["number"]

        # Best-effort label application — don't fail the request if the
        # label doesn't exist or the token lacks permission.
        try:
            await client.post(
                f"https://api.github.com/repos/{GITHUB_REPO}/issues/{issue_number}/labels",
                headers=gh_headers,
                json={"labels": ["feedback"]},
                timeout=10.0,
            )
        except Exception:
            pass

    # Record successful submission for rate limiting
    _user_timestamps[current_user.id].append(time.monotonic())

    return ReportIssueResponse(issue_url=data["html_url"])
