"""Atomic, revisioned tile-order API (epic #975, issue #978).

``PUT /api/tile-order`` persists one combined category+image visual order for
a single root/category scope in ONE database transaction, guarded by a
compare-and-set scope revision. ``GET /api/tile-order`` returns the current
authoritative order and revision so clients can seed ``expected_revision``.

Reordering never rewrites membership (``parent_id`` / ``category_id``) — move
operations stay on the existing category/image endpoints.
"""

import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from opentelemetry import trace
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..browse_state import bump_browse_revision, get_browse_revision
from ..database import get_db
from ..models import Category, TileOrderRevision, User
from ..reorder_telemetry import (
    annotate_reorder_span,
    classify_reorder_exception,
    record_reorder_result,
    sanitize_reorder_operation_id,
)
from ..schemas import (
    TileOrderItemOut,
    TileOrderRequest,
    TileOrderResponse,
    TileOrderScope,
)
from ..tile_order import (
    INITIAL_SCOPE_REVISION,
    load_scope_members,
    load_scope_tiles,
    lock_scope_revision,
    apply_positions,
    bump_scope_revision,
    scope_key_for,
    validate_submitted_items,
)
from ..tracing import record_exception_if_server_error

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

router = APIRouter(prefix="/tile-order", tags=["tile-order"])


async def _require_scope_exists(db: AsyncSession, parent_category_id: int | None) -> None:
    if parent_category_id is None:
        return
    if await db.get(Category, parent_category_id) is None:
        raise HTTPException(status_code=404, detail="Parent category not found")


async def _authoritative_response(
    db: AsyncSession,
    parent_category_id: int | None,
    revision: int,
    browse_revision: int,
) -> TileOrderResponse:
    tiles = await load_scope_tiles(db, parent_category_id)
    # ``sort_order`` is reported as the contiguous canonical position, not the
    # raw stored value, so clients can rely on 0..n-1 even before a scope has
    # ever been written or normalized.
    return TileOrderResponse(
        scope=TileOrderScope(parent_category_id=parent_category_id),
        revision=revision,
        browse_revision=browse_revision,
        items=[
            TileOrderItemOut(type=t.type, id=t.id, sort_order=pos)
            for pos, t in enumerate(tiles)
        ],
    )


@router.get("", response_model=TileOrderResponse)
async def get_tile_order(
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    parent_category_id: Annotated[int | None, Query()] = None,
    db: AsyncSession = Depends(get_db),
    response: Response = None,  # type: ignore[assignment]
):
    """Current authoritative order and revision for one scope (read-only)."""
    await _require_scope_exists(db, parent_category_id)
    result = await db.execute(
        select(TileOrderRevision.revision).where(
            TileOrderRevision.scope_key == scope_key_for(parent_category_id)
        )
    )
    revision = result.scalar_one_or_none() or INITIAL_SCOPE_REVISION
    browse_revision = await get_browse_revision(db)
    if response is not None:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Browse-Revision"] = str(browse_revision)
    return await _authoritative_response(db, parent_category_id, revision, browse_revision)


@router.put("", response_model=TileOrderResponse)
async def put_tile_order(
    body: TileOrderRequest,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    operation_id = sanitize_reorder_operation_id(body.operation_id)
    started = time.perf_counter()
    parent_category_id = body.scope.parent_category_id
    with tracer.start_as_current_span("tile.reorder") as span:
        try:
            span.set_attribute("tile.count", len(body.items))
            annotate_reorder_span(
                span,
                entity="tile",
                operation_id=operation_id,
                item_count=len(body.items),
            )
            await _require_scope_exists(db, parent_category_id)
            scope_key = scope_key_for(parent_category_id)
            current_revision = await lock_scope_revision(db, scope_key)
            category_ids, image_ids = await load_scope_members(db, parent_category_id)
            error = validate_submitted_items(
                [(item.type, item.id) for item in body.items], category_ids, image_ids
            )
            if error is not None:
                raise HTTPException(status_code=400, detail=error)
            browse_revision = await get_browse_revision(db)
            if body.expected_revision != current_revision:
                stale = await _authoritative_response(
                    db, parent_category_id, current_revision, browse_revision
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Stale tile-order revision",
                        "current": stale.model_dump(),
                    },
                )
            await apply_positions(db, [(item.type, item.id) for item in body.items])
            new_revision = await bump_scope_revision(db, scope_key)
            browse_revision = await bump_browse_revision(db)
            response = TileOrderResponse(
                scope=TileOrderScope(parent_category_id=parent_category_id),
                revision=new_revision,
                browse_revision=browse_revision,
                items=[
                    TileOrderItemOut(type=item.type, id=item.id, sort_order=pos)
                    for pos, item in enumerate(body.items)
                ],
            )
            await db.commit()
        except Exception as exc:
            # Guard the rollback so a broken connection cannot replace the
            # original error or skip the metrics below (matches the pattern in
            # routers/admin.py).
            try:
                await db.rollback()
            except Exception as rollback_exc:
                logger.debug("Rollback after failed tile-order write: %s", rollback_exc)
            record_exception_if_server_error(span, exc)
            record_reorder_result(
                entity="tile",
                operation_id=operation_id,
                item_count=len(body.items),
                duration_seconds=time.perf_counter() - started,
                outcome=classify_reorder_exception(exc),
            )
            raise
        record_reorder_result(
            entity="tile",
            operation_id=operation_id,
            item_count=len(body.items),
            duration_seconds=time.perf_counter() - started,
            outcome="success",
        )
    return response
