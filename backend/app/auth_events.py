"""Canonical structured-log fields for authentication events.

Login flows (local password and OIDC) historically emit structured logs with
per-flow event names (``auth.login_success``, ``oidc.login_success``, …) and
ad-hoc fields. Usage/analytics dashboards need a *stable, additive* set of
canonical fields that are consistent across every auth flow so a single Loki
query can, for example, count successful logins or exclude synthetic traffic
regardless of which flow produced the event.

These helpers only *add* fields; callers keep their existing event names and
pre-existing keys so nothing downstream breaks.

Canonical fields (all prefixed ``auth.``):

- ``auth.method``    — login mechanism: ``"local"`` or ``"oidc"``
- ``auth.outcome``   — ``"success"`` or ``"failure"``
- ``auth.user_id``   — internal (database) user id, when known
- ``auth.role``      — internal role of the user, when known
- ``auth.synthetic`` — ``True`` when the account is a synthetic monitor user

Synthetic classification is derived server-side from the authenticated user's
stored metadata rather than trusting a client-supplied flag, so synthetic
monitor journeys can be reliably excluded from real-usage reports.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol, runtime_checkable

# Local password login and OIDC login mechanisms.
AUTH_METHOD_LOCAL = "local"
AUTH_METHOD_OIDC = "oidc"

AUTH_OUTCOME_SUCCESS = "success"
AUTH_OUTCOME_FAILURE = "failure"

# Key inside ``User.metadata_`` that marks an account as a synthetic monitor
# identity. Seed/provisioning sets ``{"synthetic": true}`` on the monitor user.
SYNTHETIC_METADATA_KEY = "synthetic"


@runtime_checkable
class AuthUser(Protocol):
    """Minimal structural view of the fields these helpers read off a user.

    Declared as a ``Protocol`` so the helpers stay decoupled from the ORM model
    (and remain trivially testable) while still being fully typed — no
    ``getattr``/``Any`` access.
    """

    id: int
    role: str
    metadata_: Mapping[str, object] | None


def is_synthetic_user(user: AuthUser | None) -> bool:
    """Return ``True`` when *user* is a synthetic monitoring account.

    The decision is made from the user's persisted ``metadata_`` JSON so it
    cannot be spoofed by a client. Any missing/non-mapping metadata means the
    account is treated as a real user.
    """
    if user is None:
        return False
    metadata = user.metadata_
    if not isinstance(metadata, Mapping):
        return False
    return bool(metadata.get(SYNTHETIC_METADATA_KEY))


def auth_event_fields(
    *,
    method: str,
    outcome: str,
    user: AuthUser | None = None,
    user_id: int | None = None,
    role: str | None = None,
) -> dict[str, object]:
    """Build the canonical ``auth.*`` fields for a structured auth log.

    Pass either a ``user`` object (from which id/role/synthetic are read) or
    explicit ``user_id``/``role`` values for failure paths where no user was
    resolved. Fields with unknown values are omitted rather than emitted as
    null so dashboards can rely on presence.
    """
    fields: dict[str, object] = {
        "auth.method": method,
        "auth.outcome": outcome,
        "auth.synthetic": is_synthetic_user(user),
    }

    resolved_id = user_id if user_id is not None else (user.id if user is not None else None)
    if resolved_id is not None:
        fields["auth.user_id"] = resolved_id

    resolved_role = role if role is not None else (user.role if user is not None else None)
    if resolved_role is not None:
        fields["auth.role"] = resolved_role

    return fields
