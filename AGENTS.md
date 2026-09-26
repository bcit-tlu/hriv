# AGENTS.md

HRIV is a monorepo: React/Vite frontend, FastAPI backend, backup service,
restore-validation orchestrator, Helm charts. Component detail lives in
per-directory `AGENTS.md` files that load when you work under them:
`frontend/AGENTS.md`, `backend/AGENTS.md`, `backup/AGENTS.md`,
`restore-validation/AGENTS.md`, `charts/AGENTS.md`.

## Setup Commands

- **If a required executable is not on `PATH`, use `nix-shell -p <executable>`** to run it in the project environment instead of assuming the tool is unavailable.
- Frontend (from `frontend/`): `npm ci`, `npm run dev`, `npm test`, `npm run build`, `npm run format:check` / `npm run format:staged`.
- Backend (from `backend/`): `poetry install --with dev`, `poetry run uvicorn app.main:app --reload`, `poetry run pytest` (80% coverage gate via `addopts` in `pyproject.toml`).
- Backup (from `backup/`): `poetry install --no-root`, `poetry run pytest`.
- Restore validation (from `restore-validation/`): `poetry install --with dev`, `poetry run python -m unittest discover tests` (needs `helm` on `PATH`).
- Helm charts (from repo root): `for chart in charts/*/; do helm lint "$chart"; done` — plus kubeconform and `bash scripts/test-helm-chart-regressions.sh` (see `charts/AGENTS.md`).
- DB schema changes: Alembic is the sole source of truth — model change in `backend/app/models.py` + generated revision committed together (see `backend/AGENTS.md`; revision IDs must be ≤32 chars).
- Runtime dependency changes → regenerate the component's `THIRD-PARTY-LICENSES.txt` (`cd frontend && npm run licenses:generate`; backend/backup: `poetry run python scripts/generate_third_party_licenses.py`). CI fails on drift.

## Code Style

- Frontend: TypeScript strict mode, functional components, ESLint + Prettier.
- Backend: PEP 8 and existing conventions, type annotations on signatures.
- PR titles are conventional commits (see `.github/CONTRIBUTING.md`; enforced by `pr-title-lint.yaml`).
- License: MPL-2.0.

## Testing Guidelines

- Write unit tests for new functions; aim for >80% coverage; run relevant tests before committing.
- **"I changed X → run Y":** see [`docs/agent-test-matrix.md`](docs/agent-test-matrix.md) for a decision tree mapping each change area to the targeted backend/frontend tests (and skills) to run. Run the full suite before opening a PR.

## Project Structure

- `/frontend` — React/Vite/TS app (`src/`, `tests/`, `public/`)
- `/backend` — FastAPI app (`app/`, `tests/`; Alembic migrations in `app/migrations/`)
- `/backup` — Backup service (scheduled DB and filesystem snapshots)
- `/restore-validation` — Isolated Python restore-validation orchestrator
- `/synthetic-monitoring` — Playwright synthetic-monitoring suite
- `/charts` — Helm charts (`frontend/`, `backend/`, `backup/`, `restore-validation/`)
- `/db` — Seed data (`seed.sql`, `seed-assets/`)
- `/docker` — Local observability collector configs (Prometheus, Tempo, OTel, Grafana)
- `/deploy` — Deployment notes; live manifests live in `bcit-tlu/flux-fleet`
- `/docs` — Documentation; start at [`docs/agent-feature-map.md`](docs/agent-feature-map.md)
- `/scripts` — Utility scripts (e.g. CLI upload helper)
- `/.agents/skills` — Repo skills (task-scoped guidance)
- `/.devin` — Agent config (committed `config.json` permission allowlist; `config.local.json` is gitignored)
- `/.github/workflows` — CI/CD pipelines
- `/.worktrees` — Local git worktrees (gitignored)

## Documentation & Skill Files

- **Edits to existing docs must be additive.** When updating SKILL.md, README.md, or other documentation files, append or modify specific sections — never replace the entire file contents. Read the file first, then apply targeted edits.
- **Verify line counts after doc edits.** If the original file was N lines and you added content, the result should be ≥ N lines. A dramatic reduction (e.g., 822 → 220 lines) indicates accidental replacement — unless the edit is a deliberate split that moves content into linked reference files, in which case verify the removed sections exist at the link targets.
- **Update documentation in the same PR as the feature.** Any PR that adds or changes user-facing behavior, roles/permissions, API endpoints, or env/config MUST update the relevant docs in that same PR (do not defer to a follow-up). Reviewers should treat missing doc updates as a blocking change-request. Check this list and update every file that applies:
  - `README.md` — **Role Capabilities** table and **Test Credentials** when roles, permissions, or seed accounts change.
  - `docs/TESTING.md` — the **API endpoint → minimum role** table and relevant test cases when endpoints, roles, or auth rules change.
  - `docs/<feature>.md` — add or update a dedicated page for any non-trivial feature (model, authorization rules, API surface, frontend behavior, flow); link it from `README.md`. Existing examples: `docs/drag-and-drop.md`, `docs/OIDC_SETUP.md`.
  - `docs/OIDC_SETUP.md` — when auth / OIDC / group-mapping behavior changes.
  - `.agents/skills/*/SKILL.md` — when a feature changes how it should be set up or tested locally.
  - `AGENTS.md` — when setup commands, project structure, or contributor workflow change.

## Critical Invariants

Project-specific rules that agents (and contributors) must not break. Each links
to the deeper doc that explains the behaviour.

- **Do not treat frontend filtering as security.** Student visibility MUST be enforced in backend routers (`visibility.py`, `routers/images.py`, `routers/categories.py`); the frontend filters for UX only. See [`docs/category-visibility-and-programs.md`](docs/category-visibility-and-programs.md).
- **Student visibility is a dual gate (programs AND groups).** A student sees a category only if it passes BOTH the program gate and the group gate, evaluated up the ancestor chain (plus the hidden-subtree rule). Empty programs/groups on a category = unrestricted on that dimension. See [`docs/category-visibility-and-programs.md`](docs/category-visibility-and-programs.md) and [`docs/groups.md`](docs/groups.md).
- **Always pass `user_group_ids` to the visibility helpers.** It is a required parameter (no default); omitting it = empty set = deny-all on the group dimension. Every student-scoped caller (`routers/categories.py`, `routers/images.py`) must pass `{g.id for g in user.groups}`.
- **Programs and groups are independent.** Group membership does not imply program membership; do not derive one from the other. See [`docs/groups.md`](docs/groups.md).
- **Category edit authority is global; attach authority is scoped.** Any admin/instructor can edit any category, but instructors can only attach programs they belong to and groups they manage. Do not conflate edit with attach/visibility. See [`docs/groups.md`](docs/groups.md).
- **Group membership is role-enforced.** Members must be students, instructors must be instructors (422 on mismatch). A group's last instructor cannot be removed (409). A group attached to categories cannot be deleted (409). See [`docs/groups.md`](docs/groups.md).
- **Do not widen child category program/group access beyond ancestor restrictions.** `categoryUtils.ts` uses narrowing/intersection semantics — a child can never grant access an ancestor restricts. See [`docs/category-visibility-and-programs.md`](docs/category-visibility-and-programs.md).
- **Do not hand-edit the schema without an Alembic migration.** Alembic is the sole source of truth. See `backend/README.md` and [`docs/domain-model.md`](docs/domain-model.md).
- **`metadata_` (Python) is the DB column `metadata`.** Don't rename one without the other; misusing JSONB writes can silently destroy unrelated metadata fields (e.g. overwriting annotations when only updating measurement scale).
- **Do not assume image-level program restrictions exist.** Visibility is category/program/group based only (image-level program associations were deprecated in PR #385).
- **Do not change drag-and-drop collision logic** without updating [`docs/drag-and-drop.md`](docs/drag-and-drop.md) and performing a human feel-test before merge.

See the [agent feature map](docs/agent-feature-map.md) for where each feature
lives, and the [domain model](docs/domain-model.md) for schema details.

## Development Workflow

- Create feature branches from `main`; open PRs for review; squash-merge.
- Update documentation for new features in the same PR — see the **Documentation & Skill Files** checklist above.
- Local worktrees go in `.worktrees/<name>` (gitignored); `git worktree prune` clears stale registrations.
- If the session's configured workspace directory is missing or empty, locate the real checkout before running commands (on Kyle's machine this repo lives at `~/projects/github/apps/hriv`).

## CI/CD

- CI uses shared `bcit-tlu/.github` OCI build reusable workflow; `helm-lint` validates all four charts on every push and PR.
- `release-please` manages versioning via conventional commits (manifest mode, separate PRs per component); uses a GitHub App token (`RELEASE_PLEASE_APP_ID` / `RELEASE_PLEASE_APP_PRIVATE_KEY`) so PR pushes trigger CI — do NOT switch to `GITHUB_TOKEN` (its anti-recursion guard prevents CI from running on the PR).
- Component release types: `node` (frontend), `python` (backend, backup, restore-validation). Versions tracked in `.release-please-manifest.json` + `charts/*/Chart.yaml` annotations.
- Images → `ghcr.io/bcit-tlu/hriv/hriv-{frontend,backend,backup,restore-validation}`; charts → `oci://ghcr.io/bcit-tlu/hriv/charts`.
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` is set in all workflows.
- Trivy findings reach code scanning from the `main` oci-build and the weekly `security-rescan.yaml`; Dependabot (`.github/dependabot.yml`) opens weekly dependency PRs. See [`docs/security-scanning.md`](docs/security-scanning.md).
- Details: [`docs/RELEASE_AND_DEPLOY_FLOW.md`](docs/RELEASE_AND_DEPLOY_FLOW.md).

## Deployment

- Deployed to Kubernetes via Flux CD (see `bcit-tlu/flux-fleet`); Vault provides dynamic PostgreSQL credentials and Kubernetes auth.
- `latest` overlay → cluster03 (staging), `stable` overlay → cluster04 (production).
