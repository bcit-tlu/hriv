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

| **User**                | **Email**            | **Password** | **Role**     |
|-------------------------|----------------------|--------------|--------------|
| Haruki Tanaka           | admin@example.ca        | password     | admin        |
| Carlos Henrique Souza   | instructor@example.ca   | password     | instructor   |
| Mira Patel              | student@example.ca      | password     | student      |

### Role Capabilities

| Capability                      | Admin | Instructor | Student |
|---------------------------------|-------|------------|---------|
| Browse categories & view images | Yes   | Yes        | Yes     |
| Create/update categories        | Yes   | Yes        | No      |
| Delete categories               | Yes   | Yes        | No      |
| Manage page (image table)       | Yes   | Yes        | No      |
| Bulk import images              | Yes   | Yes        | No      |
| Manage programs                 | Yes   | No         | No      |
| Manage groups                   | Yes   | Yes\*      | No      |
| Restrict categories to groups   | Yes   | Yes\*      | No      |
| Manage announcement             | Yes   | Yes        | No      |
| Admin page (DB import/export)   | Yes   | No         | No      |
| User management (add/delete)    | Yes   | No         | No      |
| List users                      | Yes   | Yes        | No      |

\* Instructors manage only the groups they co-own and may attach only groups
they manage; admins manage and attach any group. See [docs/groups.md](docs/groups.md).

### Programs

A **program** is a flat, admin/OIDC-managed access-control unit that gates category/image visibility for students. Only admins create, rename, and delete programs; a program may carry an `oidc_group` so membership is provisioned automatically by the IdP. A category tagged with one or more programs is visible to a student only if they belong to at least one of those programs (enforced by the student visibility filter). Programs are not hierarchical.

### Groups

A **group** is an instructor-managed visibility dimension, independent of programs. Any admin or instructor can create a group and add student members (and instructor co-owners); a category restricted to one or more groups is visible to a student only if they belong to at least one of them. Visibility is a **dual gate**: a student sees a category only if it passes *both* the program gate **and** the group gate. Group memberships also surface as read-only chips in the student profile menu. See [docs/groups.md](docs/groups.md) for the model, authorization rules, API, and frontend behaviour, and [docs/category-visibility-and-programs.md](docs/category-visibility-and-programs.md) for the combined visibility evaluation.

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

| Doc | Covers |
|-----|--------|
| [docs/groups.md](docs/groups.md) | Groups model, authorization, API surface, and frontend behaviour |
| [docs/category-visibility-and-programs.md](docs/category-visibility-and-programs.md) | Dual-gate student visibility (programs AND groups), cascade rules, tree loading |
| [docs/domain-model.md](docs/domain-model.md) | Data model reference (entities, junctions, conventions) |
| [docs/admin-import-export.md](docs/admin-import-export.md) | Admin import/export task lifecycle and data round-trip |
| [docs/agent-feature-map.md](docs/agent-feature-map.md) | "Where to change what" map across frontend/backend/tests/docs |
| [docs/TESTING.md](docs/TESTING.md) | Test plan, API endpoint → minimum-role table |
| [docs/OIDC_SETUP.md](docs/OIDC_SETUP.md) | OIDC / auth configuration |
| [docs/drag-and-drop.md](docs/drag-and-drop.md) | Tile drag-and-drop move-vs-reorder contract |
| [docs/RELEASE_AND_DEPLOY_FLOW.md](docs/RELEASE_AND_DEPLOY_FLOW.md) | Release-please + Flux deploy flow |
| [AGENTS.md](AGENTS.md) | Contributor setup, workflow, and **Critical Invariants** |
