"""Tests for canonical auth structured-log field helpers."""

from __future__ import annotations

from types import SimpleNamespace

from app.auth_events import (
    AUTH_METHOD_LOCAL,
    AUTH_METHOD_OIDC,
    AUTH_OUTCOME_FAILURE,
    AUTH_OUTCOME_SUCCESS,
    actor_log_fields,
    auth_event_fields,
    is_synthetic_user,
)


def test_is_synthetic_user_reads_metadata() -> None:
    assert is_synthetic_user(SimpleNamespace(metadata_={"synthetic": True})) is True
    assert is_synthetic_user(SimpleNamespace(metadata_={"synthetic": False})) is False
    assert is_synthetic_user(SimpleNamespace(metadata_={})) is False
    assert is_synthetic_user(SimpleNamespace(metadata_=None)) is False
    assert is_synthetic_user(None) is False


def test_auth_event_fields_from_user() -> None:
    user = SimpleNamespace(id=12, role="instructor", metadata_={"synthetic": True})
    fields = auth_event_fields(
        method=AUTH_METHOD_OIDC, outcome=AUTH_OUTCOME_SUCCESS, user=user
    )
    assert fields == {
        "auth.method": "oidc",
        "auth.outcome": "success",
        "auth.synthetic": True,
        "auth.user_id": 12,
        "auth.role": "instructor",
    }


def test_auth_event_fields_failure_without_user() -> None:
    fields = auth_event_fields(
        method=AUTH_METHOD_LOCAL, outcome=AUTH_OUTCOME_FAILURE
    )
    assert fields == {
        "auth.method": "local",
        "auth.outcome": "failure",
        "auth.synthetic": False,
    }
    assert "auth.user_id" not in fields
    assert "auth.role" not in fields


def test_auth_event_fields_explicit_overrides() -> None:
    fields = auth_event_fields(
        method=AUTH_METHOD_LOCAL,
        outcome=AUTH_OUTCOME_SUCCESS,
        user_id=3,
        role="admin",
    )
    assert fields["auth.user_id"] == 3
    assert fields["auth.role"] == "admin"
    assert fields["auth.synthetic"] is False


def test_actor_log_fields_includes_user_and_synthetic() -> None:
    user = SimpleNamespace(id=42, role="instructor", metadata_={"synthetic": True})
    fields = actor_log_fields(user)
    assert fields["user.id"] == 42
    assert fields["user.role"] == "instructor"
    assert fields["event.synthetic"] is True


def test_actor_log_fields_missing_user_is_non_synthetic() -> None:
    fields = actor_log_fields(None)
    assert fields["event.synthetic"] is False
    assert "user.id" not in fields
    assert "user.role" not in fields


def test_actor_log_fields_records_client_synthetic_hint() -> None:
    user = SimpleNamespace(id=7, role="admin", metadata_={"synthetic": False})
    fields = actor_log_fields(user, client_synthetic=True)
    assert fields["event.client_synthetic"] is True
    assert fields["user.id"] == 7
    assert fields["event.synthetic"] is False
