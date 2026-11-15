# Inuksuks and Boards

Inuksuks bookmark an image's exact viewport coordinates, zoom, and rotation.
Boards curate shared Inuksuks into ordered, one-level sections. Migration
`0046_inuksuks_and_boards` introduces the additive schema; creation, access
control, thumbnails, and UI arrive in subsequent issues of epic #1765.
See the [domain model](domain-model.md) for fields and deletion rules.

## Feature flag (`INUKSUKS_ENABLED`)

- Backend `Settings.inuksuks_enabled` reads `INUKSUKS_ENABLED`, default
  `false`. `GET /api/features` exposes `inuksuks: bool`.
- Pure ASGI `InuksuksFeatureMiddleware` returns `404 {"detail":"Not Found"}`
  for `/api/boards`, `/api/inuksuks`, and their slash-delimited descendants
  while disabled, before authentication or body parsing. Maintenance takes
  precedence (503). Other paths and non-HTTP scopes pass through.
- `require_inuksuks_enabled` in `app/inuksuks.py` is the secondary
  router-level dependency for subsequent routers. Enabling the flag alone
  does not add endpoints in this schema-only release.
- Helm `inuksuks.enabled: false` renders `INUKSUKS_ENABLED` on the API
  Deployment. Enable it explicitly in deployment overlays for incremental
  testing; leave it off elsewhere until the epic ships.
- Docker Compose defaults `INUKSUKS_ENABLED=true` for local development;
  override it with `INUKSUKS_ENABLED=false` to exercise the dark-launch gate.

## Verification

`backend/tests/test_inuksuks.py` covers metadata and pre-parser feature gating;
`backend/tests/test_inuksuks_db.py` uses `TEST_DATABASE_URL` against migrated
PostgreSQL for cascades and user-deletion cleanup.
