# HRIV

High-resolution image viewer powered by [OpenSeadragon](https://openseadragon.github.io/).

Built with Vite, React 19, TypeScript, Material UI, FastAPI, and PostgreSQL.

## Quick Start

```bash
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

Source files in `frontend/src/` and `backend/app/` are bind-mounted into the containers, so edits are reflected immediately via hot-reload.

## Test Credentials

All seed users share the password `password`.

| **User**              | **Email**             | **Password** | **Role**   |
| --------------------- | --------------------- | ------------ | ---------- |
| Haruki Tanaka         | admin@example.ca      | password     | admin      |
| Carlos Henrique Souza | instructor@example.ca | password     | instructor |
| Mira Patel            | student@example.ca    | password     | student    |

### Role Capabilities

| Capability                      | Admin | Instructor | Student |
| ------------------------------- | ----- | ---------- | ------- |
| Browse categories & view images | Yes   | Yes        | Yes     |
| Create/update categories        | Yes   | Yes        | No      |
| Delete categories               | Yes   | Yes        | No      |
| Manage page (image table)       | Yes   | Yes        | No      |
| Bulk import images              | Yes   | Yes        | No      |
| Manage programs                 | Yes   | No         | No      |
| Manage groups                   | Yes   | Yes\*      | No      |
| Restrict categories to groups   | Yes   | Yes\*      | No      |
| Manage announcement             | Yes   | Yes        | No      |
| View changelog notifications    | Yes   | Yes        | No      |
| Manage changelog entries        | Yes   | No         | No      |
| Admin tab (changelog + backups) | Yes   | No         | No      |
| User management (add/delete)    | Yes   | No         | No      |
| List users                      | Yes   | Yes        | No      |

\* Instructors manage only the groups they co-own and may attach only groups
they manage; admins manage and attach any group. See [docs/groups.md](docs/groups.md).

### Programs

A **program** is a flat, admin/OIDC-managed access-control unit that gates category/image visibility for students. Only admins create, rename, and delete programs; a program may carry an `oidc_group` so membership is provisioned automatically by the IdP. A category tagged with one or more programs is visible to a student only if they belong to at least one of those programs (enforced by the student visibility filter). Programs are not hierarchical.

### Groups

A **group** is an instructor-managed visibility dimension, independent of programs. Any admin or instructor can create a group and add student members (and instructor co-owners); a category restricted to one or more groups is visible to a student only if they belong to at least one of them. Visibility is a **dual gate**: a student sees a category only if it passes _both_ the program gate **and** the group gate. Group memberships also surface as read-only chips in the student profile menu. See [docs/groups.md](docs/groups.md) for the model, authorization rules, API, and frontend behaviour, and [docs/category-visibility-and-programs.md](docs/category-visibility-and-programs.md) for the combined visibility evaluation.

### Changelog Notifications

The notification bell is a separate feature from the site-wide announcement
banner. Admins publish Markdown changelog entries from the Admin page, and
admins plus instructors can read them from the AppBar bell's **What's New**
dialog. The Admin tab now opens on a dedicated **Changelog** sub-tab, while the
backup/import tools live under **Backups**. Read state is tracked per user, and
republishing an entry marks it unread again. See
[docs/changelog-notifications.md](docs/changelog-notifications.md).

### CLI Access via curl

```bash
# Get a JWT token
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

```bash
# Use the token on any protected route
curl -s http://localhost:8000/api/categories/ -H "Authorization: Bearer $TOKEN"
```

## Development Without Docker

```bash
cd frontend
npm ci
npm run dev
```

Note: the Vite proxy target uses the Docker service name (`http://backend:8000`). For local development without Docker, you need to run the backend separately and update the proxy target.

## Testing

See [docs/TESTING.md](docs/TESTING.md) for the full test plan and verification procedures.

## Release & deploy flow

See [docs/RELEASE_AND_DEPLOY_FLOW.md](docs/RELEASE_AND_DEPLOY_FLOW.md) for how
a merged PR becomes a running pod in `latest` or `stable`: PR-title →
release-please, image/chart artifact contract, and the `flux-fleet`
reconciliation model for both environments.

## Documentation

| Doc                                                                                  | Covers                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [docs/groups.md](docs/groups.md)                                                     | Groups model, authorization, API surface, and frontend behaviour                |
| [docs/changelog-notifications.md](docs/changelog-notifications.md)                   | Notification bell, What's New feed, changelog CRUD, and unread-state rules      |
| [docs/feedback-subsystem.md](docs/feedback-subsystem.md)                             | In-app feedback routing, provider contract, and environment policy              |
| [docs/category-visibility-and-programs.md](docs/category-visibility-and-programs.md) | Dual-gate student visibility (programs AND groups), cascade rules, tree loading |
| [docs/domain-model.md](docs/domain-model.md)                                         | Data model reference (entities, junctions, conventions)                         |
| [docs/admin-import-export.md](docs/admin-import-export.md)                           | Admin import/export task lifecycle and data round-trip                          |
| [docs/agent-feature-map.md](docs/agent-feature-map.md)                               | "Where to change what" map across frontend/backend/tests/docs                   |
| [docs/agent-test-matrix.md](docs/agent-test-matrix.md)                               | "I changed X → run Y" decision tree for targeted test runs                      |
| [docs/TESTING.md](docs/TESTING.md)                                                   | Test plan, API endpoint → minimum-role table                                    |
| [docs/OIDC_SETUP.md](docs/OIDC_SETUP.md)                                             | OIDC / auth configuration                                                       |
| [docs/drag-and-drop.md](docs/drag-and-drop.md)                                       | Tile drag-and-drop move-vs-reorder contract                                     |
| [docs/image-metadata-and-versioning.md](docs/image-metadata-and-versioning.md)       | Image metadata, versioning, and optimistic concurrency control                  |
| [docs/image-processing-lifecycle.md](docs/image-processing-lifecycle.md)             | Image processing pipeline stages, tile generation, and worker configuration     |
| [docs/tile-cache-provenance.md](docs/tile-cache-provenance.md)                       | Tile-cache provenance fields and current/missing/stale/failed status rules      |
| [docs/backup-and-disaster-recovery.md](docs/backup-and-disaster-recovery.md)         | Production backup and DR strategy, volume layout, restore order, and runbook    |
| [docs/ui-behaviour-spec.md](docs/ui-behaviour-spec.md)                               | UI behaviour spec (role gating, browse, dialogs, viewer, file drop)             |
| [docs/RELEASE_AND_DEPLOY_FLOW.md](docs/RELEASE_AND_DEPLOY_FLOW.md)                   | Release-please + Flux deploy flow                                               |
| [AGENTS.md](AGENTS.md)                                                               | Contributor setup, workflow, and **Critical Invariants**                        |

## License

HRIV is licensed under the [Mozilla Public License 2.0](LICENSE) (`MPL-2.0`).

Third-party open-source software distributed with HRIV is acknowledged in
per-component `THIRD-PARTY-LICENSES.txt` files, generated from each component's
production/runtime dependency tree:

| Component | Notices file                                                                           | Regenerate                                                                 |
| --------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Frontend  | [`frontend/public/THIRD-PARTY-LICENSES.txt`](frontend/public/THIRD-PARTY-LICENSES.txt) | `cd frontend && npm run licenses:generate`                                 |
| Backend   | [`backend/THIRD-PARTY-LICENSES.txt`](backend/THIRD-PARTY-LICENSES.txt)                 | `cd backend && poetry run python scripts/generate_third_party_licenses.py` |
| Backup    | [`backup/THIRD-PARTY-LICENSES.txt`](backup/THIRD-PARTY-LICENSES.txt)                   | `cd backup && poetry run python scripts/generate_third_party_licenses.py`  |

The frontend file is bundled into the production image and served at
`/THIRD-PARTY-LICENSES.txt` (linked from the in-app About dialog); the backend
and backup files are copied into their respective images. Regenerate and commit
the relevant file whenever dependencies change — CI verifies the frontend file
is in sync (`npm run licenses:check`).
