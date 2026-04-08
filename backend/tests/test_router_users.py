"""Tests for the users router endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.users import (
    _user_to_out,
    list_users,
    get_user,
    create_user,
    update_user,
    bulk_update_program,
    delete_user,
)
from app.schemas import UserCreate, UserUpdate, UserBulkUpdate


def _make_user(
    id: int = 1,
    name: str = "Test User",
    email: str = "test@example.com",
    role: str = "student",
    program_id: int | None = None,
    program_rel: object = None,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        name=name,
        email=email,
        password_hash="hashed",
        role=role,
        program_id=program_id,
        program_rel=program_rel,
        metadata_=None,
        last_access=now,
        created_at=now,
        updated_at=now,
    )


def test_user_to_out_with_program() -> None:
    prog = SimpleNamespace(name="Biology")
    user = _make_user(program_id=1, program_rel=prog)
    data = _user_to_out(user)
    assert data["program_name"] == "Biology"
    assert data["program_id"] == 1


def test_user_to_out_without_program() -> None:
    user = _make_user()
    data = _user_to_out(user)
    assert data["program_name"] is None


async def test_list_users() -> None:
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = users

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_users(MagicMock(), db)
    assert len(result) == 2


async def test_get_user_found() -> None:
    user = _make_user()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await get_user(1, MagicMock(), db)
    assert result["email"] == "test@example.com"


async def test_get_user_not_found() -> None:
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    with pytest.raises(HTTPException) as exc:
        await get_user(999, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_create_user_success() -> None:
    user = _make_user()
    mock_result = MagicMock()
    mock_result.scalar_one.return_value = user

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = UserCreate(name="New User", email="new@example.com", password="pass123")

    with patch("app.routers.users.hash_password", return_value="hashed"):
        result = await create_user(body, MagicMock(), db)

    db.add.assert_called_once()
    assert result["email"] == "test@example.com"


async def test_update_user_success() -> None:
    user = _make_user()
    updated_user = _make_user(name="Updated")

    mock_result = MagicMock()
    mock_result.scalar_one.return_value = updated_user

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = UserUpdate(name="Updated")
    result = await update_user(1, body, MagicMock(), db)

    assert user.name == "Updated"


async def test_update_user_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    body = UserUpdate(name="New")
    with pytest.raises(HTTPException) as exc:
        await update_user(999, body, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_update_user_with_password() -> None:
    user = _make_user()
    updated_user = _make_user()

    mock_result = MagicMock()
    mock_result.scalar_one.return_value = updated_user

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = UserUpdate(password="newpassword")

    with patch("app.routers.users.hash_password", return_value="new_hash") as mock_hash:
        result = await update_user(1, body, MagicMock(), db)
        mock_hash.assert_called_once_with("newpassword")

    assert user.password_hash == "new_hash"


async def test_update_user_with_metadata() -> None:
    user = _make_user()
    updated_user = _make_user()

    mock_result = MagicMock()
    mock_result.scalar_one.return_value = updated_user

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = UserUpdate(metadata_extra={"key": "val"})
    result = await update_user(1, body, MagicMock(), db)

    assert user.metadata_ == {"key": "val"}


async def test_bulk_update_program_success() -> None:
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]

    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = users
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)
    db.commit = AsyncMock()

    body = UserBulkUpdate(user_ids=[1, 2], program_id=5)
    result = await bulk_update_program(body, MagicMock(), db)

    assert len(result) == 2
    for u in users:
        assert u.program_id == 5


async def test_bulk_update_program_not_found() -> None:
    users = [_make_user(id=1)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = users

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = UserBulkUpdate(user_ids=[1, 2, 3])  # 3 IDs, only 1 found
    with pytest.raises(HTTPException) as exc:
        await bulk_update_program(body, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_delete_user_success() -> None:
    admin = _make_user(id=99, role="admin")
    user = _make_user(id=1)

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_user(1, admin, db)
    db.delete.assert_awaited_once_with(user)


async def test_delete_user_self() -> None:
    admin = _make_user(id=1, role="admin")

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await delete_user(1, admin, db)
    assert exc.value.status_code == 400
    assert "own account" in exc.value.detail


async def test_delete_user_not_found() -> None:
    admin = _make_user(id=99, role="admin")

    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await delete_user(1, admin, db)
    assert exc.value.status_code == 404
