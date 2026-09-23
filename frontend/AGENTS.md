# Frontend (React + Vite + TypeScript)

All commands run from `frontend/` — there is no root `package.json`.

## Commands

- Install dependencies: `npm ci` — also installs the repo-local
  `.githooks/pre-commit` hook (Prettier on staged files) via the `prepare`
  script, unless `core.hooksPath` is customized; if you keep a custom
  `core.hooksPath`, run `npm run format:check` manually before committing.
- Dev server: `npm run dev`
- Tests: `npm test` (Vitest + `@testing-library/react`);
  `npm test -- <pattern>` matches test-file path substrings
- Build: `npm run build`
- Format: `npm run format:check` (repo-wide check) / `npm run format:staged`
- License notices: `npm run licenses:generate` after dependency changes —
  CI (`frontend-checks`) fails if `public/THIRD-PARTY-LICENSES.txt` drifts
  from the production dependency tree.

## Conventions

- TypeScript strict mode; prefer functional components; ESLint + Prettier.
- Write unit tests for new functions; aim for >80% coverage; run `npm test`
  before committing.
- **Drag-and-drop tiles use `@dnd-kit/react` v2 (NOT v1 `@dnd-kit/core`).**
  Before changing collision detection, drop zones, collision priority, or
  activation constraints in `SortableTileGrid.tsx`, read
  [`docs/drag-and-drop.md`](../docs/drag-and-drop.md) — it is the locked
  move-vs-reorder contract, and such changes require a human feel-test
  before merge.

## Storybook / Chromatic

Chromatic snapshots every story on each push (release-please bot branches
excluded; TurboSnap skips pushes that only touch untraced/non-frontend
files), so stories are permanent baselines — target meaningfully distinct
visual states, not one story per code path:

- New components in `src/components/` need a `*.stories.tsx` covering each
  meaningfully distinct visual state.
- New UI inside existing pages/containers needs a story only when the change
  is extractable into a component worth isolating.
- Behavior changes to already-storied components need no new stories —
  existing snapshots cover regression.
- Theme/viewport variants use `parameters.chromatic.modes` instead of
  duplicating stories; each mode is its own baseline, so apply deliberately.
- Fixtures must be deterministic: literal dates and data, no `Date.now()` or
  `Math.random()`.
- Tune noisy stories via `parameters.chromatic` (`diffThreshold`,
  `pauseAnimationAtEnd`, `delay`, `disableSnapshot` for docs-only stories)
  rather than dropping coverage.
- Story format: `Components/<Name>` title, `Basic` first, an attached
  `<Name>.docs.mdx` page, and `play` functions for small deterministic
  interactions — see [`docs/storybook-chromatic.md`](../docs/storybook-chromatic.md).
