"""Tests for the programs router endpoints."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers.programs import (
    list_programs,
    get_program,
    create_program,
    update_program,
    delete_program,
)
from app.schemas import ProgramCreate, ProgramUpdate


async def test_list_programs() -> None:
    progs = [SimpleNamespace(id=1, name="Bio"), SimpleNamespace(id=2, name="Chem")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = progs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_programs(MagicMock(), db)
    assert len(result) == 2


async def test_get_program_found() -> None:
    prog = SimpleNamespace(id=1, name="Bio")
    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)

    result = await get_program(1, MagicMock(), db)
    assert result.name == "Bio"


async def test_get_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_program(999, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_create_program_success() -> None:
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ProgramCreate(name="NewProg")
    result = await create_program(body, MagicMock(), db)

    db.add.assert_called_once()
    db.commit.assert_awaited_once()


async def test_create_program_duplicate_name() -> None:
    existing = SimpleNamespace(id=1, name="Existing")
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = existing

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = ProgramCreate(name="Existing")
    with pytest.raises(HTTPException) as exc:
        await create_program(body, MagicMock(), db)
    assert exc.value.status_code == 409


async def test_update_program_success() -> None:
    prog = SimpleNamespace(id=1, name="OldName")

    mock_dup_result = MagicMock()
    mock_dup_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.execute = AsyncMock(return_value=mock_dup_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ProgramUpdate(name="NewName")
    result = await update_program(1, body, MagicMock(), db)

    assert prog.name == "NewName"


async def test_update_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    body = ProgramUpdate(name="NewName")
    with pytest.raises(HTTPException) as exc:
        await update_program(999, body, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_update_program_duplicate_name() -> None:
    prog = SimpleNamespace(id=1, name="OldName")
    existing = SimpleNamespace(id=2, name="Taken")

    mock_dup_result = MagicMock()
    mock_dup_result.scalar_one_or_none.return_value = existing

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.execute = AsyncMock(return_value=mock_dup_result)

    body = ProgramUpdate(name="Taken")
    with pytest.raises(HTTPException) as exc:
        await update_program(1, body, MagicMock(), db)
    assert exc.value.status_code == 409


async def test_delete_program_success() -> None:
    prog = SimpleNamespace(id=1, name="ToDelete")

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_program(1, MagicMock(), db)
    db.delete.assert_awaited_once_with(prog)


async def test_delete_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await delete_program(999, MagicMock(), db)
    assert exc.value.status_code == 404
