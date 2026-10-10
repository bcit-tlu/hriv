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
5. In the column chooser, drag the `Program` row's handle (or focus the
   handle and use Enter + arrow keys) to move `Program` before `Name`,
   then click **Done**.
6. **Assert:** The `Program` column now renders left of `Name` in the table,
   and the `Program` filter control precedes `Name` in the `Filter by` bar.
7. Click Logout.
8. Login again as `admin@example.ca` / `password`.
9. Open the `Images` tab.
10. **Assert:** The `Program` column is still visible and still ordered
    before `Name`.
11. Click Logout.
12. Login as `student@example.ca` / `password`, then logout again.
13. Login as `admin@example.ca` / `password`.
14. **Assert:** The `Program` column preference and order are still preserved
    for the admin user.
15. Open the `People` tab.
16. **Assert:** The default visible columns are `Name`, `Email`, `Role`,
    `Program`, and `Last Accessed` in that order.

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

## Test Case 9a: Image View — Collection Membership Row (#1586)

**Purpose:** Verify the image view lists the collections an image belongs to,
filtered to those the caller may view, and that the endpoint is gated by
`COLLECTIONS_ENABLED`. Requires `COLLECTIONS_ENABLED=true` (local-dev default).

1. As `instructor@example.ca`, create a public collection containing image 1:
   `POST /api/collections {"name": "Viewer set A", "type": "sequence", "visibility": "public", "category_id": <a category visible to students>, "image_ids": [1]}`.
2. As `admin@example.ca`: `GET /api/images/1/collections`.
   **Assert:** `200` with a `CollectionSummaryOut[]` that includes "Viewer set A".
3. **UI:** open image 1 in the viewer. **Assert:** the metadata area shows a
   **Collections:** row listing "Viewer set A". Add image 1 to three or more
   additional collections and confirm the row shows the first three names then
   "… and N more", and that the link expands the full list inline.
4. **Student visibility:** as the instructor, create a second collection on image
   1 with `visibility=private`. As `student@example.ca`: `GET /api/images/1/collections`.
   **Assert:** `200`, the private collection is **absent** (students only see
   collections they may view), and "Viewer set A" is present.
5. **Image not visible:** as the student, request a hidden/inactive image's
   collections (an inactive image id, or one under a category hidden from the
   student): `GET /api/images/{hiddenId}/collections`.
   **Assert:** `404 Not Found` — indistinguishable from `GET /api/images/{hiddenId}`.
6. **Flag off:** restart the API with `COLLECTIONS_ENABLED=false`, then
   `GET /api/images/1/collections` as any role.
   **Assert:** `404 Not Found` (same as an unknown route); the viewer shows no
   Collections row and the frontend issues no request for it.

---

## Test Case 10: Collection Orphaned by Program Deletion → Admin Reassign (API)

**Purpose:** Verify that deleting a program leaves its collections in place as
orphans (admin-only), and that an admin can reassign them with
`PUT /api/collections/{id}/owners`. See [collections.md](collections.md)
("Owner management", "Ownership & lifecycle").

Curators must include an existing `category_id` when creating a collection.

1. Obtain tokens for `admin@example.ca` and `instructor@example.ca` (Test Case 4b).
2. As admin, create a throw-away program: `POST /api/programs {"name": "Orphan Test"}` → note its `id` as `$PID`, and add the instructor to it (`PATCH /api/users/{instructor_id}` with `program_ids` including `$PID`).
3. As the instructor, create a collection: `POST /api/collections {"name": "Orphan me", "type": "sequence", "visibility": "public", "category_id": <existing category id>, "image_ids": [1]}` → note `id` as `$CID` and `version`.
4. As the instructor, move it onto the program: `POST /api/collections/$CID/transfer {"program_id": $PID, "version": <version>}`.
   **Assert:** `200`, `owners` is `[{"user_id": null, "program_id": $PID, "name": "Orphan Test"}]` (the program becomes the sole owner — user-owner rows are cleared), `version` incremented, `permissions.can_edit` is `true`.
5. As the instructor, stage a co-owner on the program-owned collection: `PUT /api/collections/$CID/owners {"user_ids": [<instructor id>], "version": <version>}`.
   **Assert:** `200` — instructors of the owning program may manage user owners; `owners` lists the instructor first (user owners sort by name) then the program entry.
6. As admin, delete the program: `DELETE /api/programs/$PID`.
   **Assert:** `204`. The staged instructor owner keeps the collection un-orphaned — `GET /api/collections/$CID` still shows the instructor in `owners` and the instructor can PATCH it (`200`).
7. As the instructor, empty the owner set on the now-user-owned collection: `PUT /api/collections/$CID/owners {"user_ids": [], "version": <version>}`.
   **Assert:** `422` — a collection with no program owner may not lose its last user owner.
8. As admin, create a second throw-away program (`POST /api/programs {"name": "Orphan Test 2"}` → `$PID2`), then a collection (`POST /api/collections {"name": "Orphaned collection", "type": "sequence", "visibility": "public", "category_id": <existing category id>, "image_ids": [1]}` → `$CID2`) and `POST /api/collections/$CID2/transfer {"program_id": $PID2, ...}` so `$PID2` is its sole owner. Delete `$PID2` without staging any user owners.
   **Assert:** `GET /api/collections?orphaned=true` lists `$CID2` with `owners: []`; `GET /api/collections/$CID2` still returns the collection and its image.
9. As the instructor, `PATCH /api/collections/$CID2 {"name": "x", "version": <version>}`, `PUT /api/collections/$CID2/owners {"user_ids": [<instructor id>], "version": <version>}`, and `POST /api/collections/$CID2/transfer {"program_id": <another program>, "version": <version>}`.
   **Assert:** all `403` — the orphan is admin-only even though the instructor created it. As a student, `GET /api/collections/$CID2` still returns `200` (public visibility survives orphaning).
10. As admin, reassign it: `PUT /api/collections/$CID2/owners {"user_ids": [<instructor id>], "version": <version>}`.
    **Assert:** `200`, `owners` is `[{"user_id": <instructor id>, "program_id": null, "name": ...}]`, `version` incremented; the instructor can PATCH it again (`200`).
11. Optional: repeat step 10 with a stale `version` → `409` whose `detail` is the current collection; with a deactivated user's id → `422`; with an unknown id → `422`. As admin, `POST /api/collections/$CID2/transfer {"program_id": $PID3}` then `{"program_id": null}` → `200` (clears the program, user owners retained); on a program-owned collection with no user owners, `{"program_id": null}` → `422`.

---

## Test Case 11: Collections UI — Create, View, Share, Transfer, Reassign (UI)

**Purpose:** End-to-end walkthrough of the split Collections pages, both
viewer types, the manage table, and the ownership-management UI (#1419,
#1554). Requires `COLLECTIONS_ENABLED=true`
(default in local dev). See [collections.md](collections.md).

1. Login as `instructor@example.ca` and click the **Collections** tab. **Assert:** the tab only opens a sub-menu — no navigation happens — offering **Sequence** and **Synchronized** (same pattern as Manage; #1559). Pick **Synchronized** — **Assert:** the URL is `?page=collections&type=synchronized`, the header reads "Synchronized collections", and only synchronized cards render (a sequence collection never appears). Switch to **Sequence** via the tab and back; strip `type=` from the URL — **Assert:** it defaults to the Sequence list.
2. On the Synchronized page: **New collection** → name "Skull study", type **Synchronized**, visibility **Public** → choose a category as the instructor, then **Create**. **Assert:** create is disabled until a category is selected, the filed collection opens immediately, and the card appears with the Synchronized type icon immediately left of the name (#1567) and a Public visibility chip in the metadata area. **Assert:** **Move** and **Set cover image** sit in a top-right cover overlay, **Edit** is a pencil right of the title, and no Delete affordance or owner text exists on the card. As a student or staff member, create without a category and verify the collection opens unfiled.
3. Open the collection; add images via an image's **Add to Collection** viewer action (or select images in **Search** → **Add to collection**). **Assert:** the synchronized viewer shows the panes with the restore/save controls, each pane has a **link** icon at its top-right corner (all start linked — pan/zoom/rotate on one mirrors to the others; click it to unlink that pane — the icon flips to link-off — and move it independently, then re-link to rejoin without snapping; #1564, #1567), **Restore view** is disabled until **Save view** has been clicked (#1567), and the header leads with a **Home** breadcrumb — no `<h1>` title; the actions sit on the same line (the collection is unfiled) instead of the old "All collections" link (#1559, #1564). With three or four images added, **Assert:** all render in a 2×2 grid (up to the four-member cap), any linked pane's pan/zoom/rotate mirrors to every other linked pane, and **Save view** stores the layout without resetting the current view (#1561, #1566, #1567).
4. Switch to the library and copy the address bar (`?collection={id}`); open the URL in an incognito window logged in as a student. **Assert:** the public collection opens directly on the same view.
5. Back as the instructor, file the collection into a category: click the **pencil** at the end of the header breadcrumb (#1567) and pick a category in the dialog's **Category** picker (e.g. _Hematology → Lab 3_; #1566) → **Save**. Reopen it and **Assert:** the header breadcrumb reads _Home : Hematology : Lab 3 : ‹collection name› (N images)_ — the name and muted count trail the last link, like the image view (#1564) — and each link navigates Browse to that spot (#1559). **Assert:** the action buttons sharing the breadcrumb line on the right are Hide / Manage Images only — no Edit button (the breadcrumb pencil), no Move, Owners, or Delete (Owners is the transfer-horizontal icon beside the "Managed by …" line; #1559, #1566, #1567). **Assert:** the edit dialog is the wider variant with the **Category** picker under the **Type** section and the **Hide Collection** link in the title row (#1566, #1567); change the description and save. **Assert:** the detail header updates; below the breadcrumb row the pills order **Synchronized** type chip then the **Public** visibility chip, left of the owner line, with the description below the pills (#1564, #1567).
6. Delete path: reopen the editor via the breadcrumb **pencil** → **Delete Collection** at the bottom of the dialog. **Assert:** the first click only arms ("This action cannot be undone. Click again to confirm."); cancel instead, then recreate the flow later — or confirm on a throwaway collection and **Assert:** it disappears from the list (deleting the open collection returns to the list).
7. Click the transfer-horizontal icon beside the "Managed by …" line in the detail header. **Assert:** the dialog opens on the **User** radio with the instructor's row pre-checked in the checkbox table, a **Role** filter button offering **Students / Instructors** (no **Everyone** — that's admin-only), and Search and Program filter buttons beside it. Pick a program in the **Program** filter — **Assert:** only students in that program appear; the **Instructors** role ignores the program filter (group-picker parity). Switch **Role** to **Instructors**, find a colleague and check their row, then click **Change Owner(s)**. **Assert:** the card/detail header now lists both owners, and the new co-owner can edit the collection.
8. With both user owners in place, switch the same dialog to the **Program** radio and click a program chip. **Assert:** it becomes the filled, deletable chip (the chip's ✕ reverts it to outlined) and the "clears the user owners" hint shows; save via **Change Owner**. **Assert:** the header now shows the program as sole owner.
9. As `admin@example.ca`, delete that program (People → Programs). Reopen the Synchronized page and pick **Owner → No owner (orphaned)**. **Assert:** the collection is listed (tiles show no owner text — the facet is the orphan signal) and its public visibility still lets a student open it.
10. From the orphaned card's **Owners** overlay action, check an account in the user table and save via **Change Owner(s)** — **Assert:** the card leaves the orphaned list and the new owner can edit it again.
11. As `staff@example.ca`, open **Collections → Sequence** — **Assert:** every sequence collection is listed (staff see all like instructors) and the **New collection** button is present. Create a private **Sequence** collection, add an image, rename it via the breadcrumb **pencil**, and delete it via the editor's **Delete Collection** — all succeed (staff hold the same owner rights as students). **Assert:** no **Owners** action appears on the card (staff can never manage owners).
12. Still as staff, open **Manage → Collections**. **Assert:** the table lists every collection (both types) with sortable columns and the filter facets (Name / Type / Visibility / Owner / Category); each row shows its category as a clickable Browse breadcrumb (#1567); Programs/Groups scope chips, Owners, Scope, Images, ID, and Created are opt-in via **Choose columns**. Click a row thumbnail — **Assert:** it opens the collection view, not the editor. Click a row's **actions** (⋮) — **Assert:** staff see **View** (and **Edit** only where the API permits), never Owners/Delete — no row carries Move; filing moved into the edit dialog's **Category** picker and the Browse card's **Move** overlay (#1566). Toggle a row's **Visibility** switch — **Assert:** hidden rows render greyscale like inactive image rows. Use **Choose columns** to hide a column — **Assert:** the choice persists after a reload. As `admin@example.ca`, repeat — **Assert:** **Manage owners** appears in the menu where permitted; refile a collection via **Edit → Category** and confirm it in Browse (undo via the snackbar).
13. **Manage dialog (#1566, #1567):** open the sequence collection and click **Manage Images** in the header. **Assert:** a "Manage Collection Images — {name}" dialog shows every member as a filmstrip-size thumbnail with its name; thumbnails wrap onto new rows rather than scrolling horizontally. Drag a thumbnail to a new position and drop — **Assert:** the order persists after a reload. Click **Multi-select** in the dialog header — **Assert:** tiles gain stock checkboxes at the corner and dragging is suspended; tick two members and click the dialog-wide **Remove 2 Selected Images** button at the bottom — **Assert:** both leave the draft in one step (#1567). Toggle **Multi-select** off — **Assert:** drag and the corner remove control are back. Click **Choose images** — **Assert:** the search modal opens in picker mode (checkboxes already on, no Select toggle) offering only the **Categories** and **Images** chips — both pre-applied, no other type or field chips; unticking both widens to all kinds. Tick individual images and a whole category — **Assert:** the category's entire subtree (sub-categories included) stages in registration order and lands at the end of the dialog grid. In the picker, **Assert:** **Select all**/**Unselect all** at the top-left toggles every listed row and stays pinned while the results scroll, the "N images selected" count covers each category's whole subtree, and **Cancel** sits at the bottom-right beside **Add to collection** and closes the picker. **Assert:** a matching category whose subtree holds no addable images does not appear in the picker results at all (no greyed-out checkbox), while the same search outside the picker still lists it. Also verify a tile's corner remove control (tooltip **Remove image**) removes that member, that **Cancel** beside **Done** closes the dialog without saving (confirming first if edits were staged), and that a focused tile reorders with Space + arrow keys (#1567).
14. **Hide/show (#1559, #1566):** as the instructor, open a collection and click **Hide collection** in the top-right header (or the **Hide Collection** link in the edit dialog's title row). **Assert:** the detail controls desaturate (no `Hidden` chip, #1567), the card desaturates with an eye-off marker, and the row in Manage → Collections shows the same marker. In an incognito student window, the collection's URL now answers 404 and it is gone from lists and Browse — unless the student owns it (a student owner still opens it). Click **Show collection** to restore. **Assert:** a student owner never sees the Hide/Show link (hide is curatorial), and `PATCH /api/collections/{id}` with only `{"hidden": true, "version": n}` answers 403 for students/staff but 200 for any admin/instructor.
15. **Tablet check:** repeat steps 3–4 at a tablet viewport (~768px) for both a synchronized and a sequence collection; **Assert:** panes/thumbnails stay usable, the **Open image** action and viewer controls remain reachable, and no horizontal overflow appears.
16. **Sequence viewer nav (#1561, #1564):** open a multi-image sequence collection. **Assert:** the thumbnail filmstrip sits **above** the viewer and the viewer region already has focus — pressing → steps to the next image and ← back, without clicking first — and the arrows keep stepping even after a dialog closes or a header action moves focus elsewhere (#1567). **Assert:** no Previous/Next buttons sit in a toolbar row; moving the pointer over the viewer fades in chevron buttons on the left and right edges (dimmed at the first/last image), and they fade out again after a couple of seconds idle or when the pointer leaves — while **Previous**/**Next**, the thumbnails, and the ←/→ arrow keys all still navigate. **Assert:** the caption row under the viewport holds the member name left and the `n of N` position plus **Open image** right, and the current thumbnail's highlight ring frames it on all four sides.

---

## Test Case 12: Collections in the Browse Hierarchy — Tiles, Filing, Drag-Add (UI)

**Purpose:** Walk the Browse-side collection surface and A1 promotion model
(#1583) — filed tiles nested inside categories, unfiled collections outside
Browse, move filing, mixed-tile reorder, and the image-onto-collection add
gesture. Requires `COLLECTIONS_ENABLED=true` and the seeded
**Italian Cathedrals** sequence collection (filed under _Architecture →
Italian_, public, instructor-owned). See
[docs/drag-and-drop.md](drag-and-drop.md) and
[docs/tile-ordering.md](tile-ordering.md).

1. Login as `instructor@example.ca`, open **Browse** at the root. **Assert:**
   no unfiled collection appears as a tile; the root tile-order scope contains
   categories and images only. Repeat Browse with admin, staff, and student
   accounts to confirm unfiled collections are absent for every role.
2. In **Manage → Collections**, confirm an unfiled collection remains
   manageable and is available from the existing
   `GET /api/collections?uncategorized=true` unfiled queue. Filing it into a
   root-level category such as **Featured** makes it available in that
   category's Browse scope.
3. As instructor, check `GET /api/tile-order` with no
   `parent_category_id`: **Assert:** it omits all collection refs. A root
   `PUT /api/tile-order` containing only categories and images succeeds while
   unfiled collections exist; adding an unfiled collection ref returns
   **400** with `Collections not in scope`.
4. Open **Browse** → drill into _Architecture → Italian_. **Assert:** the
   Italian Cathedrals collection tile renders beside category and image tiles
   (same size and hover parameters), shows its icon-bearing type pill and
   image count — tiles carry no owner text; a program-owned collection shows
   a program chip beneath the type pill (#1567).
5. Open the collection tile. **Assert:** the sequence viewer loads and the
   URL carries `?collection={id}`; the header breadcrumb shows the collection's
   filed location (_Home : Architecture : Italian_) — each link navigates
   Browse to that scope (#1559).
6. Back on Browse, drag the collection tile past an image tile's centre.
   **Assert:** the mixed order persists after a reload (`PUT /api/tile-order`
   with `collection`/`image` refs in the category scope).
7. Drag the collection tile onto another category tile's **Move into
   category** zone (near half). **Assert:** the collection disappears from
   the current scope and appears inside the target category; undo via the
   snackbar to restore it.
8. Drag an image tile onto the filed collection tile's near half. **Assert:**
   the **Add to collection** overlay highlights; on drop the image count
   grows and a snackbar offers **Undo**. The far half still reorders normally.
   The **Add to Collection** dialog remains available for unfiled collections.
9. Click the collection card's **Move** button (admins/instructors only).
   Choose **None. Access in Manage > Collections.** **Assert:** the tile
   disappears from Browse and
   the snackbar says **Removed “<name>” from Browse**; Undo restores its
   previous category. File it back into _Italian_ using the dialog.
10. File a private collection into a category. **Assert:** a warning appears,
    not a block, with the exact text: “This collection is private. Students
    will not be able to see the images in this collection.” Selecting **None. Access in Manage > Collections.** hides
    the warning; public collections show no warning. In Bulk Edit, confirm
    the matching selected-private-count warning appears only for a changed,
    non-null category.
11. As the instructor (or a user-owner), click the collection tile's **Edit**
    pencil (right of the title, the category-tile convention). **Assert:** the
    shared `CollectionEditDialog` opens on the full record; rename and save —
    **Assert:** the tile repaints with the new name. Click the tile's
    **Set cover image** overlay icon (top-right, same spot as the category
    tile's card-image button). **Assert:** `CollectionCoverPickerModal` radios
    over the collection's visible members; pick a different member and **Save**
    — **Assert:** the tile cover swaps to the picked image. Reopen, pick the
    leading **None** row → **Save** — **Assert:** the tile renders the blank
    type-logo placeholder like an uncovered category. Reopen, pick
    **Automatic** → **Save** — **Assert:** the cover falls back to the first
    member.
12. On the Browse toolbar, click **New collection** (between **Add Category**
    and **Add Images**). **Assert:** `CollectionEditDialog` opens in create
    mode with the current category already filed in the **Category** picker;
    create — **Assert:** the new tile lands in this Browse scope.
13. Login as `student@example.ca` and browse to _Italian_. **Assert:** the
    public collection tile is visible and opens, but no **Move** affordance
    renders on it (filing is curatorial); students no longer have a root-tile
    drag-add path to their own unfiled collections.
14. With `COLLECTIONS_ENABLED=false`, restart and reload Browse. **Assert:**
    no collection tiles render anywhere, reordering works on categories and
    images alone, and `GET /api/categories/tree` nodes carry empty
    `collections` lists.

## Test Case 13: My Collections Browse Drawer (UI)

**Purpose:** Verify the flag-controlled personal drawer is available throughout
Browse, the image viewer, and the Collections pages, supports temporary and
persistent modes, and stays off the Manage, People, Admin, and Guide pages.

1. Enable `COLLECTIONS_ENABLED` and `COLLECTIONS_HOME_SHELF`, then sign in as
   a student, instructor, or admin with at least one visible owned collection.
2. Open Browse home and a nested category. Confirm a bottom-left
   **My collections** button appears in both places, and that it also appears
   in the image viewer, on the Collections list pages, and on an open
   collection detail (#1608). Confirm the Manage, People, and Admin pages do
   not show it. Open it and confirm the
   bottom drawer shows at most eight collections ordered by most recently
   updated, plus **New collection**, a pin button beside the title, and a
   close button. Confirm
   the sheet rises from behind the footer (its bottom edge never shows above
   the footer), that the button attaches to the sheet's title slot and rides
   up with it, doubling as the sheet's title, that tiles show only the cover
   and name (no image count or
   chips), and that the drawer has no move, reorder, or drop targets.
3. Leave the drawer unpinned. Confirm it has a backdrop that prevents Browse
   interaction but stops above the footer, and that backdrop click, Escape,
   the header's close button, and a second press of the **My collections**
   button each close it.
4. Open and pin the drawer, then reload Browse. Confirm it returns pinned and
   open, has no backdrop, leaves the visible Browse area clickable, and does
   not cover the final tile row, and that the **My collections** button is
   outlined and not clickable. Press the pin again — **Assert:** the drawer
   stays open and only returns to the temporary (backdrop, filled clickable
   button, close control) state; it never reloads its tiles on the pin toggle,
   and the pin icon fills with a light-grey circle while pinned. Re-pin and
   overscroll past the end of the page — **Assert:** the footer and the
   drawer move together as one block. Unpin, collapse it via the
   **My collections** button, and confirm the pin preference is retained.
5. Select a collection and confirm it opens. Reopen the drawer, close it via
   the header's close button, then reopen it once more and choose
   **New collection**; create one, and confirm the new
   collection page opens directly.
6. Open an image viewer, a Collections list page, and an open collection
   detail. Confirm the button and drawer are available on each, and that
   pressing ←/→ on a sequence detail still steps the sequence while the drawer
   is collapsed (and does not while it is open). Open Manage, People, and Admin
   and confirm neither the button nor the drawer appears.
7. Sign in as a user with no visible owned collections and confirm the button
   and drawer are absent. Disable `COLLECTIONS_HOME_SHELF` and confirm they are
   absent for a user with owned collections. Disable `COLLECTIONS_ENABLED` and
   confirm the drawer remains unavailable.

---

All endpoints except login require a valid JWT bearer token in the `Authorization` header.

| Method | Endpoint                                                                                                  | Auth Required | Minimum Role                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /api/auth/login                                                                                           | No            | —                                                                                                                                   |
| GET    | /api/health                                                                                               | No            | —                                                                                                                                   |
| GET    | /api/features                                                                                             | No            | — (deployment feature flags, e.g. `collections`)                                                                                    |
| GET    | /api/health/ready                                                                                         | No            | —                                                                                                                                   |
| GET    | /api/health/storage                                                                                       | No            | —                                                                                                                                   |
| GET    | /api/health/queue                                                                                         | No            | — ‡                                                                                                                                 |
| GET    | /api/_probe                                                                                               | No            | — (internal readiness canary via included router; nginx-blocked on the public ingress)                                              |
| GET    | /api/categories/                                                                                          | Yes           | student                                                                                                                             |
| POST   | /api/categories/                                                                                          | Yes           | instructor                                                                                                                          |
| GET    | /api/categories/tree                                                                                      | Yes           | student                                                                                                                             |
| GET    | /api/categories/{id}                                                                                      | Yes           | student                                                                                                                             |
| PATCH  | /api/categories/{id}                                                                                      | Yes           | instructor                                                                                                                          |
| DELETE | /api/categories/{id}                                                                                      | Yes           | instructor                                                                                                                          |
| GET    | /api/images/                                                                                              | Yes           | student                                                                                                                             |
| POST   | /api/images/                                                                                              | Yes           | instructor                                                                                                                          |
| GET    | /api/images/{id}                                                                                          | Yes           | student                                                                                                                             |
| GET    | /api/images/{id}/source-info                                                                              | Yes           | student (uploaded_by_name is admin/instructor-only)                                                                                 |
| GET    | /api/images/{id}/collections                                                                              | Yes           | student (collections the image is in, visibility-filtered; 404 if the image is not visible; 404 when `COLLECTIONS_ENABLED=false`)   |
| PATCH  | /api/images/{id}                                                                                          | Yes           | instructor                                                                                                                          |
| DELETE | /api/images/{id}                                                                                          | Yes           | instructor                                                                                                                          |
| DELETE | /api/images/bulk                                                                                          | Yes           | instructor                                                                                                                          |
| GET    | /api/tile-order                                                                                           | Yes           | instructor                                                                                                                          |
| PUT    | /api/tile-order                                                                                           | Yes           | instructor                                                                                                                          |
| GET    | /api/tiles/{source_image_id}/{path}                                                                       | Yes           | valid tile token (image-scoped, from tokenized `tile_sources`/`thumb` URLs)                                                         |
| GET    | /api/tiles-auth (nginx `auth_request` validator; 204/401/403)                                             | Yes           | valid tile token                                                                                                                    |
| GET    | /api/users/                                                                                               | Yes           | staff ¶                                                                                                                             |
| POST   | /api/users/                                                                                               | Yes           | admin                                                                                                                               |
| GET    | /api/users/{id}                                                                                           | Yes           | admin                                                                                                                               |
| PATCH  | /api/users/{id}                                                                                           | Yes           | admin                                                                                                                               |
| DELETE | /api/users/{id}                                                                                           | Yes           | admin                                                                                                                               |
| PATCH  | /api/users/bulk/program                                                                                   | Yes           | admin                                                                                                                               |
| PATCH  | /api/users/bulk/role                                                                                      | Yes           | admin                                                                                                                               |
| PATCH  | /api/users/bulk/active                                                                                    | Yes           | admin                                                                                                                               |
| DELETE | /api/users/bulk                                                                                           | Yes           | admin                                                                                                                               |
| GET    | /api/programs/                                                                                            | Yes           | student                                                                                                                             |
| GET    | /api/programs/{id}                                                                                        | Yes           | student                                                                                                                             |
| POST   | /api/programs/                                                                                            | Yes           | admin                                                                                                                               |
| PATCH  | /api/programs/{id}                                                                                        | Yes           | admin                                                                                                                               |
| DELETE | /api/programs/{id}                                                                                        | Yes           | admin                                                                                                                               |
| GET    | /api/groups/                                                                                              | Yes           | instructor                                                                                                                          |
| POST   | /api/groups/                                                                                              | Yes           | instructor                                                                                                                          |
| GET    | /api/groups/{id}                                                                                          | Yes           | instructor                                                                                                                          |
| PATCH  | /api/groups/{id}                                                                                          | Yes           | instructor †                                                                                                                        |
| DELETE | /api/groups/{id}                                                                                          | Yes           | instructor †                                                                                                                        |
| GET    | /api/groups/{id}/members                                                                                  | Yes           | instructor                                                                                                                          |
| POST   | /api/groups/{id}/members/bulk                                                                             | Yes           | instructor †                                                                                                                        |
| DELETE | /api/groups/{id}/members/bulk                                                                             | Yes           | instructor †                                                                                                                        |
| POST   | /api/groups/{id}/members/{user_id}                                                                        | Yes           | instructor †                                                                                                                        |
| DELETE | /api/groups/{id}/members/{user_id}                                                                        | Yes           | instructor †                                                                                                                        |
| GET    | /api/groups/{id}/instructors                                                                              | Yes           | instructor                                                                                                                          |
| POST   | /api/groups/{id}/instructors/bulk                                                                         | Yes           | instructor †                                                                                                                        |
| DELETE | /api/groups/{id}/instructors/bulk                                                                         | Yes           | instructor †                                                                                                                        |
| POST   | /api/groups/{id}/instructors/{user_id}                                                                    | Yes           | instructor †                                                                                                                        |
| DELETE | /api/groups/{id}/instructors/{user_id}                                                                    | Yes           | instructor †                                                                                                                        |
| GET    | /api/collections                                                                                          | Yes           | student (`orphaned=true` filter: admin) — all `/api/collections*` routes 404 when `COLLECTIONS_ENABLED=false`                       |
| GET    | /api/collections/{id}                                                                                     | Yes           | student (404 if not visible)                                                                                                        |
| POST   | /api/collections                                                                                          | Yes           | student (all roles; `visibility=restricted`: instructor, with attach authority)                                                     |
| PATCH  | /api/collections/{id}                                                                                     | Yes           | student (co-owner for content fields — staff included; scope fields need admin / instructor / sole student-or-staff owner)          |
| DELETE | /api/collections/{id}                                                                                     | Yes           | student (sole user-owner, no program owner — staff follow the same rule / instructor of owning program / admin; 404 if not visible) |
| PATCH  | /api/collections/bulk                                                                                     | Yes           | admin / instructor (curatorial fields only: `hidden`, `category_id` refile)                                                         |
| DELETE | /api/collections/bulk                                                                                     | Yes           | student (`can_delete_collection` on every id — sole user-owner / instructor of owning program / admin; 404 if not visible)          |
| PUT    | /api/collections/{id}/images                                                                              | Yes           | student (owner or co-owner — staff included / instructor of owning program / admin; 404 if not visible)                             |
| PUT    | /api/collections/{id}/viewport                                                                            | Yes           | student (owner or co-owner — staff included / instructor of owning program / admin; 404 if not visible)                             |
| POST   | /api/collections/{id}/move                                                                                | Yes           | admin / instructor (any — filing is curatorial, not ownership-bound)                                                                |
| PUT    | /api/collections/{id}/owners                                                                              | Yes           | admin / instructor (co-owner or in owning program) — replaces the user-owner set ¤                                                  |
| POST   | /api/collections/{id}/transfer                                                                            | Yes           | admin / instructor (co-owner or in owning program, to own program) — program owner only ¤                                           |
| GET    | /api/changelog/                                                                                           | Yes           | instructor                                                                                                                          |
| POST   | /api/changelog/                                                                                           | Yes           | admin                                                                                                                               |
| POST   | /api/changelog/mark-read                                                                                  | Yes           | instructor                                                                                                                          |
| PATCH  | /api/changelog/{id}                                                                                       | Yes           | admin                                                                                                                               |
| DELETE | /api/changelog/{id}                                                                                       | Yes           | admin                                                                                                                               |
| GET    | /api/admin/version                                                                                        | Yes           | instructor                                                                                                                          |
| GET    | /api/admin/export                                                                                         | Yes           | admin                                                                                                                               |
| POST   | /api/admin/import                                                                                         | Yes           | admin                                                                                                                               |
| POST   | /api/admin/tasks/rebuild-tiles                                                                            | Yes           | admin                                                                                                                               |
| POST   | /api/admin/tasks/{task_id}/download-token (mints path-scoped `HttpOnly` download cookie; 204)             | Yes           | admin                                                                                                                               |
| GET    | /api/admin/tasks/{task_id}/download (streams result file)                                                 | Yes           | valid admin download cookie (task-bound, 60 s TTL, cleared on success)                                                              |
| GET    | /api/admin/backups/snapshots                                                                              | Yes           | admin                                                                                                                               |
| GET    | /api/admin/backups/snapshots/{name}/manifest                                                              | Yes           | admin                                                                                                                               |
| POST   | /api/admin/tasks/file-restore                                                                             | Yes           | admin                                                                                                                               |
| GET    | /api/admin/tasks/{task_id}/upload (status for resumable upload)                                           | Yes           | admin                                                                                                                               |
| PUT    | /api/admin/tasks/{task_id}/upload (raw `application/octet-stream`; multipart/form-data rejected with 415) | Yes           | admin                                                                                                                               |
| PATCH  | /api/admin/tasks/{task_id}/upload (raw chunk; `Upload-Offset` + `Upload-Length` headers)                  | Yes           | admin                                                                                                                               |
| POST   | /api/admin/tasks/{task_id}/upload/finalize (finalize chunked upload)                                      | Yes           | admin                                                                                                                               |
| GET    | /api/admin/tasks/files-import/archives                                                                    | Yes           | admin                                                                                                                               |
| GET    | /api/admin/tasks/files-import/archive-retention                                                           | Yes           | admin                                                                                                                               |
| POST   | /api/admin/tasks/files-import/rerun                                                                       | Yes           | admin                                                                                                                               |
| DELETE | /api/admin/tasks/files-import/archives/{archive_task_id}                                                  | Yes           | admin                                                                                                                               |
| GET    | /api/admin/tasks/backup-archives                                                                          | Yes           | admin                                                                                                                               |
| DELETE | /api/admin/tasks/backup-archives/{task_id}/{artifact_role}                                                | Yes           | admin                                                                                                                               |
| GET    | /api/jobs/ (list, read-only)                                                                              | Yes           | admin                                                                                                                               |
| GET    | /api/jobs/{job_id} (single job supervisor state, read-only; no items)                                     | Yes           | admin                                                                                                                               |
| GET    | /api/jobs/{job_id}/items (bounded keyset-paginated item inspection)                                       | Yes           | admin                                                                                                                               |
| GET    | /api/jobs/rebuild-tiles (parallel-rebuild capability probe)                                               | Yes           | admin                                                                                                                               |
| POST   | /api/jobs/rebuild-tiles (create durable rebuild job; 409 when disabled/active)                            | Yes           | admin                                                                                                                               |
| POST   | /api/jobs/{job_id}/cancel (idempotent rebuild cancellation)                                               | Yes           | admin                                                                                                                               |
| POST   | /api/jobs/{job_id}/items/{item_id}/retry (requeue one failed rebuild item)                                | Yes           | admin                                                                                                                               |
| POST   | /api/jobs/{job_id}/retry-failed (requeue all failed rebuild items)                                        | Yes           | admin                                                                                                                               |
| POST   | /api/telemetry/events (frontend observability event ingestion)                                            | Yes           | any authenticated user                                                                                                              |
| POST   | /api/telemetry/synthetic-result **§** (synthetic monitor journey result)                                  | Yes           | synthetic account **or** `X-Synthetic-Ingest-Token` shared secret                                                                   |

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

The rows marked **¤** (`PUT /api/collections/{id}/owners` and
`POST /api/collections/{id}/transfer`) are visibility-first: a caller who
cannot view the collection gets **404**, one who can view it but fails
`can_transfer_collection` gets **403**. `PUT /owners` replaces the
**user-owner set** — admins and instructors (co-owners, or members of the
owning program) may set it to any list of active users (unknown or
deactivated ids → **422**); emptying it while no program owns the collection
→ **422** (orphan guard). `POST /transfer` reassigns the **program** owner:
instructors may pick only a program they belong to, admins any program;
assigning a program deletes the user-owner rows (the program becomes the
sole owner), and `program_id: null` clears it — but only when at least one
user-owner row remains (**422** otherwise). Collections **orphaned** by a
program deletion (no user owners and no program owner) can only be managed,
edited or deleted by admins. See [collections.md](collections.md) and Test
Case 10.

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

## Test Case 13: Student Collection and Sequence Caps

**Purpose:** Verify the student-only per-type collection count and sequence
image limits (#1583). Use a fresh student account with visible images, plus an
instructor account for the uncapped-role checks.

1. As the student, create 10 sequence collections. On the Sequence
   Collections page, while there are no synchronized collections, **Assert:**
   **New collection** remains enabled. Open it and **Assert:** Sequence is
   disabled and Synchronized is selected. Close the dialog, then create 10
   synchronized collections. **Assert:** all 20 creates succeed. At both
   limits, **Assert:** **New collection** is disabled with the tooltip
   `You've reached the limit of 10 collections of each type.` Attempt an 11th
   create of each type through the API. **Assert:** both return **422** with
   `Students may own at most 10 {type} collections`.
2. As the student, create a sequence with 21 visible image IDs.
   **Assert:** the create returns **422** with
   `Students may add at most 20 images to a sequence collection`. Repeat with
   20 IDs and **Assert:** it succeeds. Synchronized collections still reject
   a fifth image for every role.
3. As a student owner of a 20-image sequence, use **Manage Images** to add a
   21st image. **Assert:** the write is rejected with the same sequence
   cap detail. Reorder the existing images or remove one and **Assert:** those
   edits succeed. On an instructor-seeded 22-image sequence co-owned by the
   student, remove or reorder without adding and **Assert:** it remains
   editable; try adding a new image while still over 20 and **Assert:** it is
   rejected.
4. As the instructor, create and update a sequence with more than 20 images.
   **Assert:** both operations succeed. Verify student limits do not apply
   when a non-student edits a student-owned collection.
