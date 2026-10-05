"""Tests for the users router endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers import users as users_router
from app.routers.users import (
    VALID_ROLES,
    _set_user_programs,
    list_users,
    get_user,
    create_user,
    update_user,
    bulk_update_program,
    bulk_update_role,
    bulk_update_active,
    bulk_delete_users,
    delete_user,
)
from fastapi import Response

from app.models import User
from app.schemas import (
    UserCreate,
    UserUpdate,
    UserBulkUpdate,
    UserBulkRoleUpdate,
    UserBulkActiveUpdate,
    UserBulkDelete,
)
from app.serializers import user_to_mini_out, user_to_out


def _make_program(id: int = 1, name: str = "Biology") -> SimpleNamespace:
    return SimpleNamespace(id=id, name=name)


def _make_user(
    id: int = 1,
    name: str = "Test User",
    email: str = "test@example.com",
    role: str = "student",
    active: bool = True,
    programs: list | None = None,
    groups: list | None = None,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        name=name,
        email=email,
        password_hash="hashed",
        role=role,
        active=active,
        programs=programs or [],
        groups=groups or [],
        metadata_=None,
        last_access=now,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture(autouse=True)
def _patch_browse_bump(monkeypatch: pytest.MonkeyPatch) -> None:
    """bump_browse_revision writes to browse_state; stub it for mocked
    sessions (#1527 — owner names render on filed collection tiles)."""
    monkeypatch.setattr(
        "app.routers.users.bump_browse_revision", AsyncMock(return_value=1)
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
    assert data["active"] is True
    assert data["program_names"] == []
    assert data["program_ids"] == []


def test_user_to_out_includes_groups() -> None:
    group = SimpleNamespace(id=7, name="Field Studies")
    user = _make_user(groups=[group])
    data = user_to_out(user)
    assert data["group_ids"] == [7]
    assert data["group_names"] == ["Field Studies"]


def test_user_to_mini_out_hides_groups() -> None:
    """Other users' group memberships must not leak via the minimal listing."""
    group = SimpleNamespace(id=7, name="Field Studies")
    user = _make_user(groups=[group])
    data = user_to_mini_out(user)
    assert data["group_ids"] == []
    assert data["group_names"] == []


async def test_list_users() -> None:
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_users(MagicMock(), db)
    assert len(result) == 2


async def test_list_users_as_instructor() -> None:
    """Instructors should be able to list users (for search results)."""
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    instructor = _make_user(id=99, role="instructor")
    result = await list_users(instructor, db)
    assert len(result) == 2


async def test_list_users_instructor_can_list_instructors() -> None:
    """Instructors must be able to list other instructors for co-ownership."""
    users = [_make_user(id=1, role="instructor")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = (
        users
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    instructor = _make_user(id=99, role="instructor")
    result = await list_users(instructor, db, role="instructor")
    assert len(result) == 1


async def test_list_users_instructor_cannot_list_admins() -> None:
    db = AsyncMock()
    instructor = _make_user(id=99, role="instructor")
    with pytest.raises(HTTPException) as exc:
        await list_users(instructor, db, role="admin")
    assert exc.value.status_code == 403


async def test_list_users_instructor_cannot_list_staff() -> None:
    """Instructors are scoped to students/instructors — staff are excluded."""
    db = AsyncMock()
    instructor = _make_user(id=99, role="instructor")
    with pytest.raises(HTTPException) as exc:
        await list_users(instructor, db, role="staff")
    assert exc.value.status_code == 403


async def test_list_users_as_staff_gets_full_projection() -> None:
    """Staff receive the full ``UserOut`` projection (unlike the instructor
    mini projection) — the People tab is their read-only directory view."""
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    staff = _make_user(id=98, role="staff")
    result = await list_users(staff, db)
    assert len(result) == 2
    # Full projection exposes metadata/last_access fields; mini would not.
    assert "last_access" in result[0]
    assert "metadata_extra" in result[0]


async def test_list_users_staff_can_filter_any_role() -> None:
    """Staff may filter by any valid role, including admin — read-only."""
    users = [_make_user(id=1, role="admin")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users
    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    staff = _make_user(id=98, role="staff")
    result = await list_users(staff, db, role="admin")
    assert len(result) == 1


async def test_list_users_staff_does_not_filter_admin_program() -> None:
    """Staff see every user, including Admin-program members — same
    unrestricted query shape as admins."""
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = []
    mock_result.scalar_one.return_value = 0

    statements: list = []

    async def mock_execute(stmt):
        statements.append(stmt)
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)

    await list_users(_make_user(role="staff"), db)

    compiled = str(statements[1].compile(compile_kwargs={"literal_binds": True}))
    assert "Admin" not in compiled


async def test_list_users_invalid_role_422() -> None:
    db = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await list_users(_make_user(role="admin"), db, role="bogus")
    assert exc.value.status_code == 422


def test_user_to_mini_out_includes_programs() -> None:
    """Mini projection exposes program info (for the membership picker filter
    + chips) but hides metadata/last_access."""
    prog = _make_program(2, "Digital Design")
    user = _make_user(id=3, name="Mira Patel", programs=[prog])
    data = user_to_mini_out(user)
    assert data["active"] is True
    assert data["program_ids"] == [2]
    assert data["program_names"] == ["Digital Design"]
    assert data["metadata_extra"] is None
    assert data["last_access"] is None


async def test_list_users_program_filter() -> None:
    """program_id filters server-side; instructor sees program chips."""
    prog = _make_program(2, "Digital Design")
    users = [_make_user(id=3, name="Mira Patel", programs=[prog])]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users
    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    instructor = _make_user(id=99, role="instructor")
    result = await list_users(instructor, db, role="student", program_id=[2])
    assert len(result) == 1
    assert result[0]["program_ids"] == [2]


async def test_list_users_program_filter_multi_or() -> None:
    """Multiple program_id values filter with OR (IN) semantics."""
    users = [_make_user(id=3), _make_user(id=4, email="four@example.com")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users
    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_users(
        _make_user(role="admin"), db, program_id=[1, 2],
    )
    assert len(result) == 2


async def test_list_users_search_q() -> None:
    """q is accepted and the query executes (filter is applied in SQL)."""
    users = [_make_user(id=3, name="Mira Patel")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users
    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_users(_make_user(role="admin"), db, q="mira")
    assert len(result) == 1


async def test_list_users_pagination_sets_total_count_header() -> None:
    """When page/page_size are supplied, the pre-pagination total is returned
    in the X-Total-Count response header."""
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users
    mock_result.scalar_one.return_value = 42
    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    response = Response()
    result = await list_users(
        _make_user(role="admin"), db, page=1, page_size=2, response=response,
    )
    assert len(result) == 2
    assert response.headers["X-Total-Count"] == "42"


async def test_list_users_instructor_excludes_admin_program() -> None:
    """Instructors must not see users associated with the Admin program."""
    admin_prog = _make_program(1, "Admin")
    normal_prog = _make_program(2, "Biology")
    users = [
        _make_user(id=1, programs=[normal_prog]),
        _make_user(id=2, email="synthetic@example.com", programs=[admin_prog]),
    ]
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = users
    mock_result.scalar_one.return_value = 2

    statements: list = []

    async def mock_execute(stmt):
        statements.append(stmt)
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)

    instructor = _make_user(id=99, role="instructor")
    await list_users(instructor, db)

    # Two SQL calls: count and select.
    assert len(statements) == 2
    compiled = str(statements[1].compile(compile_kwargs={"literal_binds": True}))
    assert "Admin" in compiled
    assert "NOT EXISTS" in compiled or "NOT" in compiled


async def test_list_users_admin_does_not_filter_admin_program() -> None:
    """Admins must still see every user, including Admin-program members."""
    mock_result = MagicMock()
    mock_result.scalars.return_value.unique.return_value.all.return_value = []
    mock_result.scalar_one.return_value = 0

    statements: list = []

    async def mock_execute(stmt):
        statements.append(stmt)
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)

    await list_users(_make_user(role="admin"), db)

    compiled = str(statements[1].compile(compile_kwargs={"literal_binds": True}))
    assert "Admin" not in compiled


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
    # The post-commit refresh must reload BOTH programs and groups, because
    # user_to_out now reads user.groups; refreshing only programs would leave
    # the groups relationship expired and raise MissingGreenlet on access.
    assert db.refresh.await_args_list[-1].args[1] == ["programs", "groups"]
    assert result["group_ids"] == []


async def test_create_user_staff_role_accepted() -> None:
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = UserCreate(
        name="Staff User", email="staff@example.com",
        password="pass123", role="staff",
    )

    with patch("app.routers.users.hash_password", return_value="hashed"):
        result = await create_user(body, MagicMock(), db)

    assert result["role"] == "staff"


async def test_create_user_invalid_role_rejected() -> None:
    db = AsyncMock()
    body = UserCreate(
        name="Bogus", email="bogus@example.com",
        password="pass123", role="superuser",
    )
    with pytest.raises(HTTPException) as exc:
        await create_user(body, MagicMock(), db)
    assert exc.value.status_code == 422
    assert "Invalid role" in exc.value.detail


async def test_update_user_staff_role_accepted() -> None:
    user = _make_user()

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await update_user(1, UserUpdate(role="staff"), MagicMock(), db)
    assert user.role == "staff"
    assert result["role"] == "staff"


async def test_update_user_invalid_role_rejected() -> None:
    user = _make_user()
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)

    with pytest.raises(HTTPException) as exc:
        await update_user(1, UserUpdate(role="superuser"), MagicMock(), db)
    assert exc.value.status_code == 422
    assert "Invalid role" in exc.value.detail


async def test_update_user_null_role_rejected() -> None:
    user = _make_user()
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)

    with pytest.raises(HTTPException) as exc:
        await update_user(1, UserUpdate(role=None), MagicMock(), db)
    assert exc.value.status_code == 422
    assert "Invalid role" in exc.value.detail


async def test_update_user_success() -> None:
    user = _make_user()

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = UserUpdate(name="Updated")
    result = await update_user(1, body, MagicMock(), db)

    assert user.name == "Updated"
    # Post-commit refresh must reload all attributes (no attribute list).
    # The session uses expire_on_commit=False, so attributes are not expired
    # after commit. However, onupdate=func.now() on updated_at causes the DB
    # to generate a new server-side timestamp during UPDATE that the Python
    # object never sees without a full refresh. Passing an attribute list
    # (e.g. ["programs", "groups"]) would only reload those relationships,
    # leaving updated_at stale. db.refresh(user) reloads everything.
    last_refresh_call = db.refresh.await_args_list[-1]
    assert len(last_refresh_call.args) == 1  # only the user object, no attr list
    assert result["group_ids"] == []


async def test_update_user_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    body = UserUpdate(name="New")
    with pytest.raises(HTTPException) as exc:
        await update_user(999, body, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_update_user_self_deactivate_rejected() -> None:
    admin = _make_user(id=7, role="admin", active=True)
    db = AsyncMock()
    db.get = AsyncMock(return_value=admin)

    with pytest.raises(HTTPException) as exc:
        await update_user(7, UserUpdate(active=False), admin, db)
    assert exc.value.status_code == 400
    assert "own account" in exc.value.detail


async def test_update_user_active_null_rejected() -> None:
    admin = _make_user(id=7, role="admin", active=True)
    db = AsyncMock()
    db.get = AsyncMock(return_value=_make_user(id=8, role="student", active=True))

    with pytest.raises(HTTPException) as exc:
        await update_user(8, UserUpdate(active=None), admin, db)
    assert exc.value.status_code == 422
    assert "active must be true or false" in exc.value.detail


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

    owns = MagicMock()
    owns.first.return_value = None
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.execute = AsyncMock(return_value=owns)
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


async def test_bulk_update_role_staff_accepted() -> None:
    users = [_make_user(id=1, role="student")]

    async def mock_execute(_stmt):
        mock_result = MagicMock()
        mock_result.scalars.return_value.unique.return_value.all.return_value = users
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)
    db.commit = AsyncMock()

    body = UserBulkRoleUpdate(user_ids=[1], role="staff")
    result = await bulk_update_role(body, MagicMock(), db)

    assert len(result) == 1
    assert users[0].role == "staff"


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


# ── Bulk Active Update ───────────────────────────────────


async def test_bulk_update_active_success() -> None:
    users = [_make_user(id=1, active=True), _make_user(id=2, email="two@example.com", active=True)]

    async def mock_execute(_stmt):
        mock_result = MagicMock()
        mock_result.scalars.return_value.unique.return_value.all.return_value = users
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)
    db.commit = AsyncMock()

    body = UserBulkActiveUpdate(user_ids=[1, 2], active=False)
    result = await bulk_update_active(body, _make_user(id=99, role="admin"), db)

    assert len(result) == 2
    assert users[0].active is False
    assert users[1].active is False


async def test_bulk_update_active_self_deactivate_rejected() -> None:
    db = AsyncMock()

    body = UserBulkActiveUpdate(user_ids=[1, 2], active=False)
    with pytest.raises(HTTPException) as exc:
        await bulk_update_active(body, _make_user(id=1, role="admin"), db)
    assert exc.value.status_code == 400
    assert "own account" in exc.value.detail


# ── Bulk Delete ──────────────────────────────────────────


def _collection_for_delete(
    owner_ids: list[int],
    category_id: int | None = None,
    owner_program_id: int | None = None,
) -> MagicMock:
    """A collection row as ``_delete_sole_owned_collections`` inspects it."""
    col = MagicMock()
    col.category_id = category_id
    col.owner_program_id = owner_program_id
    col.owners = [SimpleNamespace(id=i) for i in owner_ids]
    return col


def _execute_for_delete(users: list, collections: list | None = None):
    """Dispatch ``db.execute`` by selected entity — the user fetch first,
    then the affected-collections query inside
    ``_delete_sole_owned_collections`` (#1531)."""
    async def mock_execute(stmt):
        entity = getattr(stmt, "column_descriptions", [{}])[0].get("entity")
        rows = users if entity is User else (collections or [])
        mock_result = MagicMock()
        mock_result.scalars.return_value.unique.return_value.all.return_value = rows
        mock_result.scalars.return_value.all.return_value = rows
        return mock_result

    return mock_execute


async def test_bulk_delete_users_success() -> None:
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]

    admin = _make_user(id=99, role="admin")

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=_execute_for_delete(users))
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    body = UserBulkDelete(user_ids=[1, 2])
    await bulk_delete_users(body, admin, db)

    assert db.delete.await_count == 2


async def test_bulk_delete_co_owned_collection_survives() -> None:
    """A collection survives bulk user deletion while another owner row or a
    program owner remains (#1531); only the departing owner rows cascade."""
    users = [_make_user(id=1), _make_user(id=2, email="two@example.com")]
    co_owned = _collection_for_delete([1, 5], category_id=7)
    program_owned = _collection_for_delete([2], category_id=7, owner_program_id=3)
    dying = _collection_for_delete([1, 2], category_id=7)

    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=_execute_for_delete(users, [co_owned, program_owned, dying])
    )
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await bulk_delete_users(
        UserBulkDelete(user_ids=[1, 2]), _make_user(id=99, role="admin"), db
    )

    deleted = [c.args[0] for c in db.delete.await_args_list]
    assert dying in deleted
    assert co_owned not in deleted and program_owned not in deleted
    # Filed collections were affected → the tree ETag advances.
    users_router.bump_browse_revision.assert_awaited_once()


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


# ── Browse revision invalidation (epic #1525 / #1527) ──


async def test_update_user_rename_bumps_browse_revision() -> None:
    """Owner names render on filed collection tiles — a rename must
    invalidate the category-tree ETag."""
    user = _make_user(id=1, name="Ada")
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    await update_user(1, UserUpdate(name="Grace"), MagicMock(), db)
    users_router.bump_browse_revision.assert_awaited_once()


async def test_update_user_non_name_change_skips_browse_bump() -> None:
    user = _make_user(id=1, name="Ada")
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    await update_user(1, UserUpdate(role="instructor"), MagicMock(), db)
    users_router.bump_browse_revision.assert_not_awaited()


async def test_delete_user_owning_filed_collection_bumps() -> None:
    """A sole-owned filed collection dies with the user (#1531) — it
    disappears from the tree, so the ETag must advance."""
    admin = _make_user(id=99, role="admin")
    user = _make_user(id=1)
    col = _collection_for_delete([1], category_id=7)
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.execute = AsyncMock(side_effect=_execute_for_delete([user], [col]))
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_user(1, admin, db)
    users_router.bump_browse_revision.assert_awaited_once()
    deleted = [c.args[0] for c in db.delete.await_args_list]
    assert col in deleted and user in deleted


async def test_delete_user_co_owned_collection_survives() -> None:
    """A co-owned filed collection survives: the departing owner's row
    cascades away but the collection (and its tile) remain (#1531). The
    ETag still advances — the tile's owner display changed."""
    admin = _make_user(id=99, role="admin")
    user = _make_user(id=1)
    co_owned = _collection_for_delete([1, 5], category_id=7)
    program_owned = _collection_for_delete([1], category_id=7, owner_program_id=3)
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.execute = AsyncMock(
        side_effect=_execute_for_delete([user], [co_owned, program_owned])
    )
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_user(1, admin, db)
    users_router.bump_browse_revision.assert_awaited_once()
    deleted = [c.args[0] for c in db.delete.await_args_list]
    assert co_owned not in deleted and program_owned not in deleted
    assert user in deleted


async def test_delete_user_unfiled_sole_owned_dies_without_bump() -> None:
    """An unfiled sole-owned collection still dies, but no Browse tile is
    affected so the ETag stays put."""
    admin = _make_user(id=99, role="admin")
    user = _make_user(id=1)
    col = _collection_for_delete([1], category_id=None)
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.execute = AsyncMock(side_effect=_execute_for_delete([user], [col]))
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_user(1, admin, db)
    users_router.bump_browse_revision.assert_not_awaited()
    deleted = [c.args[0] for c in db.delete.await_args_list]
    assert col in deleted and user in deleted


async def test_delete_user_without_filed_collections_skips_bump() -> None:
    admin = _make_user(id=99, role="admin")
    user = _make_user(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    db.execute = AsyncMock(side_effect=_execute_for_delete([user]))
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_user(1, admin, db)
    users_router.bump_browse_revision.assert_not_awaited()
