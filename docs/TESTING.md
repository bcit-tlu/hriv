# Corgi Test Plan

This document describes the manual test cases used to verify the Corgi application. All tests assume the app is running via `docker compose up --build` with a freshly seeded database (`docker compose down -v` first if needed).

## Prerequisites

- Docker Compose environment running: `docker compose up --build`
- Frontend available at http://localhost:5173
- Backend API available at http://localhost:8000
- Database seeded with default users (see [Test Credentials](#test-credentials))

## Test Credentials

All seed users share the password `password`.

| User             | Email                  | Password   | Role         |
|------------------|------------------------|------------|--------------|
| Haruki Tanaka      | admin@bcit.ca      | password   | admin        |
| Carlos Henrique Souza   | instructor@bcit.ca        | password   | instructor   |
| Mira Patel  | mira@student.com    | password   | student      |

---

## Test Case 1: Login Flow — Valid and Invalid Credentials (UI)

**Purpose:** Verify the login form accepts valid credentials and rejects invalid ones.

1. Open http://localhost:5173 in a browser.
2. **Assert:** Login form shows with Email field, Password field, and "Sign in" button.
3. **Assert:** "Sign in" button is disabled when both fields are empty.
4. Enter email: `admin@bcit.ca`, password: `wrongpassword`, click Sign in.
5. **Assert:** Error alert appears containing "Incorrect email or password".
6. Clear password, enter correct password: `password`, click Sign in.
7. **Assert:** Login succeeds — AppBar appears with avatar, tabs are visible.
8. **Assert:** Category tiles load (at least "Architecture" and "Panoramas" visible).

---

## Test Case 2: RBAC Tab Visibility Per Role (UI)

**Purpose:** Verify each role sees only the tabs and controls they are authorized for.

1. Login as `admin@bcit.ca` / `password` (admin).
2. **Assert:** 4 tabs visible: Home, Images, People, Admin.
3. Click Logout.
4. Login as `mira@student.com` / `password` (student).
5. **Assert:** Only 1 tab visible: Home. No Manage tab, no Admin tab, no People tab.
6. **Assert:** Category tiles still load (students can browse).
7. Click Logout.
8. Login as `instructor@bcit.ca` / `password` (instructor).
9. **Assert:** 2 tabs visible: Home and Images. No Admin tab, no People tab.

---

## Test Case 3: Token Persistence Across Refresh

**Purpose:** Verify that a logged-in session survives a hard browser refresh.

1. While logged in as Carlos Henrique (instructor), hard-refresh the browser (F5 or Ctrl+R).
2. **Assert:** Still logged in as Carlos Henrique — AppBar shows Avatar component, no login screen shown.
3. **Assert:** Categories load successfully after refresh.

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
  -d '{"email":"admin@bcit.ca","password":"password"}'
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
  -d '{"email":"mira@student.com","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Try an admin-only route
curl -s http://localhost:8000/api/admin/export -H "Authorization: Bearer $STUDENT_TOKEN"
```

**Assert:** Response contains `"not permitted"` with HTTP 403.

### 4e: One-liner to get a token and use it

```bash
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bcit.ca","password":"password"}' \
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

1. Login as `admin@bcit.ca` / `password` (admin).
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

1. Login as `admin@bcit.ca` / `password` (admin).
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

1. Login as `admin@bcit.ca` / `password` (admin).
2. Navigate to the Admin tab.
3. Click "Export" to download the database as JSON.
4. **Assert:** JSON file downloads containing categories, images, and users.
5. Navigate to Browse, create a new test category (to dirty the database).
6. Go back to Admin tab, click "Import", select the previously exported JSON file.
7. **Assert:** Import succeeds.
8. Navigate to Browse tab.
9. **Assert:** The test category created in step 5 is gone (database restored to exported state).

---

## Test Case 9: Images Page — Image Metadata Table

**Purpose:** Verify the Images page displays image metadata correctly.

1. Login as `admin@bcit.ca` / `password` (admin) or `instructor@bcit.ca` / `password` (instructor).
2. Navigate to the Images tab.
3. **Assert:** Table displays images with columns: Title, Filename, Category, Copyright, Origin, Program, Status, Created, and an actions column with ellipsis icons.
4. **Assert:** All 4 seed images are listed.

---

## API Endpoint Reference

All endpoints except login require a valid JWT bearer token in the `Authorization` header.

| Method | Endpoint                 | Auth Required | Minimum Role |
|--------|--------------------------|---------------|--------------|
| POST   | /api/auth/login          | No            | —            |
| GET    | /api/health              | No            | —            |
| GET    | /api/categories/         | Yes           | student      |
| POST   | /api/categories/         | Yes           | instructor   |
| GET    | /api/categories/tree     | Yes           | student      |
| GET    | /api/categories/{id}     | Yes           | student      |
| PATCH  | /api/categories/{id}     | Yes           | instructor   |
| DELETE | /api/categories/{id}     | Yes           | admin        |
| GET    | /api/images/             | Yes           | student      |
| POST   | /api/images/             | Yes           | instructor   |
| GET    | /api/images/{id}         | Yes           | student      |
| PATCH  | /api/images/{id}         | Yes           | instructor   |
| DELETE | /api/images/{id}         | Yes           | admin        |
| GET    | /api/users/              | Yes           | admin        |
| POST   | /api/users/              | Yes           | admin        |
| GET    | /api/users/{id}          | Yes           | admin        |
| PATCH  | /api/users/{id}          | Yes           | admin        |
| DELETE | /api/users/{id}          | Yes           | admin        |
| GET    | /api/admin/export        | Yes           | admin        |
| POST   | /api/admin/import        | Yes           | admin        |
