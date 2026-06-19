---
name: hriv-frontend-ui
description: Work on HRIV frontend React/Vite TypeScript code, Material UI screens, OpenSeadragon viewer UI, category trees, image management, API client wrappers, frontend state hooks, frontend tests, and UX behavior under frontend/src or frontend/tests. Use when changing UI workflows, component behavior, API mapping, browse/manage pages, drag-and-drop tiles, or frontend docs.
---

# HRIV Frontend UI

Use this skill for frontend changes in `frontend/src`, `frontend/tests`, and
frontend-facing behavior described in docs.

## Start Here

1. Read `references/frontend-map.md` for component boundaries, state hooks, and
   fragile UI contracts.
2. Read `../../../docs/ui-behaviour-spec.md` when changing user-visible UI.
3. Read `../../../docs/agent-test-matrix.md` to choose tests.
4. For category/program/group visibility UI, also use `$hriv-access-control`.
5. For viewer, annotations, upload, replacement, or metadata UX, also use
   `$hriv-image-workflows`.

## Frontend Rules

- Use strict TypeScript and functional React components.
- Prefer existing hooks and API wrappers in `api.ts`; keep snake_case to
  camelCase mapping centralized and deliberate.
- `npm ci` installs the repo-local `.githooks/pre-commit` hook unless
  `core.hooksPath` is already customized; the hook runs Prettier on staged
  files before commit.
- Do not treat frontend filtering as security. Mirrored filtering is UX only;
  backend routers enforce student visibility.
- Do not change drag-and-drop collision logic, drop zones, collision priority,
  or activation constraints without reading `../../../docs/drag-and-drop.md`
  and planning a human feel-test.
- Preserve stable dimensions for tile grids, toolbar controls, and viewer
  surfaces so dynamic labels and hover states do not shift layout.

## Validation

Run focused Vitest targets for touched components or hooks:

```bash
npm test -- <test file or pattern>
```

Check repo formatting when you touch frontend files or docs:

```bash
npm run format:check
```

Run the frontend suite before a PR when practical:

```bash
npm test
```
