# REVIEW.md

Code review guide for the HRIV project. Applies to both human and AI reviewers.

---

## General Principles

- **Pure refactors must be behaviour-preserving.** If a PR claims "no behaviour changes," verify that no new side-effects, guard changes, or state resets were introduced. Any intentional improvement beyond the refactor must be called out explicitly in the PR description.
- **Validate automated findings before acting.** Static analysis (CodeQL, github-code-quality) and AI review tools (Devin Review) produce false positives. Trace the control flow yourself before accepting or dismissing a finding — especially around effect execution order, conditional guards, and event propagation.
- **Review the diff, not just the new files.** When code moves between files (e.g., App.tsx → custom hook), verify that the call site in the source file correctly wires up the extracted interface and that no state was silently dropped or duplicated.
- **New components need tests in the same PR.** AGENTS.md mandates "Write unit tests for all new functions" for both frontend and backend. A new component without a corresponding test file in `frontend/tests/components/` should not be merged.

---

## TypeScript & Type Safety

- **Preserve setter generality.** When extracting React state into hooks, type setter props as `React.Dispatch<React.SetStateAction<T>>` — not `(value: T) => void`. The narrower signature silently drops functional updater support (`setState(prev => ...)`) which callers may rely on now or in the future.
- **Eliminate redundant union types.** Watch for copy-paste artifacts like `T[] | T[]` that should be `T[]`. These are harmless but signal sloppy extraction.
- **No `Any`, `getattr`, or type escape hatches.** If types are hard to express, that means the reviewer needs to understand the underlying type better — not reach for `any`.

---

## React Hooks & Effects

### Effect Execution Order

- **Never rely on implicit effect ordering between hooks and components.** React runs effects in registration order, but this is fragile across refactors. If a hook needs data before any component-level effects run, use synchronous initialisation (e.g., `useRef` with an initialiser function) instead of a mount `useEffect`.
- **When reviewing extracted hooks:** trace every `useEffect` dependency array and verify that values which were previously component-local state are now correctly received as hook props or refs.

### URL / Browser State Coupling

- **Document side-effects on interface props.** If a hook writes to `window.location` or `window.history` in response to prop changes, add JSDoc on the relevant `Deps` interface fields so future consumers understand the coupling.
- **Provide opt-out flags for side-effects.** Hooks that sync React state to browser APIs (URL, clipboard, localStorage) should expose a boolean flag (e.g., `enableUrlSync`) so consumers can use the hook's state logic without the side-effect.

### State Lifecycle Across Auth Transitions

- **Guard cleanup functions against initial auth.** When clearing pending/cached state on user change, distinguish the initial `null → authenticated` transition from actual user switches (logout, account change). Use a `prevUserRef` pattern — only clear when the previous user was non-null and differs from the current user.

### Optimistic Updates & Async Callbacks

- **Optimistic updates need rollback.** If you call `setState(newValue)` before an API call, the error handler **must** revert: capture `const prev = currentState` before the optimistic write and call `setState(prev)` in `.catch()`.
- **Guard rollbacks against stale closures.** Fire-and-forget async callbacks (`.then()`, `.catch()`) capture state at creation time. If the user navigates away before the callback fires, a naive `setState(prev)` overwrites newer state. Use the functional updater with an ID guard: `setState(cur => cur?.id === prev.id ? prev : cur)`.

---

## Browser Event Handling

### Drag-and-Drop

- **Tile move vs. reorder is a locked contract — see `docs/drag-and-drop.md`.** The Browse grid (`SortableTileGrid.tsx`) uses `@dnd-kit/react` v2. Move-into-category owns the full category-tile rect (`pointerIntersection`, `CollisionPriority.High`) and always wins while the pointer is over a category tile. Reorder uses **optimistic `useSortable` reflow (A2)**: tiles reflow live and a drop on a sibling **tile** commits the reflowed order via the `move()` helper. (A2 superseded A1's gap-only seam zones; see the Decision Record. Reflow is auto-suppressed over category tiles because optimistic sorting only acts between two sortables.) Changing collision detection, zones, priority, or activation requires updating that doc in the same PR and a human feel-test before merge (scripted/recorded drags cannot prove feel).
- **Event handler symmetry.** If `dragenter` filters on a condition (e.g., `e.dataTransfer.types.includes("Files")`), `dragleave` must apply the same filter. Asymmetric filtering causes counters to drift permanently negative, breaking subsequent drag operations.
- **Always `preventDefault` on both `dragover` and `drop` at window level.** Without this, dropping files outside a target navigates the browser to the file and the user loses all application state.
- **Use capture phase for window-level reset handlers.** Child components that call `e.stopPropagation()` in their `onDrop` prevent the event from reaching window-level bubble-phase listeners. Register cleanup handlers (counter reset, state reset) with `addEventListener('drop', handler, true)` so they fire before React's synthetic event system.
- **Defer state resets that unmount drop targets.** If a state change (e.g., `setFileDragActive(false)`) unmounts the component that needs to handle the drop, wrap it in `requestAnimationFrame()` so React's synthetic `onDrop` fires first.

### React Synthetic vs Native Events

- **Capture-phase native listeners fire before React.** React 18 delegates events to the `#root` element. A window capture-phase listener runs before React dispatches synthetic events. Use this ordering intentionally for cleanup, but be aware it means cleanup state changes are visible to React handlers if not deferred.
- **Synthetic event tests have limits.** Tests using `dispatchEvent` with untrusted events may not reproduce all real-browser timing. When a fix depends on event ordering (e.g., `requestAnimationFrame` deferral), note in the PR that manual verification with a real file drag is recommended.

---

## CSS & Visual Consistency

- **Prefer `outline` over `border` for transient visual states.** `outline` does not participate in the box model — no layout shift, no size change. Use it for hover, focus, and drag-over indicators. Use `outlineOffset` to control inward vs. outward rendering.
- **`outlineOffset` direction matters.** Negative values render inside the element (can be obscured by child content like images). Positive values render outside (visible but may overlap adjacent elements in tight grids). Choose based on the visual context and verify with real content.
- **Use `alpha()` for theme-aware transparency.** MUI's `alpha(theme.palette.*.main, opacity)` respects light/dark mode automatically. Hardcoded rgba values do not.

---

## MUI Component Patterns

- **Actionable snackbars must ignore `clickaway`.** If a snackbar contains an action button (e.g., "Undo"), the `onClose` handler must filter `reason === "clickaway"` to prevent accidental dismissal. The established pattern: `onClose={(_event, reason) => { if (reason === "clickaway") return; setState(null); }}`. See existing examples in `BulkEditImagesModal`, `EditImageModal`.
- **Optimistic concurrency on undo operations.** When an undo action reverts a server-side mutation, capture the `version` (from the `ETag` response header) at mutation time and send it as `If-Match` on the undo request. This prevents silent data corruption if another client modified the resource between the action and the undo.

---

## Test Quality

- **Restore global mocks in `afterEach`.** Any test that modifies browser globals (`navigator.clipboard`, `document.execCommand`, `window.location`) must save and restore the original value. Mock leakage between test files sharing a Vitest worker causes non-deterministic failures.
- **Cover opt-out / negative paths.** When a feature has an opt-out flag (e.g., `enableUrlSync: false`), tests must cover both the happy path and the not-found / error path with the flag disabled.
- **Test extraction completeness.** For hook extraction PRs, verify that the hook's test suite covers every callback and memo the hook exports — not just the ones that were easy to test.
- **New components need matching test files.** Follow the `frontend/tests/components/<ComponentName>.test.tsx` convention. Check existing tests (e.g., `CategoryTile.test.tsx`) for patterns to follow.
- **Test fixture consistency across the codebase.** When adding a field to a shared type (e.g., `Program.oidc_group`), update **all** test fixtures that construct that type — not just the ones in the PR's immediate scope. Vitest uses esbuild (transpile-only), so type mismatches in test fixtures won't fail CI but create silent inconsistencies.
- **Remove stale test artifacts after schema changes.** When dropping a column/field, grep for references in mock factories (`_make_image()`, `_make_user()`), schema constructors (`ImageOut()`, `ProgramOut()`), and docstrings. Stale `programs=[]` in mocks and `program_ids` in docstrings are real findings.

---

## Static Analysis & Automated Review

- **Useless conditionals.** When an early return already guarantees a condition (e.g., `if (loading) return;`), subsequent branches in the same effect must not re-check that condition. Remove redundant guards to satisfy CodeQL and improve clarity.
- **Devin Review bug reports require manual verification.** AI-generated bug reports may misread guard logic, effect ordering, or event propagation. Before acting on a reported bug, trace the actual execution path step by step. If the report is wrong, resolve it with an explanation — don't silently dismiss it.
- **Devin Review has a good hit rate on event-handling and data-flow bugs.** In practice, findings about missing `preventDefault`, asymmetric filters, `stopPropagation` interactions, silent data loss (dropped fields), stale closures, and input validation gaps have been consistently accurate. Prioritise reviewing these over style/analysis findings.
- **Devin Review informational findings as review instructions.** The reviewer uses Devin Review analysis items (🚩) as starting points for review comments — e.g., quoting a finding about `tabIndex` inside MUI Select items and directing a change. Treat analysis findings as potential review items even when they're marked informational rather than bugs.

---

## Accessibility

- **Use native ARIA over tooltips.** Prefer `aria-label`, `role`, and semantic HTML as the primary accessibility mechanism. MUI `<Tooltip>` is a visual enhancement, not an accessibility solution — it doesn't render a `title` attribute.
- **Non-interactive icons:** wrap in `<span role="img" aria-label="...">`. Do **not** add `tabIndex={0}` solely for tooltip discoverability — especially inside MUI Select menu items where it creates extra tab stops in arrow-key navigation.
- **Interactive icons:** wrap in `<IconButton aria-label="...">`.
- **Conditional rendering based on optional handlers.** When a prop like `onEditCategory` is optional, render an `<IconButton>` when present and a non-interactive `<span role="img">` when absent. Gate any associated dialogs on the same prop to avoid mounting unreachable UI.
- **New interactive regions need `aria-label`.** Drop zones, dialogs, and other interactive regions should have `role` and `aria-label` attributes (e.g., `role="region" aria-label="Drop files here to upload images"`).
- **Test with `getByLabelText`**, not `getByTitle`, when elements use `aria-label`.
- **Keep patterns consistent.** If one component uses a particular ARIA pattern on an informational icon, every similar icon across the app should do the same.

---

## Backend Patterns

### Atomic Endpoints & Form Parsing

- **Verify ALL fields when combining requests.** When merging two separate API calls into one atomic endpoint (e.g., metadata update + file replace → single `POST /images/{id}/replace`), enumerate every field from both original requests. Silent data loss (e.g., `metadata_extra` dropped) is the worst outcome — worse than a validation error.
- **Wrap Form field conversions in try/except.** FastAPI `Form()` fields are raw strings. `int(category_id)`, `json.loads(program_ids)`, etc. raise `ValueError`/`JSONDecodeError` on malformed input. Without guards, these propagate as unhandled 500s. Return `HTTPException(400, detail="Invalid <field>")` instead.
- **Track UX regressions as follow-up issues.** When atomicity changes the error-reporting path (e.g., inline modal validation → generic snackbar), create an issue to track the UX gap.

### Schema & Migration Conventions

- **Alembic revision IDs must follow the repo convention.** Use full `000X_description` format for both `revision` and `down_revision`. Short prefixes (`"0004"`) work via partial matching but break naming consistency and could cause ambiguity.
- **Pydantic validators for semantic validation.** Empty/whitespace-only strings that are semantically invalid (e.g., `oidc_group` with a unique constraint) should be coerced to `None` via `field_validator(mode='before')`. This prevents invalid empty strings from occupying unique constraints.
- **Remove stale artifacts after schema changes.** When dropping a column or association, grep for references in: docstrings, test mock factories, schema constructors, frontend type fixtures, and admin export/import code.

### Visibility & RBAC

- **Deduplicate business rules into shared modules.** If a new shared helper (e.g., `compute_excluded_category_ids`) implements logic that already exists inline elsewhere (e.g., in `_load_tree`), refactor the inline code to use the shared helper in the same PR. Don't leave two implementations of the same rule.
- **OIDC sync merge semantics.** When syncing user-program assignments from OIDC groups: OIDC-derived assignments not in the current token are dropped; manually-assigned programs (where `oidc_group IS NULL`) are always preserved. Verify this distinction in both the new-user and existing-user code paths.

### Polling & Background Jobs

- **Dead refs and guards.** When removing polling lifecycle code, check for refs that were initialised but never updated (e.g., `bulkRefreshDoneRef = useRef(false)` where it's never set to `true`). These create guards that are always true/false, masking real state transitions.
- **Cross-component refresh signals.** If removing a callback that triggered a refresh (e.g., `onUploadedRef`), verify that the consuming component (e.g., ManagePage) has an alternative refresh mechanism. An `imagesVersion` counter pattern (incremented on completion events, watched by consuming components via `useEffect`) provides a clean decoupled signal.

---

## Hook Extraction PRs (App.tsx Decomposition)

This section applies specifically to the ongoing #499 decomposition plan.

- **Verify line-count claims.** The PR description should state the before/after App.tsx line count. Spot-check with `wc -l frontend/src/App.tsx`.
- **One hook per file.** Shared types go in the same file or `types.ts`. Shared utilities (e.g., tree traversal) go in a dedicated `*Utils.ts` file — not inlined in the hook.
- **No cross-hook dependencies yet.** Each extracted hook should depend only on App.tsx-provided props, not on other extracted hooks. Cross-hook wiring is deferred to the final orchestrator PR.
- **Remaining App.tsx references.** After extraction, search App.tsx for any leftover references to moved state/functions that should now come from the hook's return value.
- **Manual testing checklist.** Each hook extraction PR should include a human-verifiable testing checklist in the PR description covering the specific user flows affected by the extracted state.
