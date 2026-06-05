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
| Manage tenant programs (top-level / OIDC) | Yes | No | No   |
| Create & manage cohorts         | Yes   | Scoped¹    | No      |
| Assign students to cohorts      | Yes   | Scoped¹    | No      |
| Manage announcement             | Yes   | Yes        | No      |
| Admin page (DB import/export)   | Yes   | No         | No      |
| User management (add/delete)    | Yes   | No         | No      |
| List users                      | Yes   | Scoped²    | No      |

¹ Instructor cohort authority is **tenant-derived**: an admin (or OIDC) assigns an instructor to one or more **tenant** programs, and the instructor may then create/rename/delete **cohorts** under those tenants and add/remove **students** to/from them — including cohorts created by other instructors in the same tenant. Instructors can never change tenant membership (their own or anyone's) and can never set a program's OIDC group, so they cannot escalate their own scope.

² Instructors see only **students** who belong to one of their tenants; admins see all users.

### Programs: tenants and cohorts

A **program** is the access-control unit that gates category/image visibility for students. Programs come in two kinds, distinguished by the nullable self-reference `parent_program_id`:

- **Tenant** (`parent_program_id IS NULL`, e.g. *MedLab Science*) — a top-level program. Tenants may carry an `oidc_group`, and tenant membership is controlled only by admins/OIDC.
- **Cohort** (`parent_program_id` → a tenant; `oidc_group` always `NULL`) — an instructor-created subdivision of a tenant, used to restrict a category to a subset of that tenant's students (e.g. one assessment group). Cohorts are single-level — a cohort's parent must be a tenant.

Typical flow: an admin/OIDC seeds instructors and students into a tenant → an instructor creates a cohort under that tenant and assigns their students → the instructor tags a new category with the cohort → only that cohort's students can see it (enforced by the existing student visibility filter). See [`docs/instructor-cohorts.md`](docs/instructor-cohorts.md) for full details.

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
