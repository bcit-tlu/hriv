"""Kubernetes readiness probe served through the included-router path.

``/api/_probe`` performs the same checks as ``/api/health/ready`` (fresh
database connection plus storage writability) but is registered via
``app.include_router`` so each probe request travels the full middleware
chain and included-router dispatch — the same machinery real API endpoints
depend on. A readiness target registered directly on ``app`` (the
``/api/health*`` handlers) can keep answering 200 while a middleware or
route-tree regression 500s every routed endpoint, leaving Kubernetes blind
to a full API outage (see #1473).

The path is deliberately *not* covered by ``OTEL_PYTHON_FASTAPI_EXCLUDED_URLS``:
the probe must exercise the instrumented request path it canaries. Log noise
is controlled via ``audit_exclude_prefixes`` (DEBUG-level request log) and
the frontend nginx config blocks the path on the public ingress — kubelet
probes reach the pod's HTTP port directly.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter()


@router.get("/_probe", include_in_schema=False)
async def routed_probe() -> dict[str, str]:
    """Readiness check traversing the included-router request path."""
    # Deferred import: app.main imports this module at startup, so
    # module-level symbols from main are only resolvable at call time.
    from ..main import _check_db_ready, _check_storage_ready, app

    if not await _check_db_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unreachable",
        )
    if not await _check_storage_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Storage not writable",
        )
    return {"status": "ready", "version": app.version}
