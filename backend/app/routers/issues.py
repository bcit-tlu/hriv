"""Router for reporting issues to GitHub."""

import os
import re
import time
import unicodedata
from collections import defaultdict
from typing import Annotated
from urllib.parse import urlparse, urlencode, parse_qs

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..database import Settings
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

# ---------------------------------------------------------------------------
# Input sanitization helpers
# ---------------------------------------------------------------------------

# Patterns that indicate PII or secrets in free text
_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+")
_JWT_RE = re.compile(r"eyJ[^.\s]+\.[^.\s]+\.[^.\s]+")
_KEY_PREFIX_RE = re.compile(
    r"(sk|pk|ghp|gho|ghs|ghr|xox[baprs])[-_][A-Za-z0-9_-]{16,}"
)
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_LONG_DIGITS_RE = re.compile(r"\b\d{13,19}\b")

_REDACTED = "[redacted]"

# Query params that may contain secrets or PII
_SENSITIVE_PARAMS = frozenset({
    "token", "access_token", "code", "state", "api_key",
    "password", "email", "session", "secret", "key",
})

_MAX_NEWLINES = 100


def _scrub(text: str) -> str:
    """Redact common PII and secret patterns from free text."""
    text = _EMAIL_RE.sub(_REDACTED, text)
    text = _JWT_RE.sub(_REDACTED, text)
    text = _KEY_PREFIX_RE.sub(_REDACTED, text)
    text = _SSN_RE.sub(_REDACTED, text)
    text = _LONG_DIGITS_RE.sub(_REDACTED, text)
    return text


_ZWS = "\u200b"  # zero-width space


def _neutralize_markdown(text: str) -> str:
    """Escape GitHub @mentions and #issue-refs to prevent notification spam."""
    text = re.sub(r"(?<!\w)@", f"@{_ZWS}", text)
    text = re.sub(r"(?<!\w)#(\d)", f"#{_ZWS}\\1", text)
    return text


def _validate_shape(text: str) -> str:
    """Strip control characters and cap newline count."""
    # Remove control chars except \n and \t
    cleaned = "".join(
        ch for ch in text
        if ch in ("\n", "\t") or unicodedata.category(ch)[0] != "C"
    )
    # Cap newlines
    lines = cleaned.split("\n")
    if len(lines) > _MAX_NEWLINES + 1:
        lines = lines[: _MAX_NEWLINES + 1]
        cleaned = "\n".join(lines)
    return cleaned


def _get_allowed_hosts() -> set[str]:
    """Derive allowed hosts from CORS_ORIGINS setting."""
    settings = Settings()
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    hosts: set[str] = set()
    for origin in origins:
        if origin == "*":
            return set()  # wildcard = allow all
        parsed = urlparse(origin)
        if parsed.hostname:
            hosts.add(parsed.hostname)
    return hosts


def _validate_page_url(raw: str) -> str:
    """Validate and sanitize the page_url field.

    Requires http(s) scheme. If CORS_ORIGINS is configured (non-wildcard),
    validates the host against allowed origins. Strips sensitive query params.
    """
    # Truncate at first whitespace — valid URLs never contain unencoded
    # whitespace; it could be used to inject @mentions after the URL.
    raw = raw.split()[0] if raw.split() else ""

    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=422,
            detail="page_url must use http or https",
        )

    allowed_hosts = _get_allowed_hosts()
    if allowed_hosts and parsed.hostname not in allowed_hosts:
        raise HTTPException(
            status_code=422,
            detail="page_url host is not recognized",
        )

    # Strip sensitive query params
    if parsed.query:
        params = parse_qs(parsed.query, keep_blank_values=True)
        filtered = {
            k: v for k, v in params.items()
            if k.lower() not in _SENSITIVE_PARAMS
        }
        clean_query = urlencode(filtered, doseq=True)
        parsed = parsed._replace(query=clean_query)

    return parsed.geturl()


# ---------------------------------------------------------------------------


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

    # Sanitize inputs before sending to GitHub
    page_url = _validate_page_url(body.page_url)
    description = _validate_shape(body.description)
    description = _scrub(description)
    description = _neutralize_markdown(description)

    title = f"feedback: Issue report from {current_user.role}"
    issue_body = (
        f"{description}\n\n"
        f"---\n\n"
        f"**Reported by:** {current_user.role} (user {_ZWS}#{current_user.id})\n"
        f"**Page:** {page_url}"
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
