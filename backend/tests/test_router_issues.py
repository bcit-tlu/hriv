"""Tests for the issues router endpoints."""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.feedback import (
    FeedbackDeliveryError,
    FeedbackDeliveryResult,
    FeedbackNotConfiguredError,
)
from app.routers.issues import (
    _check_rate_limit,
    _neutralize_markdown,
    _scrub,
    _user_timestamps,
    _validate_page_url,
    _validate_shape,
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
    user = SimpleNamespace(id=1, name="Test", email="t@example.com", role="student")
    body = ReportIssueRequest(description="Bug", page_url="http://localhost/page")

    with patch(
        "app.routers.issues.get_feedback_delivery",
        side_effect=FeedbackNotConfiguredError("Feedback delivery is not configured"),
    ):
        with pytest.raises(HTTPException) as exc:
            await report_issue(body, user)
        assert exc.value.status_code == 503


async def test_report_issue_success() -> None:
    user_id = 8888
    _user_timestamps.pop(user_id, None)
    user = SimpleNamespace(id=user_id, name="Test User", email="t@example.com", role="student")
    body = ReportIssueRequest(description="Found a bug", page_url="http://localhost/page")

    delivery = AsyncMock()
    delivery.submit.return_value = FeedbackDeliveryResult(
        destination="github",
        tracking_url="https://github.com/repo/issues/1",
        external_id="1",
    )

    with patch("app.routers.issues.get_feedback_delivery", return_value=delivery):
        with (
            patch("app.routers.issues.get_feedback_app_version", return_value="0.27.1"),
            patch(
                "app.routers.issues.get_feedback_submission_timestamp",
                return_value="2026-07-03T00:00:00Z",
            ),
        ):
            result = await report_issue(body, user)

    assert result.destination == "github"
    assert result.tracking_url == "https://github.com/repo/issues/1"
    assert result.issue_url == "https://github.com/repo/issues/1"
    delivery.submit.assert_awaited_once()
    submission = delivery.submit.await_args.args[0]
    assert submission.description == "Found a bug"
    assert submission.page_url == "http://localhost/page"
    assert submission.user_role == "student"
    assert submission.user_id == 8888
    assert submission.app_version == "0.27.1"
    assert submission.submitted_at == "2026-07-03T00:00:00Z"

    _user_timestamps.pop(user_id, None)


async def test_report_issue_returns_generic_result_for_non_github_destination() -> None:
    user_id = 8886
    _user_timestamps.pop(user_id, None)
    user = SimpleNamespace(id=user_id, name="Test User", email="t@example.com", role="instructor")
    body = ReportIssueRequest(description="Bug report", page_url="http://localhost/page")

    delivery = AsyncMock()
    delivery.submit.return_value = FeedbackDeliveryResult(
        destination="servicenow",
        tracking_url="https://servicenow.example/ticket/INC001",
        external_id="INC001",
    )

    with patch("app.routers.issues.get_feedback_delivery", return_value=delivery):
        with (
            patch("app.routers.issues.get_feedback_app_version", return_value="0.27.1"),
            patch(
                "app.routers.issues.get_feedback_submission_timestamp",
                return_value="2026-07-03T00:00:00Z",
            ),
        ):
            result = await report_issue(body, user)

    assert result.destination == "servicenow"
    assert result.tracking_url == "https://servicenow.example/ticket/INC001"
    assert result.issue_url is None
    _user_timestamps.pop(user_id, None)


async def test_report_issue_delivery_error() -> None:
    user_id = 8887
    _user_timestamps.pop(user_id, None)
    user = SimpleNamespace(id=user_id, name="Test", email="t@example.com", role="admin")
    body = ReportIssueRequest(description="Bug", page_url="http://localhost/page")

    delivery = AsyncMock()
    delivery.submit.side_effect = FeedbackDeliveryError("GitHub API error creating issue: 500")

    with patch("app.routers.issues.get_feedback_delivery", return_value=delivery):
        with pytest.raises(HTTPException) as exc:
            await report_issue(body, user)
        assert exc.value.status_code == 502
    _user_timestamps.pop(user_id, None)


# ---------------------------------------------------------------------------
# Sanitization helper tests
# ---------------------------------------------------------------------------


class TestScrub:
    def test_redacts_email(self) -> None:
        assert _scrub("contact me at user@example.com please") == (
            "contact me at [redacted] please"
        )

    def test_redacts_jwt(self) -> None:
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        assert "[redacted]" in _scrub(f"token is {jwt}")
        assert "eyJ" not in _scrub(f"token is {jwt}")

    def test_redacts_api_key_prefixes(self) -> None:
        assert _scrub("key: sk_live_1234567890abcdef1234") == "key: [redacted]"
        assert _scrub("ghp_ABCDEFGHIJKLMNOPqrst1234") == "[redacted]"

    def test_redacts_ssn(self) -> None:
        assert _scrub("SSN is 123-45-6789") == "SSN is [redacted]"

    def test_redacts_long_digit_sequences(self) -> None:
        assert _scrub("card 4111111111111111 here") == "card [redacted] here"

    def test_preserves_normal_text(self) -> None:
        text = "The button on /images page doesn't work when I click save."
        assert _scrub(text) == text


class TestNeutralizeMarkdown:
    def test_escapes_at_mentions(self) -> None:
        result = _neutralize_markdown("cc @admin and @teacher")
        assert "@\u200badmin" in result
        assert "@\u200bteacher" in result

    def test_escapes_issue_refs(self) -> None:
        result = _neutralize_markdown("see #123 and #456")
        assert "#\u200b123" in result
        assert "#\u200b456" in result

    def test_preserves_email_at_sign(self) -> None:
        # @ preceded by word char should not be escaped
        result = _neutralize_markdown("user@example.com")
        assert result == "user@example.com"

    def test_preserves_non_numeric_hash(self) -> None:
        result = _neutralize_markdown("#heading text")
        assert result == "#heading text"


class TestValidateShape:
    def test_strips_control_chars(self) -> None:
        text = "hello\x00world\x07test"
        assert _validate_shape(text) == "helloworldtest"

    def test_preserves_newlines_and_tabs(self) -> None:
        text = "line1\nline2\ttab"
        assert _validate_shape(text) == text

    def test_caps_newlines(self) -> None:
        text = "\n".join(f"line{i}" for i in range(200))
        result = _validate_shape(text)
        assert result.count("\n") == 100


class TestValidatePageUrl:
    def test_rejects_non_http_scheme(self) -> None:
        with pytest.raises(HTTPException) as exc:
            _validate_page_url("ftp://example.com/page")
        assert exc.value.status_code == 422

    def test_rejects_javascript_scheme(self) -> None:
        with pytest.raises(HTTPException) as exc:
            _validate_page_url("javascript:alert(1)")
        assert exc.value.status_code == 422

    def test_accepts_http(self) -> None:
        result = _validate_page_url("http://localhost:5173/images")
        assert result == "http://localhost:5173/images"

    def test_accepts_https(self) -> None:
        result = _validate_page_url("https://hriv.example.ca/browse")
        assert result == "https://hriv.example.ca/browse"

    def test_strips_sensitive_query_params(self) -> None:
        url = "https://app.example.com/page?view=grid&token=secret123&page=1"
        result = _validate_page_url(url)
        assert "token" not in result
        assert "secret123" not in result
        assert "view=grid" in result
        assert "page=1" in result

    def test_rejects_unrecognized_host_when_cors_configured(self) -> None:
        with patch(
            "app.routers.issues.Settings",
            return_value=SimpleNamespace(cors_origins="https://hriv.example.ca"),
        ):
            with pytest.raises(HTTPException) as exc:
                _validate_page_url("https://evil.com/phish")
            assert exc.value.status_code == 422

    def test_allows_recognized_host_when_cors_configured(self) -> None:
        with patch(
            "app.routers.issues.Settings",
            return_value=SimpleNamespace(cors_origins="https://hriv.example.ca"),
        ):
            result = _validate_page_url("https://hriv.example.ca/browse")
            assert "hriv.example.ca" in result

    def test_allows_any_host_when_cors_is_wildcard(self) -> None:
        # Default is "*" so all hosts allowed
        result = _validate_page_url("https://any-host.dev/page")
        assert "any-host.dev" in result

    def test_strips_space_injected_mentions(self) -> None:
        result = _validate_page_url("https://localhost/p @victim1 @victim2")
        assert "@victim" not in result
        assert result == "https://localhost/p"

    def test_strips_vertical_tab_injected_mentions(self) -> None:
        result = _validate_page_url("https://localhost/page\x0b@victim")
        assert "@victim" not in result
        assert result == "https://localhost/page"
