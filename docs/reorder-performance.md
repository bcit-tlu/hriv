# Browse drag-and-drop performance (#981)

Profiling and optimization record for Browse-page tile dragging at production
scale (epic [#975](https://github.com/bcit-tlu/hriv/issues/975), sub-issue
[#981](https://github.com/bcit-tlu/hriv/issues/981)).

## Methodology

- **Build**: production frontend (`npm run build`, served via `vite preview`)
  against the docker-compose backend.
- **Data**: the production-scale reorder fixture (`docs/reorder-fixture.md`):
  flat scope (80 sibling categories), gallery scope (600 sibling images),
  mixed root scope.
- **Harness**: `scripts/profile_reorder_drag.py` — Playwright over CDP drives a real pointer drag (120 discrete
  `mousemove` steps across ~6 tile widths, then Escape-cancel so runs do not
  mutate the fixture). In-page instrumentation samples:
  - `requestAnimationFrame` frame count during the drag (drag FPS);
  - `PerformanceObserver('longtask')` — main-thread stalls > 50 ms;
  - `PerformanceObserver('event')` — pointer-event processing durations;
  - `performance.memory.usedJSHeapSize`;
  - mounted tile count (every tile registers one sortable; every category
    tile additionally registers one move-into droppable).

Numbers below are representative single runs on the CI-class dev VM;
run-to-run variance observed was ± ~10 %.

Note on the measured window: the tables below were captured with a harness
that stopped sampling before the Escape-cancel and pointer release, so they
reflect drag activation + steady-state movement only — drag-end cost falls
outside them. The harness now keeps long-task sampling running through the
cancel/release (so the drag-end cluster is captured) while drag FPS is still
computed over the movement phase only, so FPS remains comparable with the
tables below but future long-task totals will be slightly higher.

Because every run Escape-cancels before releasing the pointer, the
drag-end cluster measured here is the cancel path: the drop-commit cost
(order diff, coordinator report/persistence, post-save refetch) is never
exercised by this harness. The conclusions below therefore cover drag
interactivity only, not save cost.

## Baseline (before optimization)

| Scope   | Tiles | Drag FPS | Long tasks (count / total / max) | Slowest pointer event | JS heap |
| ------- | ----- | -------- | -------------------------------- | --------------------- | ------- |
| Root    | 17    | 57       | 2 / 127 ms / 66 ms               | 72 ms                 | 18 MB   |
| Flat    | 80    | 53       | 2 / 301 ms / 202 ms              | 136 ms                | 50 MB   |
| Gallery | 600   | 43       | 2 / 853 ms / 486 ms              | 184 ms                | 100 MB  |

Diagnosis: long-task cost scaled with tile count and clustered at **drag
start and drag end** — `handleDragStart`/`handleDragEnd` set `activeItem`
(grid-level state), which re-rendered every mounted tile (600+ MUI cards)
because tiles were re-created inline on each grid render. Steady-state
pointermove processing (collision detection + optimistic reflow) was not the
dominant cost.

## Optimization applied

Memoization only — no changes to collision detection, drop zones, activation
constraints, or move-vs-reorder semantics (`docs/drag-and-drop.md` contract
untouched):

- `ImageTile` and `CategoryTile` are wrapped in `React.memo`;
- `SortableTileGrid` renders tiles through a memoized `GridTile` component
  with stable `useCallback` render props, so grid-level state changes
  (`activeItem` on drag start/end, coordinator status) no longer re-render
  every tile — a tile re-renders only when its own item, index, or disabled
  state changes.

Covered by `frontend/tests/components/tileMemoization.test.tsx`, which
asserts both the tile-level `React.memo` behaviour and — with a mounted
`SortableTileGrid` — that a drag start (grid-level state change) does not
re-execute the mounted tile components.

## After optimization

| Scope   | Tiles | Drag FPS | Long tasks (count / total / max) | Slowest pointer event | JS heap |
| ------- | ----- | -------- | -------------------------------- | --------------------- | ------- |
| Flat    | 80    | 55       | 1 / 114 ms / 114 ms              | 72 ms                 | 34 MB   |
| Gallery | 600   | 50       | 1 / 368 ms / 368 ms              | 104 ms                | 61 MB   |

The remaining single long task occurs at **drag activation** (observed start
offset ~40 ms into the drag): dnd-kit measures the shapes of all mounted
sortables once per drag. Steady-state dragging at 600 tiles runs with **no
long tasks** at ~50 FPS.

## Compact reorder mode decision

Issue #981 calls for an explicit compact reorder interface **if** the card
grid cannot meet responsiveness criteria at 600+ items. After memoization the
card grid sustains ~50 FPS with a single sub-400 ms activation stall at the
600-item scope, so a compact mode is **not implemented**. Revisit if human
feel-testing at scale (see below) contradicts the measured results.

## Deliberately not done (and why)

- **Collision-candidate restriction / virtualization**: both change which
  tiles can be collision targets and therefore risk altering move-vs-reorder
  feel; `docs/drag-and-drop.md` gates any such change behind a human
  feel-test. The measured steady-state cost does not justify them today.
- **Thumbnail deferral during drag**: image decode/paint did not appear as a
  long-task source in profiles (thumbnails are already small and cached).

## Human feel-test sign-off — issue #1100

Tester: Kyle · Date: 2026-09-15 · Env: local `docker compose` (OrbStack), Vite
dev build · Fixture: `reorder_fixture` seeded — 109 categories / 642 images
(`RF-Root-01` = 80 flat categories, `RF-Root-02` = 600-image gallery)

Checklist (`docs/drag-and-drop.md` → Human feel-test protocol):

| #   | Item                                               | Result                                                                                                    |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | 80-category reorders reflow + commit               | pass                                                                                                      |
| 2   | Near-half "Move here" affordance on category tiles | pass                                                                                                      |
| 3   | Dead-zone over image tiles                         | pass                                                                                                      |
| 4   | 10–20 rapid drops during in-flight save            | pass — every accepted drop committed; backend log shows zero 409/5xx across 167 tile-order responses      |
| 5   | 600-image scope, activation stall                  | pass — the ~370 ms activation stall is **imperceptible during gestures**; does not justify follow-up work |
| 6   | Navigate in-and-back mid-save                      | pass                                                                                                      |
| 7   | Reload persistence                                 | pass — displayed order retained                                                                           |
| 8   | Two-tab concurrent reorder                         | pass — explicit conflict UX                                                                               |
| 9   | Render summaries + poll counters                   | pass — see measured values below                                                                          |

Measured (dev counters + backend log, same session):

- `render summary` at the 599-tile scope: `tileRenders=2995` on the first
  drag, then `599` (≈1 committed render per tile per drag) — **not zero**.
  Coordinator save-state transitions (`dirty→saving→saved`) re-render the
  page mid-drag, churning the `renderCategoryTile`/`renderImageTile` callback
  identities and defeating `GridTile`'s memo once per transition. Bounded and
  linear — imperceptible per the tester — but a real gap the counters were
  built to surface; revisit the callback-prop stability if profiling ever
  shows cost.
- `browse-tree poll` outcomes: `applied` tracks reorder→refresh cycles (each
  `PUT /api/tile-order` bumps the browse revision → next poll is a real 200);
  once idle, polls every ~30 s all report `not_modified`.
- Backend `http.request` log agrees: `GET /api/categories/tree` 304 ≈ 10 ms
  vs 200 ≈ 55–200 ms; `PUT /api/tile-order` 200 in ~40–270 ms with a
  `reorder.persisted` structured event each.
- Prometheus end-to-end (local observability compose):
  `hriv_browse_tree_requests_total{outcome="full"}=16`,
  `{outcome="not_modified"}=9`, mean `hriv.browse_tree.build.duration` ≈
  101 ms → backend work saved ≈ `not_modified` × ~101 ms per short-circuit.

## Needs human verification (historical)

- ~~Drag feel at the 600-image gallery scope on real hardware~~ — answered by
  the sign-off above: feel is acceptable at 600 images.
- ~~Whether the ~370 ms activation stall at 600 tiles is perceptible~~ —
  imperceptible during gestures per the sign-off; no follow-up needed.
