## Collections

Grouped-image sets for side-by-side comparison (`synchronized`, max 4
images) and ordered walkthroughs (`sequence`). `COLLECTIONS_ENABLED=true` in
local compose; every role gets the **Collections** tab. Full behaviour
contract: `docs/collections.md`; UI manual scenarios: `docs/TESTING.md`
Test Case 11 (Collections pages + manage table) and Test Case 12 (Browse hierarchy).

### Quick flow

1. **Create:** Collections tab → **Sequence** or **Synchronized** sub-menu
   item (each opens the same page locked to a type) → **New collection** →
   name, type, visibility
   (Restricted offers program/group chips; instructors only see options they
   could attach).
2. **Fill:** open an image → **Add to Collection** in the viewer action bar
   (after **Share View**), or **Search** → click **Select** → check images →
   **Add to collection** in the sticky footer.
3. **View:** click a card. `synchronized` shows linked panes (link toggles +
   reset); `sequence` shows a filmstrip with Previous/Next, ←/→ keys, and a
   `?item={image_id}` deep-linkable position.
4. **Browse:** filed collection tiles render beside category/image tiles
   (fixed 300px width) inside their category scope; the root tile grid
   contains categories and images only. The optional, read-only My collections
   shelf is separate from tile ordering. Unfiled collections have no Browse
   tile and remain available in collection-management views and the
   `uncategorized=true` unfiled queue. The seeded **Italian Cathedrals**
   sequence lives under _Architecture → Italian_. File with the card's
   **Move** action (admin/instructor) or by dragging the tile onto a
   category's **Move here** zone; choose **Not on Browse** to unfile.
   Reorder by dragging past any tile's centre; add an image by dropping an
   `img-` tile on an editable, filed collection tile's near half (**Add to
   collection** zone). **Add to Collection** remains available for unfiled
   collections.
5. **Deep links:** `?page=collections&type=sequence|synchronized` (missing
   `type` → sequence), `?collection={id}`,
   `?collection={id}&item={image_id}` all restore on load and on
   back/forward; a Browse-opened collection also carries `?cat=`/`?item=`
   for its scope. **Manage → Collections** (`?page=manage-collections`) is
   the non-student table view — mirrors Manage → Images; rows offer Edit
   (where `canEdit`), Owners (where `canTransfer`), Move (admin/instructor);
   staff see all rows but no Move/Owners/Delete.
6. **Edit/Delete:** pencil on the card's metadata area, Edit button on the
   detail header, gated by `permissions.can_edit`. Delete lives inside the
   edit dialog only (#1554 — **Delete Collection** at the bottom, click to
   arm then click to confirm), gated by `permissions.can_delete`.

### Filters

- The collection **type is the page** (nav sub-menu), not a filter; the
  header row holds **My collections** chip
  for every role.
- **Owner** select for admin/instructor/staff (never students). Admins get an
  extra **No owner (orphaned)** option → `GET /api/collections?orphaned=true`.
- Selecting **My collections** clears and disables the Owner select.

### Owners & transfer (`can_transfer`)

- Entry point: **Owners** in the card's cover overlay, the detail header, or
  a manage-table row — opens `CollectionOwnersDialog`
  (admins + instructors only).
- A collection has **user owners** (plural, via `PUT /api/collections/{id}/owners`)
  and/or a **program owner** (via `POST /api/collections/{id}/transfer`).
- **User owners** Autocomplete is scope-tabbed like the group pickers:
  _Students_ (default, optional **Filter by program** chips) /
  _Instructors_ for instructors; admins get an extra _Everyone_ mode that
  also finds staff/admin accounts.
- **Owning program** select sits below; picking a program disables the user
  picker (assigning a program clears user owners server-side). Instructors
  see only their own `program_ids` in the select.
- Orphan guard: confirm is disabled while the result would leave no user
  owner and no program owner (`422` server-side too). 403 / 409 / 422
  failures stay inline via `owners-error`.
- Orphaned collections (`owners: []`, e.g. after `DELETE /api/programs/{id}`)
  are admin-only for everything except viewing; the admin finds them via
  the Owner facet's **No owner (orphaned)** option and repopulates owners
  in the same dialog.
- A saved row that no longer matches the active filters drops out of the
  list (e.g. re-owned while viewing **No owner (orphaned)**).
- Deleting a user deletes collections they solely own; co-owned and
  program-owned collections survive (owner rows cascade).

### Useful selectors for scripted checks

- Grid rows: `[data-testid="collection-card"]`; open via
  `[data-testid="collection-card-action-area"]`; cover overlay chip
  `[data-testid="collection-type-chip"]`.
- Filter bar: `[data-testid="collection-filters"]`; the Owner Select is the
  combobox labelled `Owner`.
- Manage table: `[data-testid="manage-collections-table"]`, rows
  `manage-collection-row-{id}`; filter facets labelled Name / Type /
  Visibility / Owner / Category.
- Detail: `[data-testid="collection-detail"]`, visibility chip
  `[data-testid="collection-visibility-chip"]`, restricted scope chips
  `detail-program-chip` / `detail-group-chip`.
- Owners dialog: `aria-labelledby="collection-owners-title"`; scope tabs
  `aria-label="Owner search scope"`; user picker `owners-select` labelled
  `User owners`; student program filter `owners-program-filter`; program
  select `owners-program-select` labelled `Owning program`; confirm
  `owners-confirm`; error `owners-error`.
- Browse tiles: collection tiles are `SortableTile` items inside
  `[aria-label="Sortable tile grid"]`; the near-half drop zones are
  `role="region"` labelled `Move into category` (category tiles) and
  `Add to collection` (editable collection tiles).
- Sequence viewer: `[data-testid="sequence-collection-viewer"]`;
  synchronized viewer: `[data-testid="synchronized-collection-viewer"]`.

### Orphan round-trip without the API

The shortest UI-only way to produce an orphan is still the API (delete a
program that owns a collection — see `docs/TESTING.md` Test Case 10). With
the UI seeded: create a collection as an instructor, transfer it to a
program the instructor belongs to, delete that program as admin (People →
Programs), then find the card under **Owner → No owner (orphaned)** and
reassign it.
