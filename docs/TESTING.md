# HRIV Test Plan

This document describes the manual test cases used to verify the HRIV application. All tests assume the app is running via `docker compose up --build` with a freshly seeded database (`docker compose down -v` first if needed).

## Prerequisites

- Docker Compose environment running: `docker compose up --build`
- Frontend available at http://localhost:5173
- Backend API available at http://localhost:8000
- Database seeded with default users (see [Test Credentials](#test-credentials))
- `db/seed-assets/synthetic-monitoring-image.jpeg` present so the `seed-media` compose service can generate the local synthetic monitoring tile set

## Test Credentials

All seed users share the password `password`.

| User                  | Email                        | Password | Role       |
| --------------------- | ---------------------------- | -------- | ---------- |
| Haruki Tanaka         | admin@example.ca             | password | admin      |
| Carlos Henrique Souza | instructor@example.ca        | password | instructor |
| Devon Staff           | staff@example.ca             | password | staff      |
| Mira Patel            | student@example.ca           | password | student    |
| Synthetic Student     | synthetic.student@example.ca | password | student    |

---

## Test Case 1: Login Flow — Valid and Invalid Credentials (UI)

**Purpose:** Verify the login form accepts valid credentials and rejects invalid ones.

1. Open http://localhost:5173 in a browser.
2. **Assert:** Login form shows with Email field, Password field, and "Sign in" button.
3. **Assert:** "Sign in" button is disabled when both fields are empty.
4. Enter email: `admin@example.ca`, password: `wrongpassword`, click Sign in.
5. **Assert:** Error alert appears containing "Incorrect email or password".
6. Clear password, enter correct password: `password`, click Sign in.
7. **Assert:** Login succeeds — AppBar appears with avatar, tabs are visible.
8. **Assert:** Category tiles load (at least "Architecture" and "Panoramas" visible).
9. Click Logout. Enter email with mixed case: `Admin@Example.CA`, password: `password`, click Sign in.
10. **Assert:** Login succeeds — email matching is case-insensitive.
11. As an admin, deactivate a test account via People → Edit → status toggle, then log out.
12. Attempt login with the deactivated account's credentials.
13. **Assert:** Error alert appears containing "Account has been disabled. Please contact the TLU Learning Tech Lab via Teams to activate your account." (not "Incorrect email or password").
14. Reactivate the account to restore seed state.

### 1a: Login rate limiting is keyed on the trusted client IP

**Purpose:** Verify a spoofed `X-Forwarded-For` cannot mint fresh login
rate-limit buckets and that the account-scoped bucket bounds guessing
regardless of source address (see `docs/deployment-proxy-chain.md`).

1. Through the dev proxy (`http://localhost:5173`; the Vite proxy appends
   `X-Forwarded-For` with `xfwd: true`, mirroring the production frontend
   nginx), POST 6 bad passwords for `student@example.ca`, each with a
   different `X-Forwarded-For: 203.0.113.<n>` header.
2. **Assert:** the 6th response is `429` with `Retry-After` — the spoofed
   leftmost entry is ignored, so all attempts share one `(ip, email)` bucket.
3. **Assert:** the audit log line for each attempt shows `client_ip` as the
   real connecting address, not `203.0.113.<n>`.
4. Flush Redis (`docker compose exec redis redis-cli FLUSHDB`), then send 4
   bad passwords followed by the correct password.
5. **Assert:** the login succeeds and clears both buckets — 4 further bad
   passwords are `401`, and only the 5th is `429`.
6. To exercise the account-scoped bucket in isolation, restart the backend
   with `RATE_LIMIT_LOGIN_MAX=100` (so the per-IP bucket never trips), flush
   Redis, and send 21 bad passwords from one client.
7. **Assert:** the 21st is `429` from `rate:login:email:{email}` (default
   `RATE_LIMIT_LOGIN_EMAIL_MAX=20` / 900 s) and the correct password is also
   `429` until the window expires or Redis is flushed — the account budget is
   independent of source address. Restore the default afterwards.

---

## Test Case 2: RBAC Tab Visibility Per Role (UI)

**Purpose:** Verify each role sees only the tabs and controls they are authorized for.

1. Login as `admin@example.ca` / `password` (admin).
2. **Assert:** 4 tabs visible: Home, Images, People, Admin.
3. Click Logout.
4. Login as `student@example.ca` / `password` (student).
5. **Assert:** Only 1 tab visible: Home. No Manage tab, no Admin tab, no People tab.
6. **Assert:** Category tiles still load (students can browse).
7. Click Logout.
8. Login as `instructor@example.ca` / `password` (instructor).
9. **Assert:** 2 tabs visible: Home and Images. No Admin tab, no People tab.
10. Click Logout.
11. Login as `staff@example.ca` / `password` (staff).
12. **Assert:** 2 tabs visible: Home and People. No Images/Manage tab, no Admin tab.
13. Open the `People` tab.
14. **Assert:** The user table lists all accounts, but there is no `Add Person`
    button, no row `Delete` buttons, no selection checkboxes, and no bulk
    action bar — the table is read-only. Clicking a row does not open an
    edit dialog.
15. **Assert:** Hidden categories and inactive images are visible to staff
    while browsing (staff are not subject to the student visibility filter).
16. Click Logout.

---

## Test Case 3: Token Persistence Across Refresh

**Purpose:** Verify that a logged-in session survives a hard browser refresh.

1. While logged in as Carlos Henrique (instructor), hard-refresh the browser (F5 or Ctrl+R).
2. **Assert:** Still logged in as Carlos Henrique — AppBar shows Avatar component, no login screen shown.
3. **Assert:** Categories load successfully after refresh.

---

## Test Case 3a: Changelog Notifications (Admin + Instructor)

**Purpose:** Verify the bell badge, What's New feed, and admin-only changelog management.

1. Login as `admin@example.ca` / `password`.
2. Open the `Admin` tab.
3. **Assert:** The `Changelog` sub-tab is selected by default.
4. Create a new entry with title `v2.5` and a short Markdown body.
5. **Assert:** The new entry appears in the changelog table.
6. **Assert:** A notification bell is visible in the AppBar with an unread dot.
7. Open the bell menu.
8. **Assert:** The unread dot remains until `What's New` is opened.
9. Click `What's New`.
10. **Assert:** The dialog lists the new entry and renders the Markdown content.
11. Close the dialog.
12. **Assert:** The unread dot is cleared.
13. Logout and login as `instructor@example.ca` / `password`.
14. **Assert:** The bell is visible and the entry is readable from `What's New`.
15. **Assert:** The instructor still has no `Admin` tab and therefore cannot access changelog management controls.

---

## Test Case 3b: Table Column Preference Persistence Per User

**Purpose:** Verify that table column visibility preferences persist across logout/login for the same user without leaking to other users.

1. Login as `admin@example.ca` / `password`.
2. Open the `Images` tab.
3. Open the column chooser and enable the `Program` column.
4. **Assert:** The Images table now shows the `Program` column, and the
   persistent `Filter by` bar now includes a `Program` filter control.
5. Click Logout.
6. Login again as `admin@example.ca` / `password`.
7. Open the `Images` tab.
8. **Assert:** The `Program` column is still visible.
9. Click Logout.
10. Login as `student@example.ca` / `password`, then logout again.
11. Login as `admin@example.ca` / `password`.
12. **Assert:** The `Program` column preference is still preserved for the admin user.
13. Open the `People` tab.
14. **Assert:** The default visible columns are `Name`, `Email`, `Role`, `Program`, and `Last Accessed`.

---

## Test Case 4: CLI Access via curl — Authentication and RBAC Enforcement

**Purpose:** Verify API authentication and role-based access control work via command-line HTTP requests.

### 4a: Unauthenticated request is rejected

```bash
curl -s http://localhost:8000/api/categories/
```

**Assert:** Response contains `"Not authenticated"` with HTTP 401.

### 4b: Login and obtain a token

```bash
curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.ca","password":"password"}'
```

**Assert:** Response contains an `access_token` field.

### 4c: Authenticated request succeeds

```bash
TOKEN="<access_token from step 4b>"
curl -s http://localhost:8000/api/categories/ -H "Authorization: Bearer $TOKEN"
```

**Assert:** Response is a JSON array of category objects.

### 4d: RBAC enforcement — student cannot access admin routes

```bash
# Get a student token
STUDENT_TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"student@example.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Try an admin-only route
curl -s http://localhost:8000/api/admin/export -H "Authorization: Bearer $STUDENT_TOKEN"
```

**Assert:** Response contains `"not permitted"` with HTTP 403.

### 4e: RBAC enforcement — staff can list users but cannot mutate them

```bash
# Get a staff token
STAFF_TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff@example.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Staff CAN list users (read-only People tab backend)
curl -s http://localhost:8000/api/users/ -H "Authorization: Bearer $STAFF_TOKEN"

# But CANNOT create, edit, or delete users
curl -s -X POST http://localhost:8000/api/users/ \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"X","email":"x@example.ca","password":"pw","role":"student"}'

# And CANNOT use admin routes
curl -s http://localhost:8000/api/admin/export -H "Authorization: Bearer $STAFF_TOKEN"
```

**Assert:** The `GET` returns a JSON array of users; the `POST` returns 403
`"not permitted"`; the admin export also returns 403.

### 4f: One-liner to get a token and use it

```bash
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s http://localhost:8000/api/categories/ -H "Authorization: Bearer $TOKEN"
```

---

## Test Case 5: Logout Clears Session

**Purpose:** Verify that logging out removes the stored token and does not auto-login on refresh.

1. In the browser, click the Logout button.
2. **Assert:** Login screen appears.
3. Hard-refresh the browser (F5 or Ctrl+R).
4. **Assert:** Login screen still shown (not auto-logged in) — token was cleared from localStorage.

---

## Test Case 6: Category Navigation and Creation

**Purpose:** Verify category browsing and creation (for authorized roles).

1. Login as `admin@example.ca` / `password` (admin).
2. **Assert:** Root categories display as tiles (Architecture, Panoramas).
3. Click on "Architecture" category tile.
4. **Assert:** Subcategories appear, breadcrumb shows "Home > Architecture".
5. Click "New Category" button, enter a name, submit.
6. **Assert:** New category tile appears in current view.
7. Hard-refresh browser.
8. **Assert:** New category persists after refresh (stored in database).

---

## Test Case 7: User Management (Admin Only)

**Purpose:** Verify admin can add, deactivate/reactivate, and delete users.

1. Login as `admin@example.ca` / `password` (admin).
2. Click the People tab in the AppBar to open user management.
3. Click "Add User" — fill in name, email, role, and password.
4. **Assert:** New user appears in the user list.
5. Hard-refresh browser, reopen user management.
6. **Assert:** New user persists after refresh.
7. Edit the user and set them to inactive.
8. **Assert:** User status is shown as inactive in the People table.
9. Attempt to log in as the inactive user.
10. **Assert:** Login is rejected.
11. Edit the user again and set them back to active.
12. **Assert:** User can log in again.
13. Delete the newly created user.
14. **Assert:** User is removed from the list.

---

## Test Case 8: Admin Database Export/Import

**Purpose:** Verify the database can be exported and reimported.

1. Login as `admin@example.ca` / `password` (admin).
2. Navigate to the Admin tab.
3. Click the `Backups` sub-tab.
4. **Assert:** The export and import cards are grouped in a single card grid above the `Recent Tasks` accordion, and the archive-history panels are at the bottom.
5. Click "Export" on the database export card to download the database as JSON.
   (The UI POSTs `/api/admin/tasks/{id}/download-token` — which mints a
   short-lived `HttpOnly` cookie — then navigates to
   `/api/admin/tasks/{id}/download`; no credential appears in the URL.)
6. **Assert:** JSON file downloads containing categories, images, and users.
7. Navigate to Browse, create a new test category (to dirty the database).
8. Go back to Admin tab, open `Backups`, click "Import" on the database import card, and select the previously exported JSON file.
9. **Assert:** Import succeeds.
10. Navigate to Browse tab.
11. **Assert:** The test category created in step 7 is gone (database restored to exported state).

---

## Test Case 9: Images Page — Image Metadata Table

**Purpose:** Verify the Images page displays image metadata correctly.

1. Login as `admin@example.ca` / `password` (admin) or `instructor@example.ca` / `password` (instructor).
2. Navigate to the Images tab.
3. **Assert:** Table displays images with columns: Title, Filename, Category, Copyright, Origin, Program, Status, Created, and an actions column with ellipsis icons.
4. **Assert:** All 4 seed images are listed.

---

## Test Case 10: Collection Orphaned by Program Deletion → Admin Reassign (API)

**Purpose:** Verify that deleting a program leaves its collections in place as
orphans (admin-only), and that an admin can reassign them with
`POST /api/collections/{id}/transfer`. See [collections.md](collections.md)
("Ownership & lifecycle").

1. Obtain tokens for `admin@example.ca` and `instructor@example.ca` (Test Case 4b).
2. As admin, create a throw-away program: `POST /api/programs {"name": "Orphan Test"}` → note its `id` as `$PID`, and add the instructor to it (`PATCH /api/users/{instructor_id}` with `program_ids` including `$PID`).
3. As the instructor, create a collection: `POST /api/collections {"name": "Orphan me", "type": "sequence", "visibility": "public", "image_ids": [1]}` → note `id` as `$CID` and `version`.
4. As the instructor, move it onto the program: `POST /api/collections/$CID/transfer {"program_id": $PID, "version": <version>}`.
   **Assert:** `200`, `owner` is `{"program_id": $PID, "name": "Orphan Test"}`, `version` incremented, `permissions.can_edit` is `true`.
5. As the instructor, try to hand it to a user: `POST /api/collections/$CID/transfer {"user_id": <own id>, "version": <version>}`.
   **Assert:** `403` (only admins may transfer to a user).
6. As admin, delete the program: `DELETE /api/programs/$PID`.
   **Assert:** `204`.
7. As admin, `GET /api/collections?orphaned=true`.
   **Assert:** `$CID` is listed with `owner: null`; `GET /api/collections/$CID` still returns the collection and its image.
8. As the instructor, `PATCH /api/collections/$CID {"name": "x", "version": <version>}` and `POST /api/collections/$CID/transfer {"program_id": <another program>, "version": <version>}`.
   **Assert:** both `403` — the orphan is admin-only even though the instructor created it. As a student, `GET /api/collections/$CID` still returns `200` (public visibility survives orphaning).
9. As admin, reassign it: `POST /api/collections/$CID/transfer {"user_id": <instructor id>, "version": <version>}`.
   **Assert:** `200`, `owner` is `{"user_id": <instructor id>, "name": ...}`, `version` incremented; the instructor can PATCH it again (`200`).
10. Optional: repeat step 9 with a stale `version` → `409` whose `detail` is the current collection; with a deactivated user's id → `422`; with an unknown id → `422`; with both `user_id` and `program_id` → `422`.

---

## Test Case 11: Collections UI — Create, View, Share, Transfer, Reassign (UI)

**Purpose:** End-to-end walkthrough of the Collections tab, both viewer types,
and the ownership-management UI (#1419). Requires `COLLECTIONS_ENABLED=true`
(default in local dev). See [collections.md](collections.md).

1. Login as `instructor@example.ca` and open the **Collections** tab.
2. **New collection** → name "Skull study", type **Synchronized**, visibility **Public** → **Create**. **Assert:** the card appears with a Synchronized type chip and Public visibility chip.
3. Open the collection; add images via an image's **Add to Collection** viewer action (or select images in **Search** → **Add to collection**). **Assert:** the synchronized viewer shows the panes with the link/reset controls.
4. Switch to the library and copy the address bar (`?collection={id}`); open the URL in an incognito window logged in as a student. **Assert:** the public collection opens directly on the same view.
5. Back as the instructor, open the collection's **Edit** → change the description and save. **Assert:** the detail header updates.
6. Click **Transfer** in the detail header. **Assert:** only a program picker is offered, narrowed to programs the instructor belongs to; pick one and confirm. **Assert:** the header now reads "Managed by program _X_".
7. Attempt a transfer to a user — **Assert:** there is no "A user" option for instructors (the API would 403 anyway).
8. As `admin@example.ca`, delete that program (People → Programs). Reopen the Collections tab and pick **Owner → No owner (orphaned)**. **Assert:** the collection is listed with "No owner" and its public visibility still lets a student open it.
9. From the orphaned card's transfer icon, assign it to a user (radio **A user** → pick an active account) — **Assert:** the card leaves the orphaned list and the new owner can edit it again.
10. **Tablet check:** repeat steps 3–4 at a tablet viewport (~768px) for both a synchronized and a sequence collection; **Assert:** panes/thumbnails stay usable, the **Open image** action and viewer controls remain reachable, and no horizontal overflow appears.

---

## API Endpoint Reference

All endpoints except login require a valid JWT bearer token in the `Authorization` header.

| Method | Endpoint                                                                                                  | Auth Required | Minimum Role                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| POST   | /api/auth/login                                                                                           | No            | —                                                                                                             |
| GET    | /api/health                                                                                               | No            | —                                                                                                             |
| GET    | /api/features                                                                                             | No            | — (deployment feature flags, e.g. `collections`)                                                              |
| GET    | /api/health/ready                                                                                         | No            | —                                                                                                             |
| GET    | /api/health/storage                                                                                       | No            | —                                                                                                             |
| GET    | /api/health/queue                                                                                         | No            | — ‡                                                                                                           |
| GET    | /api/_probe                                                                                               | No            | — (internal readiness canary via included router; nginx-blocked on the public ingress)                        |
| GET    | /api/categories/                                                                                          | Yes           | student                                                                                                       |
| POST   | /api/categories/                                                                                          | Yes           | instructor                                                                                                    |
| GET    | /api/categories/tree                                                                                      | Yes           | student                                                                                                       |
| GET    | /api/categories/{id}                                                                                      | Yes           | student                                                                                                       |
| PATCH  | /api/categories/{id}                                                                                      | Yes           | instructor                                                                                                    |
| DELETE | /api/categories/{id}                                                                                      | Yes           | instructor                                                                                                    |
| GET    | /api/images/                                                                                              | Yes           | student                                                                                                       |
| POST   | /api/images/                                                                                              | Yes           | instructor                                                                                                    |
| GET    | /api/images/{id}                                                                                          | Yes           | student                                                                                                       |
| PATCH  | /api/images/{id}                                                                                          | Yes           | instructor                                                                                                    |
| DELETE | /api/images/{id}                                                                                          | Yes           | instructor                                                                                                    |
| DELETE | /api/images/bulk                                                                                          | Yes           | instructor                                                                                                    |
| GET    | /api/tile-order                                                                                           | Yes           | instructor                                                                                                    |
| PUT    | /api/tile-order                                                                                           | Yes           | instructor                                                                                                    |
| GET    | /api/tiles/{source_image_id}/{path}                                                                       | Yes           | valid tile token (image-scoped, from tokenized `tile_sources`/`thumb` URLs)                                   |
| GET    | /api/tiles-auth (nginx `auth_request` validator; 204/401/403)                                             | Yes           | valid tile token                                                                                              |
| GET    | /api/users/                                                                                               | Yes           | staff ¶                                                                                                       |
| POST   | /api/users/                                                                                               | Yes           | admin                                                                                                         |
| GET    | /api/users/{id}                                                                                           | Yes           | admin                                                                                                         |
| PATCH  | /api/users/{id}                                                                                           | Yes           | admin                                                                                                         |
| DELETE | /api/users/{id}                                                                                           | Yes           | admin                                                                                                         |
| PATCH  | /api/users/bulk/program                                                                                   | Yes           | admin                                                                                                         |
| PATCH  | /api/users/bulk/role                                                                                      | Yes           | admin                                                                                                         |
| PATCH  | /api/users/bulk/active                                                                                    | Yes           | admin                                                                                                         |
| DELETE | /api/users/bulk                                                                                           | Yes           | admin                                                                                                         |
| GET    | /api/programs/                                                                                            | Yes           | student                                                                                                       |
| GET    | /api/programs/{id}                                                                                        | Yes           | student                                                                                                       |
| POST   | /api/programs/                                                                                            | Yes           | admin                                                                                                         |
| PATCH  | /api/programs/{id}                                                                                        | Yes           | admin                                                                                                         |
| DELETE | /api/programs/{id}                                                                                        | Yes           | admin                                                                                                         |
| GET    | /api/groups/                                                                                              | Yes           | instructor                                                                                                    |
| POST   | /api/groups/                                                                                              | Yes           | instructor                                                                                                    |
| GET    | /api/groups/{id}                                                                                          | Yes           | instructor                                                                                                    |
| PATCH  | /api/groups/{id}                                                                                          | Yes           | instructor †                                                                                                  |
| DELETE | /api/groups/{id}                                                                                          | Yes           | instructor †                                                                                                  |
| GET    | /api/groups/{id}/members                                                                                  | Yes           | instructor                                                                                                    |
| POST   | /api/groups/{id}/members/bulk                                                                             | Yes           | instructor †                                                                                                  |
| DELETE | /api/groups/{id}/members/bulk                                                                             | Yes           | instructor †                                                                                                  |
| POST   | /api/groups/{id}/members/{user_id}                                                                        | Yes           | instructor †                                                                                                  |
| DELETE | /api/groups/{id}/members/{user_id}                                                                        | Yes           | instructor †                                                                                                  |
| GET    | /api/groups/{id}/instructors                                                                              | Yes           | instructor                                                                                                    |
| POST   | /api/groups/{id}/instructors/bulk                                                                         | Yes           | instructor †                                                                                                  |
| DELETE | /api/groups/{id}/instructors/bulk                                                                         | Yes           | instructor †                                                                                                  |
| POST   | /api/groups/{id}/instructors/{user_id}                                                                    | Yes           | instructor †                                                                                                  |
| DELETE | /api/groups/{id}/instructors/{user_id}                                                                    | Yes           | instructor †                                                                                                  |
| GET    | /api/collections                                                                                          | Yes           | student (`orphaned=true` filter: admin) — all `/api/collections*` routes 404 when `COLLECTIONS_ENABLED=false` |
| GET    | /api/collections/{id}                                                                                     | Yes           | student (404 if not visible)                                                                                  |
| POST   | /api/collections                                                                                          | Yes           | student (`visibility=restricted`: instructor, with attach authority)                                          |
| PATCH  | /api/collections/{id}                                                                                     | Yes           | student (owner / instructor of owning program / admin; 404 if not visible)                                    |
| DELETE | /api/collections/{id}                                                                                     | Yes           | student (owner / instructor of owning program / admin; 404 if not visible)                                    |
| PUT    | /api/collections/{id}/images                                                                              | Yes           | student (owner / instructor of owning program / admin; 404 if not visible)                                    |
| PUT    | /api/collections/{id}/viewport                                                                            | Yes           | student (owner / instructor of owning program / admin; 404 if not visible)                                    |
| POST   | /api/collections/{id}/transfer                                                                            | Yes           | instructor (owner / in owning program, to own program; to user: admin) ¤                                      |
| GET    | /api/changelog/                                                                                           | Yes           | instructor                                                                                                    |
| POST   | /api/changelog/                                                                                           | Yes           | admin                                                                                                         |
| POST   | /api/changelog/mark-read                                                                                  | Yes           | instructor                                                                                                    |
| PATCH  | /api/changelog/{id}                                                                                       | Yes           | admin                                                                                                         |
| DELETE | /api/changelog/{id}                                                                                       | Yes           | admin                                                                                                         |
| GET    | /api/admin/version                                                                                        | Yes           | instructor                                                                                                    |
| GET    | /api/admin/export                                                                                         | Yes           | admin                                                                                                         |
| POST   | /api/admin/import                                                                                         | Yes           | admin                                                                                                         |
| POST   | /api/admin/tasks/rebuild-tiles                                                                            | Yes           | admin                                                                                                         |
| POST   | /api/admin/tasks/{task_id}/download-token (mints path-scoped `HttpOnly` download cookie; 204)             | Yes           | admin                                                                                                         |
| GET    | /api/admin/tasks/{task_id}/download (streams result file)                                                 | Yes           | valid admin download cookie (task-bound, 60 s TTL, cleared on success)                                        |
| GET    | /api/admin/backups/snapshots                                                                              | Yes           | admin                                                                                                         |
| GET    | /api/admin/backups/snapshots/{name}/manifest                                                              | Yes           | admin                                                                                                         |
| POST   | /api/admin/tasks/file-restore                                                                             | Yes           | admin                                                                                                         |
| GET    | /api/admin/tasks/{task_id}/upload (status for resumable upload)                                           | Yes           | admin                                                                                                         |
| PUT    | /api/admin/tasks/{task_id}/upload (raw `application/octet-stream`; multipart/form-data rejected with 415) | Yes           | admin                                                                                                         |
| PATCH  | /api/admin/tasks/{task_id}/upload (raw chunk; `Upload-Offset` + `Upload-Length` headers)                  | Yes           | admin                                                                                                         |
| POST   | /api/admin/tasks/{task_id}/upload/finalize (finalize chunked upload)                                      | Yes           | admin                                                                                                         |
| GET    | /api/admin/tasks/files-import/archives                                                                    | Yes           | admin                                                                                                         |
| GET    | /api/admin/tasks/files-import/archive-retention                                                           | Yes           | admin                                                                                                         |
| POST   | /api/admin/tasks/files-import/rerun                                                                       | Yes           | admin                                                                                                         |
| DELETE | /api/admin/tasks/files-import/archives/{archive_task_id}                                                  | Yes           | admin                                                                                                         |
| GET    | /api/admin/tasks/backup-archives                                                                          | Yes           | admin                                                                                                         |
| DELETE | /api/admin/tasks/backup-archives/{task_id}/{artifact_role}                                                | Yes           | admin                                                                                                         |
| GET    | /api/jobs/ (list, read-only)                                                                              | Yes           | admin                                                                                                         |
| GET    | /api/jobs/{job_id} (single job supervisor state, read-only; no items)                                     | Yes           | admin                                                                                                         |
| GET    | /api/jobs/{job_id}/items (bounded keyset-paginated item inspection)                                       | Yes           | admin                                                                                                         |
| GET    | /api/jobs/rebuild-tiles (parallel-rebuild capability probe)                                               | Yes           | admin                                                                                                         |
| POST   | /api/jobs/rebuild-tiles (create durable rebuild job; 409 when disabled/active)                            | Yes           | admin                                                                                                         |
| POST   | /api/jobs/{job_id}/cancel (idempotent rebuild cancellation)                                               | Yes           | admin                                                                                                         |
| POST   | /api/jobs/{job_id}/items/{item_id}/retry (requeue one failed rebuild item)                                | Yes           | admin                                                                                                         |
| POST   | /api/jobs/{job_id}/retry-failed (requeue all failed rebuild items)                                        | Yes           | admin                                                                                                         |
| POST   | /api/telemetry/events (frontend observability event ingestion)                                            | Yes           | any authenticated user                                                                                        |
| POST   | /api/telemetry/synthetic-result **§** (synthetic monitor journey result)                                  | Yes           | synthetic account **or** `X-Synthetic-Ingest-Token` shared secret                                             |

The row marked **§** accepts either the synthetic monitor account's Bearer JWT
(account must carry `metadata_.synthetic = true`) or the operator-provisioned
`X-Synthetic-Ingest-Token` shared secret, checked first and validated without a
database connection so result submission survives auth/DB outages (#1495).
Unauthenticated requests and requests presenting both an invalid token and an
invalid JWT return 401; a valid JWT from a non-synthetic account returns 403.
The path also gained a dedicated sliding-window rate limit with this change
(`rate:synthetic-ingest`, 30 requests per 60 s, fail-open when Redis is down),
bounding abuse of a leaked token — an excess returns 429. See
[synthetic-monitoring.md](synthetic-monitoring.md).

All `/api/groups/` endpoints require the `admin` or `instructor` role (read
endpoints are open to any instructor). Rows marked **†** are mutations that
additionally require **manage authority** on that specific group: admins manage
any group; instructors manage only groups they co-own (403 otherwise). Group
members must be students and instructors must be instructors (**422** on role
mismatch); creating a duplicate group name, deleting a group still attached to a
category, or removing a group's last instructor all return **409**. See
[groups.md](groups.md) for the full model, authorization, and API details, and
[category-visibility-and-programs.md](category-visibility-and-programs.md) for
the dual-gate visibility evaluation.

Rows marked **‡** return minimal health status; they return **503** when the
queue is degraded in required task-execution mode. Detailed queue state is
available from `/api/metrics`.

The row marked **¤** (`POST /api/collections/{id}/transfer`) is
visibility-first: a caller who cannot view the collection gets **404**, one who
can view it but fails `can_transfer_collection` gets **403**. Instructors may
transfer only a collection they own or one owned by a program they belong to,
and only onto a program they belong to (never to a user — **403**). Admins may
transfer any collection to any program or any active user (unknown or
deactivated target → **422**). Collections **orphaned** by a program deletion
(both owner columns `NULL`) can only be transferred, edited or deleted by
admins. See [collections.md](collections.md) and Test Case 10.

Filesystem-import uploads use raw request bodies only. `PUT /api/admin/tasks/{task_id}/upload` streams an `application/octet-stream` body directly to disk, rejects multipart form uploads with 415, and preflights declared `Content-Length` against the admin-tasks volume so a full archive can fail fast with 507 before streaming begins.

Files larger than the 10 MiB chunk size use the resumable chunked flow: `GET /api/admin/tasks/{task_id}/upload` returns `bytes_received` for the client to resume; `PATCH /api/admin/tasks/{task_id}/upload` appends a raw chunk with `Upload-Offset` and `Upload-Length` headers; and `POST /api/admin/tasks/{task_id}/upload/finalize` transitions the task to `pending` once the total size matches. The same fail-fast 507 preflight and guarded `uploading → pending` update apply to each chunk.

Programs are a flat, admin/OIDC-managed entity: only admins may create, rename, or delete a program (optionally setting an `oidc_group`); all roles may read them. `GET /api/users/` returns all users to admins and staff, but instructors see only students and other instructors — and never users associated with the special `Admin` program. Programs are not hierarchical.

Rows marked **¶**: `GET /api/users/` is open to `admin`, `instructor`, and
`staff`. Admins and staff receive the full `UserOut` projection; instructors
receive a minimal projection (no `metadata_extra`/`last_access`) and cannot
list admins or staff. All mutation endpoints under `/api/users/` remain
admin-only — staff use the listing strictly read-only.

`GET /api/users/` accepts optional filter/search/pagination query params (applied for every role):

| Param        | Type                         | Effect                                                                                                                                                                                                                 |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`       | `admin\|instructor\|student` | Filter by role. Instructors are constrained to `student`/`instructor` (403 on `admin`, 422 on unknown). Users in the special `Admin` program are excluded from non-admin results.                                      |
| `program_id` | int (repeatable)             | Restrict to users belonging to **any** of the given programs (`?program_id=1&program_id=2` → OR), backing the multi-select program filter chips.                                                                       |
| `q`          | string                       | Case-insensitive substring match on name or email.                                                                                                                                                                     |
| `page`       | int (≥1)                     | Page number (used with `page_size`).                                                                                                                                                                                   |
| `page_size`  | int (1–200)                  | Page size. When `page`/`page_size` are supplied, the pre-pagination total is returned in the **`X-Total-Count`** response header so the client can render page controls. Omitting them returns the full filtered list. |

The response shape stays role-dependent: admins receive full `UserOut`; instructors receive a minimal projection (`id, name, email, role` plus `program_ids`/`program_names` so the membership picker can filter by program and render chips — `metadata_extra`/`last_access` stay hidden). Admin-program members are excluded from non-admin results. These params back the redesigned Manage Groups detail panel (server-side program filtering, name/email search, and pagination over hundreds of students).

`GET /api/auth/me` (and the `POST /api/auth/login` response) now also include the caller's group memberships as `group_ids`/`group_names`, alongside `program_ids`/`program_names`, so the profile menu can show students which groups they belong to.

When testing `POST /api/categories/` as an instructor, a child created beneath
a restricted ancestor may include the ancestor's narrowed program and group
IDs even when the instructor does not belong to those programs or manage those
groups. Those inherited IDs are treated as pre-existing restrictions. The
request must still return **403** for any additional program or group ID that
is not inherited and is outside the instructor's attach authority.
