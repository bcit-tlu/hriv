## Collections

Grouped-image sets for side-by-side comparison (`synchronized`, max 4
images) and ordered walkthroughs (`sequence`). `COLLECTIONS_ENABLED=true` in
local compose; every role gets the **Collections** tab. Full behaviour
contract: `docs/collections.md`; UI manual scenario: `docs/TESTING.md`
Test Case 11.

### Quick flow

1. **Create:** Collections tab → **New collection** → name, type, visibility
   (Restricted offers program/group chips; instructors only see options they
   could attach).
2. **Fill:** open an image → **Add to Collection** in the viewer action bar
   (after **Share View**), or **Search** → click **Select** → check images →
   **Add to collection** in the sticky footer.
3. **View:** click a card. `synchronized` shows linked panes (link toggles +
   reset); `sequence` shows a filmstrip with Previous/Next, ←/→ keys, and a
   `?item={image_id}` deep-linkable position.
4. **Deep links:** `?page=collections`, `?collection={id}`,
   `?collection={id}&item={image_id}` all restore on load and on
   back/forward.
5. **Edit/Delete:** pencil/trash on cards and the detail header, gated by
   `permissions.can_edit` / `can_delete`.

### Filters

- **All / Synchronized / Sequence** type toggle and **My collections** chip
  for every role.
- **Owner** select for admin/instructor/staff (never students). Admins get an
  extra **No owner (orphaned)** option → `GET /api/collections?orphaned=true`.
- Selecting **My collections** clears and disables the Owner select.

### Transfer ownership (`can_transfer`)

- Entry points: **Transfer** on the detail header and the card's swap icon.
- **Admin:** _A user_ (autocomplete, active users only) or _A program_.
- **Instructor:** program picker narrowed to their own `program_ids`.
- Confirm is disabled while the target equals the current owner; 403 / 409 /
  422 failures stay inline in the dialog.
- Orphaned collections (`owner: null`, e.g. after `DELETE /api/programs/{id}`)
  are admin-only for everything except visibility; the admin finds them via
  the Owner facet and reassigns with the same transfer dialog.
- A transferred row that no longer matches the active filters drops out of
  the list (e.g. assigned while viewing **No owner (orphaned)**).

### Useful selectors for scripted checks

- Grid rows: `[data-testid="collection-card"]`; open via
  `[data-testid="collection-card-action-area"]`.
- Filter bar: `[data-testid="collection-filters"]`; the Owner Select is the
  combobox labelled `Owner`.
- Detail: `[data-testid="collection-detail"]`, visibility chip
  `[data-testid="collection-visibility-chip"]`, restricted scope chips
  `detail-program-chip` / `detail-group-chip`.
- Transfer dialog: `Transfer ownership` title; program Select labelled
  `New owning program`; user Autocomplete labelled `New owner`;
  confirm `[data-testid="transfer-confirm"]`; error
  `[data-testid="transfer-error"]`.
- Sequence viewer: `[data-testid="sequence-collection-viewer"]`;
  synchronized viewer: `[data-testid="synchronized-collection-viewer"]`.

### Orphan round-trip without the API

The shortest UI-only way to produce an orphan is still the API (delete a
program that owns a collection — see `docs/TESTING.md` Test Case 10). With
the UI seeded: create a collection as an instructor, transfer it to a
program the instructor belongs to, delete that program as admin (People →
Programs), then find the card under **Owner → No owner (orphaned)** and
reassign it.
