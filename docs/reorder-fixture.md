# Production-scale reorder fixture

Deterministic test data and regression scaffolding for the Browse-page
reordering epic ([#975](https://github.com/bcit-tlu/hriv/issues/975), created
by sub-issue [#976](https://github.com/bcit-tlu/hriv/issues/976)).

## What the fixture contains

Built by `backend/app/reorder_fixture.py` (`build_fixture_spec()`), mirrored
for frontend tests by `frontend/tests/helpers/reorderFixture.ts`:

| Scope                             | Contents                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Mixed root scope                  | 5 root categories (`RF-Root-01…05`) + 10 uncategorized images (`RF-Uncat-Img-01…10`) |
| Flat scope (under `RF-Root-01`)   | 80 sibling categories (`RF-Flat-Cat-001…080`)                                        |
| Gallery scope (`RF-Root-02`)      | 600 sibling images (`RF-Gallery-Img-001…600`)                                        |
| Nested scope (under `RF-Root-03`) | 4 nesting levels, each mixing 6 child categories and 8 categorized images            |

Properties relied on by tests:

- **Deterministic IDs** in reserved high ranges (categories from `9100000`,
  images from `9200000`) that never collide with sequence-assigned rows, and
  deterministic `RF-`-prefixed names, so the complete authoritative order can
  be asserted exactly.
- **Duplicate `sort_order` values** in every sibling scope (indexes collapse
  pairwise: 0, 0, 1, 1, …) for normalization testing.
- **Idempotent seeding**: seeding purges existing fixture rows first (by ID
  range and name prefix), so it can be re-run without manual cleanup.

## Loading the fixture

Against any migrated PostgreSQL database (e.g. the docker-compose dev stack):

```bash
docker compose up -d db
cd backend
DATABASE_URL=postgresql+asyncpg://hriv:hriv@localhost:5432/hriv \
  poetry run python -m app.migrations_bootstrap   # first time only
DATABASE_URL=postgresql+asyncpg://hriv:hriv@localhost:5432/hriv \
  poetry run python -m app.reorder_fixture          # purge + seed
DATABASE_URL=postgresql+asyncpg://hriv:hriv@localhost:5432/hriv \
  poetry run python -m app.reorder_fixture --purge  # remove it again
```

The same workflow seeds a deployed/staging database for browser-level
(Playwright) journeys — point `DATABASE_URL` at that database instead.

## Backend integration tests

`backend/tests/test_reorder_fixture.py` has two layers:

- **Specification tests** (always run, no database): pin the fixture shape —
  counts, scopes, nesting depth, duplicates, determinism.
- **Integration tests** (run when `REORDER_FIXTURE_DATABASE_URL` is set to a
  migrated PostgreSQL database; CI provides a `postgres:16-alpine` service):
  idempotent re-seeding, purge, and full-scope authoritative order round-trip
  through `PUT /api/tile-order`.

The two `xfail(strict=True)` regression tests that documented partial
persistence and silent last-write-wins were removed in #998: the atomic,
revisioned `PUT /api/tile-order` contract (#978) fixed both behaviours, and
the positive coverage now lives in `backend/tests/test_tile_order.py`
(atomicity, membership validation, and stale-revision 409 conflicts).

## Frontend regression scaffolding

`frontend/tests/helpers/reorderFixture.ts` provides the deterministic
generators plus `createDeferred()` for injecting realistic latency into
category persistence, image persistence, and background refreshes
independently.

The `it.fails(...)` regression suite
(`SortableTileGridReorderRegression.test.tsx`) that asserted the legacy
path's silent-discard, stale-refresh, and partial-persistence bugs was
removed in #998 along with the legacy fallback path itself. The equivalent
desired-behaviour coverage now lives in `frontend/tests/tileOrdering.test.ts`
(coordinator queueing, coalescing, conflict adoption, and the
20-rapid-reorder scenario) and
`frontend/tests/components/SortableTileGridCoordinator.test.tsx` (the grid's
coordinator wiring, including the full 80-category / 600-image scope).

Navigation-away-during-save and reload-and-compare journeys are browser-level
concerns: seed the fixture with the CLI above and drive them via Playwright
(see `synthetic-monitoring/`); they are asserted across the complete item
sequence using the deterministic names.

## Observed timings at fixture scale (jsdom, Vitest)

- Rendering the mixed 695-tile scope: ~5.9 s per render in jsdom — large
  enough that per-drop re-render cost matters, which is what makes drops
  during slow persistence realistic to interleave in tests.
- 20 consecutive awaited reorders on a 21-image scope: ~0.7 s total.
- The deferred-persistence regressions execute in tens of milliseconds,
  so the lost-drop window is purely ordering-dependent, not timing-flaky.
