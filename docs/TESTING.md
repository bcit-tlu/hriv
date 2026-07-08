# HRIV Test Plan

This document describes the manual test cases used to verify the HRIV application. All tests assume the app is running via `docker compose up --build` with a freshly seeded database (`docker compose down -v` first if needed).

## Prerequisites

- Docker Compose environment running: `docker compose up --build`
- Frontend available at http://localhost:5173
- Backend API available at http://localhost:8000
- Database seeded with default users (see [Test Credentials](#test-credentials))

## Test Credentials

All seed users share the password `password`.

| User                  | Email                 | Password | Role       |
| --------------------- | --------------------- | -------- | ---------- |
| Haruki Tanaka         | admin@example.ca      | password | admin      |
| Carlos Henrique Souza | instructor@example.ca | password | instructor |
| Mira Patel            | student@example.ca    | password | student    |

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

### 4e: One-liner to get a token and use it

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

**Purpose:** Verify admin can add and delete users.

1. Login as `admin@example.ca` / `password` (admin).
2. Click the People tab in the AppBar to open user management.
3. Click "Add User" — fill in name, email, role, and password.
4. **Assert:** New user appears in the user list.
5. Hard-refresh browser, reopen user management.
6. **Assert:** New user persists after refresh.
7. Delete the newly created user.
8. **Assert:** User is removed from the list.

---

## Test Case 8: Admin Database Export/Import

**Purpose:** Verify the database can be exported and reimported.

1. Login as `admin@example.ca` / `password` (admin).
2. Navigate to the Admin tab.
3. Click the `Backups` sub-tab.
4. **Assert:** Export cards are shown above the `Recent Tasks` accordion, and import cards are at the bottom.
5. Click "Export" on the database export card to download the database as JSON.
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

## API Endpoint Reference

All endpoints except login require a valid JWT bearer token in the `Authorization` header.

| Method | Endpoint                                                                                                  | Auth Required | Minimum Role |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------- | ------------ |
| POST   | /api/auth/login                                                                                           | No            | —            |
| GET    | /api/health                                                                                               | No            | —            |
| GET    | /api/categories/                                                                                          | Yes           | student      |
| POST   | /api/categories/                                                                                          | Yes           | instructor   |
| GET    | /api/categories/tree                                                                                      | Yes           | student      |
| GET    | /api/categories/{id}                                                                                      | Yes           | student      |
| PATCH  | /api/categories/{id}                                                                                      | Yes           | instructor   |
| DELETE | /api/categories/{id}                                                                                      | Yes           | instructor   |
| GET    | /api/images/                                                                                              | Yes           | student      |
| POST   | /api/images/                                                                                              | Yes           | instructor   |
| GET    | /api/images/{id}                                                                                          | Yes           | student      |
| PATCH  | /api/images/{id}                                                                                          | Yes           | instructor   |
| DELETE | /api/images/{id}                                                                                          | Yes           | instructor   |
| DELETE | /api/images/bulk                                                                                          | Yes           | instructor   |
| GET    | /api/users/                                                                                               | Yes           | instructor   |
| POST   | /api/users/                                                                                               | Yes           | admin        |
| GET    | /api/users/{id}                                                                                           | Yes           | admin        |
| PATCH  | /api/users/{id}                                                                                           | Yes           | admin        |
| DELETE | /api/users/{id}                                                                                           | Yes           | admin        |
| GET    | /api/programs/                                                                                            | Yes           | student      |
| GET    | /api/programs/{id}                                                                                        | Yes           | student      |
| POST   | /api/programs/                                                                                            | Yes           | admin        |
| PATCH  | /api/programs/{id}                                                                                        | Yes           | admin        |
| DELETE | /api/programs/{id}                                                                                        | Yes           | admin        |
| GET    | /api/groups/                                                                                              | Yes           | instructor   |
| POST   | /api/groups/                                                                                              | Yes           | instructor   |
| GET    | /api/groups/{id}                                                                                          | Yes           | instructor   |
| PATCH  | /api/groups/{id}                                                                                          | Yes           | instructor † |
| DELETE | /api/groups/{id}                                                                                          | Yes           | instructor † |
| GET    | /api/groups/{id}/members                                                                                  | Yes           | instructor   |
| POST   | /api/groups/{id}/members/bulk                                                                             | Yes           | instructor † |
| DELETE | /api/groups/{id}/members/bulk                                                                             | Yes           | instructor † |
| POST   | /api/groups/{id}/members/{user_id}                                                                        | Yes           | instructor † |
| DELETE | /api/groups/{id}/members/{user_id}                                                                        | Yes           | instructor † |
| GET    | /api/groups/{id}/instructors                                                                              | Yes           | instructor   |
| POST   | /api/groups/{id}/instructors/bulk                                                                         | Yes           | instructor † |
| DELETE | /api/groups/{id}/instructors/bulk                                                                         | Yes           | instructor † |
| POST   | /api/groups/{id}/instructors/{user_id}                                                                    | Yes           | instructor † |
| DELETE | /api/groups/{id}/instructors/{user_id}                                                                    | Yes           | instructor † |
| GET    | /api/changelog/                                                                                           | Yes           | instructor   |
| POST   | /api/changelog/                                                                                           | Yes           | admin        |
| POST   | /api/changelog/mark-read                                                                                  | Yes           | instructor   |
| PATCH  | /api/changelog/{id}                                                                                       | Yes           | admin        |
| DELETE | /api/changelog/{id}                                                                                       | Yes           | admin        |
| GET    | /api/admin/export                                                                                         | Yes           | admin        |
| POST   | /api/admin/import                                                                                         | Yes           | admin        |
| POST   | /api/admin/tasks/rebuild-tiles                                                                            | Yes           | admin        |
| GET    | /api/admin/backups/snapshots                                                                              | Yes           | admin        |
| GET    | /api/admin/backups/snapshots/{name}/manifest                                                              | Yes           | admin        |
| POST   | /api/admin/tasks/file-restore                                                                             | Yes           | admin        |
| PUT    | /api/admin/tasks/{task_id}/upload (raw `application/octet-stream`; multipart/form-data rejected with 415) | Yes           | admin        |
| GET    | /api/admin/tasks/backup-archives                                                                          | Yes           | admin        |
| DELETE | /api/admin/tasks/backup-archives/{task_id}/{artifact_role}                                                | Yes           | admin        |

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

Filesystem-import uploads use raw request bodies only. `PUT /api/admin/tasks/{task_id}/upload` streams an `application/octet-stream` body directly to disk, rejects multipart form uploads with 415, and preflights declared `Content-Length` against the admin-tasks volume so a full archive can fail fast with 507 before streaming begins.

Programs are a flat, admin/OIDC-managed entity: only admins may create, rename, or delete a program (optionally setting an `oidc_group`); all roles may read them. `GET /api/users/` returns all users to admins and instructors. Programs are not hierarchical.

`GET /api/users/` accepts optional filter/search/pagination query params (applied for every role):

| Param        | Type                         | Effect                                                                                                                                                                                                                 |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`       | `admin\|instructor\|student` | Filter by role. Instructors are constrained to `student`/`instructor` (403 on `admin`, 422 on unknown).                                                                                                                |
| `program_id` | int (repeatable)             | Restrict to users belonging to **any** of the given programs (`?program_id=1&program_id=2` → OR), backing the multi-select program filter chips.                                                                       |
| `q`          | string                       | Case-insensitive substring match on name or email.                                                                                                                                                                     |
| `page`       | int (≥1)                     | Page number (used with `page_size`).                                                                                                                                                                                   |
| `page_size`  | int (1–200)                  | Page size. When `page`/`page_size` are supplied, the pre-pagination total is returned in the **`X-Total-Count`** response header so the client can render page controls. Omitting them returns the full filtered list. |

The response shape stays role-dependent: admins receive full `UserOut`; instructors receive a minimal projection (`id, name, email, role` plus `program_ids`/`program_names` so the membership picker can filter by program and render chips — `metadata_extra`/`last_access` stay hidden). These params back the redesigned Manage Groups detail panel (server-side program filtering, name/email search, and pagination over hundreds of students).

`GET /api/auth/me` (and the `POST /api/auth/login` response) now also include the caller's group memberships as `group_ids`/`group_names`, alongside `program_ids`/`program_names`, so the profile menu can show students which groups they belong to.
