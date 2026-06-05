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
| Manage announcement             | Yes   | Yes        | No      |
| Admin page (DB import/export)   | Yes   | No         | No      |
| User management (add/delete)    | Yes   | No         | No      |
| List users                      | Yes   | Yes        | No      |

### Programs

A **program** is a flat, admin/OIDC-managed access-control unit that gates category/image visibility for students. Only admins create, rename, and delete programs; a program may carry an `oidc_group` so membership is provisioned automatically by the IdP. A category tagged with one or more programs is visible to a student only if they belong to at least one of those programs (enforced by the student visibility filter). Programs are not hierarchical.

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
