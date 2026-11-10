"""Tests for ``app.media_tokens`` (#1835)."""

from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.auth import auth_settings
from app.media_tokens import (
    MEDIA_TOKEN_PURPOSE,
    MediaTokenError,
    issue_media_token,
    media_url,
    tokenized_media_url,
    validate_media_token,
)


def test_issue_validate_round_trip() -> None:
    token = issue_media_token(7)
    validate_media_token(token, 7)
    payload = jwt.decode(token, auth_settings.jwt_secret, algorithms=[auth_settings.jwt_algorithm])
    assert payload["purpose"] == MEDIA_TOKEN_PURPOSE and payload["mid"] == 7


def test_wrong_id_is_403_and_garbage_is_401() -> None:
    token = issue_media_token(7)
    with pytest.raises(MediaTokenError) as exc:
        validate_media_token(token, 8)
    assert exc.value.status_code == 403
    with pytest.raises(MediaTokenError) as exc:
        validate_media_token("not-a-token", 7)
    assert exc.value.status_code == 401


def test_expired_and_foreign_purpose_tokens_are_401() -> None:
    expired = jwt.encode(
        {"purpose": MEDIA_TOKEN_PURPOSE, "mid": 7, "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        auth_settings.jwt_secret,
        algorithm=auth_settings.jwt_algorithm,
    )
    with pytest.raises(MediaTokenError) as exc:
        validate_media_token(expired, 7)
    assert exc.value.status_code == 401
    tile = jwt.encode(
        {"purpose": "tile", "sid": 7, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        auth_settings.jwt_secret,
        algorithm=auth_settings.jwt_algorithm,
    )
    with pytest.raises(MediaTokenError) as exc:
        validate_media_token(tile, 7)
    assert exc.value.status_code == 401


def test_urls() -> None:
    assert media_url(3) == "/api/media/3"
    url = tokenized_media_url(3)
    assert url.startswith("/api/media/3?token=")
    validate_media_token(url.split("token=", 1)[1], 3)
