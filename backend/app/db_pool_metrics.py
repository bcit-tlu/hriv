"""SQLAlchemy connection-pool observability (issue #1072).

Emits the ``hriv.db.pool.*`` contract for the shared async engine created by
:func:`app.database.get_engine`. Every backend pod runs its own engine and
QueuePool — the API Deployment (``api.db.*`` values) and the dedicated arq
worker Deployment (``redis.worker.db.*`` values) are independent pools with
independent saturation envelopes.

Two emission paths cover both pools:

* OpenTelemetry observable gauges are collected in whichever process hosts
  the pool and exported via OTLP. The collector's
  ``resource_to_telemetry_conversion`` surfaces ``service.name`` as the
  ``service_name`` label, so ``hriv-backend`` (API) and
  ``hriv-backend-worker`` (arq worker) series stay distinguishable. In
  Prometheus the dots flatten to ``hriv_db_pool_*``.
* The same ``hriv_db_pool_*`` names render at ``/api/metrics`` as
  cheap redundancy when the OTLP path is down. The worker Deployment does
  not serve that endpoint, so the scrape payload only ever covers the API
  pod's pool and carries no component label.

The engine is created lazily on first DB use; observers report nothing and
the scrape gauges degrade to ``NaN`` until it exists, so telemetry can
never create the resource it observes (see ``database.get_engine_pool``).

Pool stat semantics are SQLAlchemy ``QueuePool`` introspection: ``size``
is the configured ``pool_size`` capacity, ``checked_in`` is idle
connections held, ``checked_out`` is connections currently lent out, and
``overflow`` is the raw live overflow counter — positive means connections
beyond ``pool_size`` are open, negative means fewer than ``pool_size``
connections exist yet. ``max_overflow`` reports the *configured*
``max_overflow`` (``settings.db_max_overflow``), not the live counter, so
that ``size + max_overflow`` is the real per-pod connection ceiling:
``size + overflow`` would instead equal currently-open connections and a
``checked_out / (size + overflow)`` ratio would read 1.0 whenever every
open connection is in use, even with large ``max_overflow`` headroom.

No ``checkout_wait`` histogram exists: SQLAlchemy's ``checkout`` pool
event fires *after* the pool grants a connection and no checkout-requested
hook precedes it, so queueing wait cannot be measured from pool events
without patching pool internals.
"""

from __future__ import annotations

import logging
from typing import Callable, Iterable

from opentelemetry import metrics
from opentelemetry.metrics import CallbackOptions, Observation
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Gauge,
    generate_latest,
)
from sqlalchemy.pool import Pool

from .database import get_engine_pool, settings

logger = logging.getLogger(__name__)

_meter = metrics.get_meter(__name__)


def _observe_pool_stat(
    pool_method: str,
) -> Callable[[CallbackOptions], Iterable[Observation]]:
    """Build an OTel observer reporting one ``QueuePool`` stat.

    Yields nothing until the shared engine exists, and swallows
    introspection failures so a broken pool can never stall an OTLP
    collection cycle.
    """

    def observe(_options: CallbackOptions) -> Iterable[Observation]:
        pool = get_engine_pool()
        if pool is None:
            return
        try:
            yield Observation(int(getattr(pool, pool_method)()))
        except Exception:
            logger.debug(
                "db pool stat %s unavailable",
                pool_method,
                extra={"event": "db_pool_metrics.stat_failed"},
                exc_info=True,
            )

    return observe


def _observe_max_overflow(
    _options: CallbackOptions,
) -> Iterable[Observation]:
    """Report the *configured* ``max_overflow`` ceiling component.

    Reads ``settings.db_max_overflow`` — the same value the engine was
    created with — rather than the live ``QueuePool.overflow()`` counter,
    so ``hriv.db.pool.size + hriv.db.pool.max_overflow`` is the real
    per-pod connection ceiling. Emits nothing until the engine exists, like
    the live-stat observers.
    """
    if get_engine_pool() is None:
        return
    yield Observation(int(settings.db_max_overflow))


# OTel instrument name -> observer. The dict keys are the published
# contract; downstream dashboards and alerts are written against these
# exact names (``hriv_db_pool_*`` after remote-write flattening).
OBSERVERS: dict[str, Callable[[CallbackOptions], Iterable[Observation]]] = {
    "hriv.db.pool.size": _observe_pool_stat("size"),
    "hriv.db.pool.checked_out": _observe_pool_stat("checkedout"),
    "hriv.db.pool.overflow": _observe_pool_stat("overflow"),
    "hriv.db.pool.checked_in": _observe_pool_stat("checkedin"),
    "hriv.db.pool.max_overflow": _observe_max_overflow,
}

_GAUGE_DESCRIPTIONS = {
    "hriv.db.pool.size": "Configured QueuePool capacity (pool_size)",
    "hriv.db.pool.checked_out": "Connections currently checked out of the pool",
    "hriv.db.pool.overflow": (
        "QueuePool live overflow counter: positive counts connections beyond "
        "pool_size, negative means fewer than pool_size connections exist"
    ),
    "hriv.db.pool.checked_in": "Idle connections currently held by the pool",
    "hriv.db.pool.max_overflow": "Configured max_overflow ceiling component",
}

for _name, _observer in OBSERVERS.items():
    _meter.create_observable_gauge(
        _name,
        callbacks=[_observer],
        description=_GAUGE_DESCRIPTIONS[_name],
        unit="1",
    )

_registry = CollectorRegistry()
_pool_size = Gauge(
    "hriv_db_pool_size",
    "Configured QueuePool capacity (pool_size)",
    registry=_registry,
)
_pool_checked_out = Gauge(
    "hriv_db_pool_checked_out",
    "Connections currently checked out of the pool",
    registry=_registry,
)
_pool_overflow = Gauge(
    "hriv_db_pool_overflow",
    "QueuePool overflow counter (positive = connections beyond pool_size)",
    registry=_registry,
)
_pool_checked_in = Gauge(
    "hriv_db_pool_checked_in",
    "Idle connections currently held by the pool",
    registry=_registry,
)
_pool_max_overflow = Gauge(
    "hriv_db_pool_max_overflow",
    "Configured max_overflow ceiling component",
    registry=_registry,
)


def render_db_pool_metrics() -> tuple[bytes, str]:
    """Render this process's pool gauges for the Prometheus scrape payload.

    ``/api/metrics`` only exists on API pods, so this payload covers the
    API pod's own pool; the worker pod's pool is visible only via the OTLP
    ``hriv.db.pool.*`` instruments. A failed or missing pool degrades to
    ``NaN`` rather than breaking the scrape.
    """
    pool: Pool | None = get_engine_pool()
    try:
        _pool_size.set(float("nan") if pool is None else float(pool.size()))
        _pool_checked_out.set(
            float("nan") if pool is None else float(pool.checkedout())
        )
        _pool_overflow.set(
            float("nan") if pool is None else float(pool.overflow())
        )
        _pool_checked_in.set(
            float("nan") if pool is None else float(pool.checkedin())
        )
        # Configured ceiling component, not the live overflow counter —
        # see the OTel observer for why size + max_overflow is the ceiling.
        _pool_max_overflow.set(
            float("nan") if pool is None else float(settings.db_max_overflow)
        )
    except Exception:
        # Introspection is pure in-process reads on QueuePool, but a
        # non-standard pool must never break the whole scrape.
        logger.debug(
            "db pool scrape gauges unavailable",
            extra={"event": "db_pool_metrics.stat_failed"},
            exc_info=True,
        )
        for gauge in (
            _pool_size,
            _pool_checked_out,
            _pool_overflow,
            _pool_checked_in,
            _pool_max_overflow,
        ):
            gauge.set(float("nan"))
    return generate_latest(_registry), CONTENT_TYPE_LATEST
