"""Tests for the users router endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.users import (
    VALID_ROLES,
    _set_user_programs,
    list_users,
    get_user,
    create_user,
    update_user,
    bulk_update_program,
    bulk_update_role,
    bulk_delete_users,
    delete_user,
)
from app.schemas import UserCreate, UserUpdate, UserBulkUpdate, UserBulkRoleUpdate, UserBulkDelete
from app.serializers import user_to_out


def _make_program(id: int = 1, name: str = "Biology") -> SimpleNamespace:
    return SimpleNamespace(id=id, name=name)


def _make_user(
    id: int = 1,
    name: str = "Test User",
    email: str = "test@example.com",
    role: str = "student",
    programs: list | None = None,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        name=name,
        email=email,
        password_hash="hashed",
        role=role,
        programs=programs or [],
        metadata_=None,
        last_access=now,
        created_at=now,
        updated_at=now,
    )


def test_user_to_out_with_programs() -> None:
    prog = _make_program(1, "Biology")
    user = _make_user(programs=[prog])
    data = user_to_out(user)
    assert data["program_names"] == ["Biology"]
    assert data["program_ids"] == [1]


def test_user_to_out_without_programs() -> None:
    user = _make_user()
    data = user_to_out(user)
    assert data["program_names"] == []
    assert data["program_ids"] == []


async def test_list_users() -> None:
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    admin = _make_user(id=1, role="admin")
    result = await list_users(admin, db)
    assert len(result) == 2


async def test_list_users_as_instructor_scoped_to_tenant_students() -> None:
    """Instructors only see students belonging to one of their tenants."""
    students = [
        _make_user(id=1, role="student"),
        _make_user(id=2, role="student", email="two@example.com"),
    ]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = students

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    tenant = SimpleNamespace(id=5, name="MedLab", parent_program_id=None)
    instructor = _make_user(id=99, role="instructor", programs=[tenant])
    result = await list_users(instructor, db)
    assert len(result) == 2
    db.execute.assert_awaited_once()


async def test_list_users_instructor_without_tenants_returns_empty() -> None:
    db = AsyncMock()
    db.execute = AsyncMock()
    instructor = _make_user(id=99, role="instructor", programs=[])
    result = await list_users(instructor, db)
    assert result == []
    db.execute.assert_not_awaited()


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
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = UserCreate(name="New User", email="new@example.com", password="pass123")

    with patch("app.routers.users.hash_password", return_value="hashed"):
        result = await create_user(body, MagicMock(), db)

    db.add.assert_called_once()
    # programs must be refreshed before _set_user_programs to avoid
    # MissingGreenlet when assigning the collection in async context
    assert db.refresh.await_count == 2


async def test_update_user_success() -> None:
    user = _make_user()

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

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

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = UserUpdate(password="newpassword")

    with patch("app.routers.users.hash_password", return_value="new_hash") as mock_hash:
        result = await update_user(1, body, MagicMock(), db)
        mock_hash.assert_called_once_with("newpassword")

    assert user.password_hash == "new_hash"


async def test_update_user_with_metadata() -> None:
    user = _make_user()

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = UserUpdate(metadata_extra={"key": "val"})
    result = await update_user(1, body, MagicMock(), db)

    assert user.metadata_ == {"key": "val"}


async def test_bulk_update_program_success() -> None:
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]

    call_count = 0
    prog = _make_program(5, "Physics")

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        mock_result = MagicMock()
        if call_count == 1:
            # Select users
            mock_result.scalars.return_value.unique.return_value.all.return_value = users
        elif call_count <= 3:
            # _set_user_programs for each user: select programs
            mock_result.scalars.return_value.all.return_value = [prog]
        else:
            # Reload
            mock_result.scalars.return_value.unique.return_value.all.return_value = users
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)
    db.commit = AsyncMock()

    body = UserBulkUpdate(user_ids=[1, 2], program_ids=[5])
    result = await bulk_update_program(body, MagicMock(), db)

    assert len(result) == 2


async def test_bulk_update_program_not_found() -> None:
    users = [_make_user(id=1)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users

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


async def test_set_user_programs_invalid_ids() -> None:
    user = _make_user()
    prog = _make_program(1, "Biology")
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [prog]

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    with pytest.raises(HTTPException) as exc:
        await _set_user_programs(db, user, [1, 999])
    assert exc.value.status_code == 422
    assert "999" in str(exc.value.detail)


# ── Bulk Role Update ─────────────────────────────────────


async def test_bulk_update_role_success() -> None:
    users = [_make_user(id=1, role="student"), _make_user(id=2, email="two@example.com", role="student")]

    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        mock_result = MagicMock()
        mock_result.scalars.return_value.unique.return_value.all.return_value = users
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)
    db.commit = AsyncMock()

    body = UserBulkRoleUpdate(user_ids=[1, 2], role="instructor")
    result = await bulk_update_role(body, MagicMock(), db)

    assert len(result) == 2
    assert users[0].role == "instructor"
    assert users[1].role == "instructor"


async def test_bulk_update_role_invalid_role() -> None:
    db = AsyncMock()

    body = UserBulkRoleUpdate(user_ids=[1], role="superuser")
    with pytest.raises(HTTPException) as exc:
        await bulk_update_role(body, MagicMock(), db)
    assert exc.value.status_code == 422
    assert "Invalid role" in exc.value.detail


async def test_bulk_update_role_not_found() -> None:
    users = [_make_user(id=1)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = UserBulkRoleUpdate(user_ids=[1, 2, 3], role="admin")
    with pytest.raises(HTTPException) as exc:
        await bulk_update_role(body, MagicMock(), db)
    assert exc.value.status_code == 404


# ── Bulk Delete ──────────────────────────────────────────


async def test_bulk_delete_users_success() -> None:
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users

    admin = _make_user(id=99, role="admin")

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    body = UserBulkDelete(user_ids=[1, 2])
    await bulk_delete_users(body, admin, db)

    assert db.delete.await_count == 2


async def test_bulk_delete_users_self() -> None:
    admin = _make_user(id=1, role="admin")
    db = AsyncMock()

    body = UserBulkDelete(user_ids=[1, 2])
    with pytest.raises(HTTPException) as exc:
        await bulk_delete_users(body, admin, db)
    assert exc.value.status_code == 400
    assert "own account" in exc.value.detail


async def test_bulk_delete_users_not_found() -> None:
    users = [_make_user(id=1)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users

    admin = _make_user(id=99, role="admin")

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = UserBulkDelete(user_ids=[1, 2, 3])
    with pytest.raises(HTTPException) as exc:
        await bulk_delete_users(body, admin, db)
    assert exc.value.status_code == 404
