# Corgi

High-resolution image viewer powered by [OpenSeaDragon](https://openseadragon.github.io/).

Built with Vite, React 19, TypeScript, Material UI, FastAPI, and PostgreSQL.

## Quick Start

```bash
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

Source files in `frontend/src/` and `backend/app/` are bind-mounted into the containers, so edits are reflected immediately via hot-reload.

## Test Credentials

All seed users share the password `password`.

| User             | Email                  | Password   | Role         |
|------------------|------------------------|------------|--------------|
| Haruki Tanaka      | admin@bcit.ca      | password   | admin        |
| Carlos Henrique Souza   | instructor@bcit.ca        | password   | instructor   |
| Mira Patel  | student@bcit.ca    | password   | student      |

### Role Capabilities

| Capability                      | Admin | Instructor | Student |
|---------------------------------|-------|------------|---------|
| Browse categories & view images | Yes   | Yes        | Yes     |
| Create/update categories        | Yes   | Yes        | No      |
| Delete categories               | Yes   | No         | No      |
| Manage page (image table)       | Yes   | Yes        | No      |
| Admin page (DB import/export)   | Yes   | No         | No      |
| User management (add/delete)    | Yes   | No         | No      |

### CLI Access via curl

```bash
# Get a JWT token
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bcit.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Use the token on any protected route
curl -s http://localhost:8000/api/categories/ -H "Authorization: Bearer $TOKEN"
```

## Development Without Docker

```bash
cd frontend
npm install
npm run dev
```

Note: the Vite proxy target uses the Docker service name (`http://backend:8000`). For local development without Docker, you need to run the backend separately and update the proxy target.

## Testing

See [docs/TESTING.md](docs/TESTING.md) for the full test plan and verification procedures.

## Project Structure

```
frontend/          React + Vite application
  src/             Source code
  Dockerfile       Dev container image
backend/           FastAPI + SQLAlchemy backend
  app/             Application code
  Dockerfile       Backend container image
db/                Database schema and seed data
  init.sql         PostgreSQL schema
  seed.sql         Seed data (demo users, categories, images)
docs/              Documentation
  TESTING.md       Test plan and verification procedures
archive/           Legacy Laravel/Vue codebase (preserved for reference)
docker-compose.yml Docker Compose dev environment
```
