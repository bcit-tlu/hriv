## Key UI Navigation

### Tabs by Role

- **admin:** Home, Images, Manage, People, Admin
- **instructor:** Home, Images, Manage
- **student:** Home only

### Browse (Home)

- Category tiles + uncategorized image tiles.
- Click a tile to drill down; click an image tile to open the OpenSeadragon viewer.

### Navigation edge cases

When driving Browse programmatically (e.g. Playwright or the browser console),
category tiles render a `CardActionArea` with `data-testid="category-tile-action-area"`.
The category label is the **text content** of the `h6` inside that action area, not an
`aria-label` attribute. To click a tile by label, select the action area by
`data-testid` (and filter by `h6` text), or find the `h6` by `textContent` and click its
closest `button`/`CardActionArea` ancestor.

```javascript
// Option 1: select action areas by data-testid and filter by label text
const tile = Array.from(
  document.querySelectorAll('[data-testid="category-tile-action-area"]'),
).find((el) => el.querySelector('h6')?.textContent === 'Architecture')
tile?.click()

// Option 2: find the h6 by textContent and click its closest button
const label = Array.from(document.querySelectorAll('h6')).find(
  (el) => el.textContent === 'Architecture',
)
label?.closest('button')?.click()
```

### Images Tab

- Table columns: ID, Name, Category, Copyright, Note, Program, Status, Modified, Actions.
- Filter icon next to **ADD IMAGE** reveals per-column filters. The Category filter
  matches the full path (e.g. "Architecture : Italian" — partial string like `arch` matches).
- Three-dot menu on any row: View / Details / Move / Delete.
- Clicking an image name opens the **Edit Details** modal.

### Edit Details / Add Image / Bulk Edit modals

- All share a category dropdown rendering the full tree with view / edit / `+` icons.
- `+` on any row opens a "New Category" dialog; the new category is auto-selected.
- **Edit Details** has a **VIEW IMAGE** button that navigates to the viewer.
- When testing auto-select, cancel without saving after verifying the dropdown value
  to avoid polluting seed data.

#### Category Dropdown Counts

The category dropdown (`CategoryPickerSelect`) shows the same **total descendant**
sub-category and image count suffix used by `ManageCategoriesDialog` — e.g.
`Architecture (2 sub-categories · 3 images)`, `Italian (1 sub-category · 2 images)`,
`Gothic (1 image)`. When testing:

- Verify Architecture shows `(2 sub-categories · 3 images)` because it has two
  descendant sub-categories and three descendant images
- Verify Italian shows `(1 sub-category · 2 images)` because it has one
  descendant sub-category and two descendant images
- Verify leaf categories with a single direct image show `(1 image)` (American,
  Gothic, Panoramas)
- Verify an empty leaf category shows `Empty`

#### Program Chip Toggles

All image metadata forms (Edit Details, Add Images, Bulk Edit) use a **chip toggle
panel** for program multi-select — not a Select dropdown. The pattern:

- "Program" appears as a Typography heading above a row of Chip components
- **Filled/primary** = selected, **outlined/default** = unselected
- Click a chip to toggle its state (no Ctrl key needed)
- Multiple chips can be selected simultaneously
- In **Edit Details**: chips reflect the image's current program assignments
- In **Add Images**: all chips start outlined (no pre-selection)
- In **Bulk Edit**: all chips start outlined (changes apply to all selected images)

**Testing flow:**

1. Open Edit Details for an image with a known program (e.g. Duomo di Milano → Digital Design)
2. Verify the correct chip is filled, others are outlined
3. Click an unselected chip → verify it becomes filled (others unchanged)
4. Click a selected chip → verify it becomes outlined (others unchanged)
5. Cancel to discard changes
6. Repeat in Add Images and Bulk Edit modals to verify consistent behavior

### Program Management

Programs are a **flat**, admin/OIDC-managed entity (no hierarchy). The Manage → **Programs**
menu entry is **admin-only** (hidden for instructors) and opens **ProgramManagementModal**:
a name field, an optional **OIDC group** field, and the list of existing programs with rename
(pencil) and delete actions. Only admins may create, rename, or delete a program; instructors
and students can read programs (e.g. to attach them to categories) but cannot manage them.
A program with an `oidc_group` has its membership provisioned by the IdP; programs without one
are managed manually via user assignment on the People tab (admin only). A category tagged with
one or more programs is visible to a student only if they belong to at least one of those programs.

### Category Management

- Manage > Categories has a full dialog with drag-and-drop reordering.
- Category tree changes are reflected immediately on Browse without a refresh
  (frontend invalidates the ETag-cached `/api/categories/tree` query).

#### Duplicate Category Name Validation

The backend returns `409 Conflict` when creating or renaming a category to a name
that already exists among its siblings (same `parent_id`). The frontend dialogs
(AddCategoryDialog, EditCategoryDialog) show an inline red Alert and keep the dialog
open for retry.

**Key behaviors to verify:**

- Creating a category with the same name as an existing sibling → 409 error, dialog stays open
- Creating a category with a name that exists under a _different_ parent → allowed (succeeds)
- Renaming a category to match an existing sibling → 409 error, dialog stays open
- After a 409 error: Create/Save button re-enables (not stuck in saving state)
- The error Alert is dismissible via its close (X) button
- Validation is sibling-scoped (same `parent_id`), not global

**Testing flow (Manage > Categories):**

1. Click `+` next to "Root level" → type an existing root name (e.g. "Architecture") → Create → expect error
2. Click `+` next to a different parent (e.g. Panoramas) → type a name that exists elsewhere (e.g. "American") → Create → expect success
3. Click pencil on a category → type an existing sibling name → Save → expect error
4. **Clean up** any test categories created during step 2 (delete via the trash icon)

#### Category Program Visibility Picker

The Add/Edit Category dialogs include a "Visible to" radio group:

- **"All students"** (default for new categories) — `program_ids=[]`, chip panel hidden
- **"Specific programs"** — reveals clickable chip toggles for each program; filled/primary = selected, outlined = unselected

**Key behaviors to verify:**

- Edit dialog pre-populates radio state from existing `program_ids` (non-empty → "Specific programs" selected)
- Edit dialog pre-selects the correct program chips based on `program_ids`
- Toggling a chip enables the Save button (change detection compares against original set)
- Save persists changes; re-opening the dialog reflects the updated associations
- Add dialog defaults to "All students" with chip panel hidden
- Switching to "Specific programs" reveals all program chips (all unselected initially)
- Creating with programs selected sends `program_ids` to API
- Inline category rename (via CategoryPickerSelect in EditImageModal, etc.) does NOT wipe program associations — `programIds` parameter is optional and only included when explicitly provided

**Testing flow (Manage > Categories):**

1. Click pencil on "Architecture" → expect "Specific programs" radio selected, "Digital Design" chip filled
2. Toggle another chip (e.g. "Photography") → Save → re-open → expect both chips filled
3. Click `+` at root level → expect "All students" radio, no chip panel → switch to "Specific programs" → select a chip → Create
4. Verify via API: `GET /api/categories/tree` returns correct `program_ids` arrays
5. **Clean up** test data: restore Architecture to original `program_ids=[2]`, delete test categories

**Testing flow (inline rename via EditImageModal):**

1. Check precondition via API: Italian (id=3) has `program_ids=[2]`
2. Navigate to Architecture > Italian > click "Duomo di Milano" image tile
3. Click "Edit Details" to open EditImageModal
4. Open the Category dropdown (CategoryPickerSelect)
5. Click pencil icon next to "Italian" in the dropdown → Edit Category dialog opens
6. Verify: dialog shows **only** the name field — no "Visible to" radio or chip panel (because `programs` prop is omitted, meaning no program context)
7. Rename "Italian" to "Italian2" → Save
8. Verify via API: `GET /api/categories/tree` → Italian2 still has `program_ids=[2]` (not wiped to `[]`)
9. **Clean up**: rename back to "Italian" via same flow

**Note:** CategoryPickerSelect is used in 5 components (EditImageModal, UploadImageModal, BulkEditImagesModal, MoveImageDialog, MoveCategoryDialog). All render EditCategoryDialog without `programs` prop, so all follow the same code path. Testing via EditImageModal covers the shared behavior.

**API verification pattern:**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/categories/tree \
  | python3 -c "import sys,json; tree=json.load(sys.stdin); [print(f'{c[\"label\"]}: program_ids={c[\"program_ids\"]}') for c in tree]"
```

#### Button Guard / Form Validation States

The Save (Edit) and Create (Add) buttons have multi-condition disabled guards. Key invalid states to test:

- **Empty label + programs changed**: Save stays disabled even though `programsChanged=true` (prevents confusing no-op submission)
- **"Specific programs" with zero chips**: Save/Create disabled (prevents sending `program_ids=[]` which means "visible to all" — contradicting the explicit "Specific programs" selection)
- **Positive control**: Once a valid state is restored (label filled + at least one chip selected), button re-enables immediately

**Testing tip:** The category name input is a React-controlled Autocomplete (Combobox). Standard keyboard clearing (triple-click + Delete) may be intercepted by the autocomplete. If keyboard clearing doesn't work, use the browser console to clear it programmatically:

```javascript
const input = document.querySelector('input[type="text"]')
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value',
).set
nativeInputValueSetter.call(input, '')
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new Event('change', { bubbles: true }))
```

### Manage Members (Groups — bulk association)

`GroupManagementModal` (Manage → **Groups** → select a group in the left rail) is built for
instructors to associate many students/instructors at scale (hundreds of students across ~4
heavy programs). It is gated by group co-ownership (`canManageGroup`). The detail panel has two tabs:

- **Students** tab — a paginated table (10 rows/page) of student accounts, with:
  - **Program filter chips** (multi-select, **OR** semantics) — clicking chips narrows the table
    to students in _any_ selected program. Chips render from each student's `program_ids`.
  - **Search box** (name **or** email, debounced ~300 ms).
  - A header **"select all on page"** checkbox + per-row checkboxes, and an **"Add N to group"**
    button that calls `POST /api/groups/{id}/members/bulk` once for the whole selection.
  - Existing members show a **Member** chip + a remove (trash) icon → `DELETE /api/groups/{id}/members/{user_id}`.
- **Instructors** tab — same searchable/paginated table for co-owners, **without** the program
  filter (instructors aren't program-gated). Bulk add → `POST /api/groups/{id}/instructors/bulk`;
  existing co-owners show a **Co-owner** chip + remove icon (last-instructor removal is blocked
  with a 409 surfaced as an inline error).

Server-side filtering/pagination is driven by `GET /api/users/?role=<student|instructor>&program_id=<id>&q=<text>&page=<n>&page_size=<n>`,
reading the **`X-Total-Count`** response header to render page controls. The table updates local
state from the `GroupOut` response returned by the bulk/remove calls (no full re-fetch on toggle).

**Key behaviors to verify:**

- Selecting one or more program chips filters the student rows to the OR-union of those programs;
  clearing chips restores the full list. The instructors tab has no program chips.
- Typing in search filters by name/email after the debounce; combining search + program chips
  applies both (AND between dimensions, OR within the program set).
- "Select all on page" selects only the **current page's** rows; paging to the next page and the
  "Add N" count reflects the running multi-page selection.
- "Add N to group" performs **one** bulk call, the added users immediately appear as members with
  a remove icon, and the selection clears. No spinner flash / full list re-fetch on add or remove.
- Removing a member/co-owner updates the table from the API response. Removing the final
  instructor is rejected (409) with an inline message; the co-owner stays listed.
- **Student profile menu** shows the caller's groups as read-only chips alongside program chips
  (`group_names` from `GET /api/auth/me`).

**Group chip colour:** `#5B6973` (white text) in light theme, `#8A99A6` (dark text) in dark theme
— both WCAG-AA (≥4.5:1). Verify via `getGroupChipColors(mode)` in `frontend/src/theme.ts`.

**API verification pattern (paginated listing + bulk add):**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"instructor@example.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Page 1 of students in program 2, searching "an"; X-Total-Count drives page controls
curl -s -D - -o /dev/null -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/users/?role=student&program_id=2&q=an&page=1&page_size=10" \
  | grep -i x-total-count

# Bulk add students 3 and 5 to group 1 → returns the updated GroupOut (member_ids)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"user_ids":[3,5]}' http://localhost:8000/api/groups/1/members/bulk \
  | python3 -c "import sys,json; print('member_ids=', json.load(sys.stdin)['member_ids'])"
```

### People tab (admin only)

- Add / delete / edit users. Persistence survives a hard refresh.

### Admin tab (admin only)

- Database export/import (JSON).
- Filesystem export/import (tar.gz via background tasks with log streaming).

### Footer

- "BCIT Teaching and Learning Unit" link → https://www.bcit.ca/learning-teaching-centre/.
  Visible on all pages.

## In-app guide runtime testing

- Enter through Notifications → Documentation as instructor/admin. The guide uses
  `?page=guide&doc=<slug>` inside the React app, retaining its AppBar and footer.
  Check student entry absence and direct-query fallback separately.
- Guide sources and screenshots live in `frontend/guide`. When compose does not
  bind-mount this directory, new files or edits require a frontend image rebuild:
  `docker compose up -d --build --no-deps frontend`. If navigation renders but
  content is blank, inspect `/app/guide` inside the container before diagnosing
  the Markdown renderer.
- Exercise all seven documents, inline links, previous/next, cross-page anchors,
  refresh and browser Back/Forward. Inspect actual URL and visible heading
  together; a document switch alone does not prove history persistence.
- Visually check wrapped bullets, ordered/nested lists, underscore emphasis,
  callouts and the toolbar table. Decode every rendered screenshot as a
  supplementary check, rather than relying only on file existence.
- Await screenshot decoding before asserting anchor placement, especially on a
  cold page. Distinguish existing localhost:4318 telemetry failures from
  guide-asset or renderer errors.

### Devin Secrets Needed

None for the local seeded stack; use the seeded instructor/admin/student
accounts documented above.
