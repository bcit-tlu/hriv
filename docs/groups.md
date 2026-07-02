# Groups

**Groups** are an instructor-managed visibility dimension, independent of
[programs](category-visibility-and-programs.md). Where a program is a flat,
admin/OIDC-managed access-control unit, a group is a lightweight roster that any
instructor can create and own to restrict categories (and their images) to a
specific set of students.

Programs and groups are **independent**: group membership does not imply program
membership, and the two are never derived from one another. A student sees a
category only if it passes **both** the program gate and the group gate — see
[Category visibility & program restriction](category-visibility-and-programs.md)
for the combined dual-gate evaluation.

This page owns the groups-specific model, authorization rules, API surface, and
frontend behaviour. It was introduced by the groups refactor (backend in
[#604](https://github.com/bcit-tlu/hriv/pull/604), frontend in
[#616](https://github.com/bcit-tlu/hriv/pull/616) and
[#619](https://github.com/bcit-tlu/hriv/pull/619)), which replaced the earlier
"cohort-as-program" model removed in
[#601](https://github.com/bcit-tlu/hriv/pull/601).

## Data model

Defined in `backend/app/models.py`; schema lives in migration
`0010_add_groups`. See [Domain model reference](domain-model.md) for the full
field list.

| Entity              | Purpose                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Group`             | A named roster (`name` unique, optional `description`). `created_by_user_id` is a `SET NULL` audit reference only.     |
| `group_members`     | M2M junction `(group_id, user_id)` — members are **students**. Both FKs `CASCADE`.                                     |
| `group_instructors` | M2M junction `(group_id, user_id)` — instructors are **co-owners** with full management authority. Both FKs `CASCADE`. |
| `category_groups`   | M2M junction `(category_id, group_id)` — which categories a group restricts. `CASCADE` on category delete.             |

Relationships added to existing models:

- `Category.groups` — M2M via `category_groups` (eager `selectin`). A category
  now has two independent restriction dimensions: `programs` and `groups`.
- `User.groups` — M2M via `group_members` (the student's group memberships).
  Instructor co-ownership is tracked separately through `group_instructors`.

### Role enforcement & lifecycle invariants

- **Members must be students; instructors must be instructors.** Adding a user
  of the wrong role returns **422**.
- **The creator becomes the initial instructor.** When an _instructor_ creates a
  group they are appended to `instructors` so they can manage it. When an
  _admin_ creates a group it starts with zero instructors (admins manage every
  group regardless).
- **The last instructor cannot be removed** from a group → **409**. (Admin-owned
  groups with zero instructors are exempt — a no-op removal succeeds.)
- **A group attached to one or more categories cannot be deleted** → **409**
  (the response lists the blocking `category_ids`). Detach it from every
  category first.
- **Role changes after membership are not retroactively reconciled.** If a
  student who is a group member is later promoted to instructor, the stale
  `group_members` row is left untouched. This is harmless: instructors bypass
  student visibility filtering entirely.

## Authorization

Predicates live in `backend/app/authz.py`. The key separation is **edit
authority vs. attach/manage authority**:

- **Edit authority is global.** `can_edit_category` returns `True` for _any_
  admin or instructor. Editing a category's label, status, etc. is never gated
  by group ownership.
- **Manage authority is scoped.** `can_manage_group(user, instructor_ids)` is
  `True` for admins (any group) and for instructors listed in that group's
  `instructors`. All mutating group endpoints check this and return **403**
  otherwise.
- **Attach authority is scoped.** Instructors may attach to a category only the
  programs they belong to (`can_attach_program_to_category`) and only the groups
  they manage (`can_attach_group_to_category`); admins may attach anything.

Every `/api/groups` endpoint requires at least the **instructor** role
(`require_role("admin", "instructor")`); students receive **403**. Read
endpoints (`list`/`get`/list members/instructors) are open to any instructor;
_mutations_ additionally require manage authority on that specific group.

## API surface

Base path `/api/groups` (router `backend/app/routers/groups.py`,
`prefix="/groups"`). All endpoints require a JWT bearer token.

| Method | Endpoint                                 | Min role            | Notes                                                                                  |
| ------ | ---------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/api/groups/`                           | instructor          | List all groups.                                                                       |
| POST   | `/api/groups/`                           | instructor          | Create. **409** on duplicate name. Creator (if instructor) becomes initial instructor. |
| GET    | `/api/groups/{id}`                       | instructor          | Fetch one. **404** if missing.                                                         |
| PATCH  | `/api/groups/{id}`                       | instructor + manage | Rename / edit description. **409** on duplicate name.                                  |
| DELETE | `/api/groups/{id}`                       | instructor + manage | **409** if attached to any category.                                                   |
| GET    | `/api/groups/{id}/members`               | instructor          | List member students (minimal fields).                                                 |
| POST   | `/api/groups/{id}/members/bulk`          | instructor + manage | Add many students in one call. **422** on non-student / unknown id.                    |
| DELETE | `/api/groups/{id}/members/bulk`          | instructor + manage | Remove many students in one call.                                                      |
| POST   | `/api/groups/{id}/members/{user_id}`     | instructor + manage | Add one student.                                                                       |
| DELETE | `/api/groups/{id}/members/{user_id}`     | instructor + manage | Remove one student.                                                                    |
| GET    | `/api/groups/{id}/instructors`           | instructor          | List co-owner instructors (minimal fields).                                            |
| POST   | `/api/groups/{id}/instructors/bulk`      | instructor + manage | Add many co-owners in one call.                                                        |
| DELETE | `/api/groups/{id}/instructors/bulk`      | instructor + manage | Remove many co-owners. **409** if it would remove the last instructor.                 |
| POST   | `/api/groups/{id}/instructors/{user_id}` | instructor + manage | Add one co-owner.                                                                      |
| DELETE | `/api/groups/{id}/instructors/{user_id}` | instructor + manage | Remove one co-owner. **409** if last instructor.                                       |

Mutating endpoints return the full updated `GroupOut` (with refreshed
`member_ids` / `instructor_ids`) so the client can sync local state from the
response without re-fetching.

> **Route-ordering invariant.** In `groups.py` the `/bulk` routes **must** be
> registered _before_ the parametric `/{user_id}` routes (for both members and
> instructors). FastAPI/Starlette resolves on first full match, so registering
> `/{user_id}` first makes `bulk` match as `user_id` → **422**, silently
> breaking every bulk endpoint over HTTP. The regression test
> `test_bulk_routes_not_shadowed_by_param_routes` in `test_router_groups.py`
> guards this (unit tests that call handlers directly cannot catch route
> shadowing).

### Attaching a group to a category

Groups are attached to categories through the category endpoints, not the groups
router. `CategoryCreate` / `CategoryUpdate` accept a `group_ids` list (alongside
`program_ids`); `CategoryOut` returns the current `group_ids`. When a category is
restricted by both a program and a group, the response may include a non-blocking
`program_group_intersection` warning (see below).

### Group memberships in `/me`

`GET /api/auth/me` (and the `POST /api/auth/login` response) include the caller's
group memberships as `group_ids` / `group_names`, alongside
`program_ids` / `program_names`. This powers the read-only group chips in the
student profile menu.

### Intersection warning

`routers/categories.py::_intersection_warnings` emits a **non-blocking,
symmetric** advisory (`CategoryOut.warnings`) whenever a category is restricted
by both dimensions _and_ at least one group member belongs to none of the
selected programs (and would therefore lose access to the AND-gated category):

```json
{
  "code": "program_group_intersection",
  "message": "3 of 12 student(s) in the selected group(s) are not in any selected program and will not see this category because program and group restrictions are combined (AND)."
}
```

The operation still succeeds — this is purely informational and is computed the
same way regardless of which dimension was added last.

## Frontend behaviour

| Concern                                                                              | Where                                                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Manage → **Groups** entry (admin + instructor only)                                  | `components/AppShell.tsx`                                               |
| Group list / create / rename / delete and member management modal                    | `components/GroupManagementModal.tsx`                                   |
| Group restriction section on category dialogs                                        | `components/AddCategoryDialog.tsx`, `components/EditCategoryDialog.tsx` |
| Group chips on category tiles                                                        | `components/CategoryTile.tsx`                                           |
| Group chips in browse / viewer breadcrumbs                                           | `App.tsx`                                                               |
| Group chips in the Images table                                                      | `components/ManagePage.tsx`                                             |
| Group chips in the People table                                                      | `components/PeoplePage.tsx`                                             |
| Bulk add selected people to one or more groups (People table)                        | `components/BulkGroupModal.tsx`, `components/PeoplePage.tsx`            |
| Read-only group chips in the profile menu                                            | `components/AppShell.tsx`                                               |
| Group API wrappers / types (`ApiGroup`, `fetchUsersPaged`, `addGroupMembersBulk`, …) | `api.ts`                                                                |
| Group chip colours                                                                   | `theme.ts` (`getGroupChipColors`)                                       |

### Manage Groups modal

The Manage Groups workflow is a master-detail modal: a left rail lists groups
with create/rename/delete actions, and the right detail panel manages the
selected group's students and instructor co-owners. It is designed for rosters
of several hundred students and keeps the membership table inline rather than
opening a second dialog. The detail panel has **Students** and **Instructors**
tabs, each backed by a server-paginated table:

- Mutation failures surface backend detail through the shared API error helper
  instead of replacing it with hardcoded copy, so duplicate-name and
  category-attachment 409s stay specific; delete-blocked groups also list the
  attached categories as links inside the confirmation dialog.

- **Students tab** — a persistent **Filter by** bar combines the debounced
  name/email search box with multi-select program **filter chips** (OR
  semantics), over a paginated table (10 rows/page). Row checkboxes + "select
  all on page" feed a single **"Add N to group"** bulk call
  (`POST /api/groups/{id}/members/bulk`). The table syncs from the returned
  `GroupOut`, so added rows flip to a _Member_ chip with no re-fetch spinner.
- **Instructors tab** — the same paginated table with the persistent **Filter
  by** search bar (no program filter, since instructors aren't program-gated)
  for bulk-adding co-owners
  (`POST /api/groups/{id}/instructors/bulk`).

The table is fed by `fetchUsersPaged({ role, programIds, q, page, pageSize })`,
which calls `GET /api/users/?role=&program_id=&q=&page=&page_size=` and reads the
total from the `X-Total-Count` header. The minimal instructor projection includes
`program_ids` / `program_names` so the program filter chips can render. See
[`docs/TESTING.md`](TESTING.md) for the full `/api/users/` query-parameter
reference.

### Group chip colours

Groups now use the app's **secondary** palette as their shared visual identity
(`theme.ts::getGroupChipColors`). The full-strength variant is used for primary
group affordances (for example, the action buttons in the Manage Groups modal
and the read-only group chips in the profile menu). The subtle variant is used
for the selected group highlight in the Manage Groups list and other
lower-emphasis read-only states that are **not** modelling category-restriction
inheritance:

| Mode  | Full-strength background | Full-strength text | Subtle background           | Subtle text |
| ----- | ------------------------ | ------------------ | --------------------------- | ----------- |
| Light | `#7F665D`                | `#FFFFFF`          | `rgba(127, 102, 93, 0.16)`  | `#3E3C3A`   |
| Dark  | `#A89288`                | `#1E1E1E`          | `rgba(168, 146, 136, 0.16)` | `#E0DDD9`   |

For category restriction rendering, HRIV uses a separate cross-surface rule:
**direct** program/group restrictions render at full strength, while
**inherited** restrictions render using the same colour treatment at
**0.6 opacity**. That shared rule is used for group restriction chips on
browse-category tiles, breadcrumb rows, ManagePage image rows, and the
inherited-only category-dialog chips, plus the group lock icon in
category-picking / category-management lists.

## Export / import

Groups round-trip through the admin DB export/import. See
[Admin import/export](admin-import-export.md) for the full delete/insert ordering
and sequence-reset details.

## Tests

| Area                                              | Files                                                     |
| ------------------------------------------------- | --------------------------------------------------------- |
| Group endpoints (incl. route-ordering regression) | `backend/tests/test_router_groups.py`                     |
| Authorization predicates                          | `backend/tests/test_authz.py`                             |
| Dual-gate visibility                              | `backend/tests/test_visibility.py`                        |
| Category group attach + warnings                  | `backend/tests/test_categories.py`                        |
| Image visibility through group gate               | `backend/tests/test_router_images.py`                     |
| Export/import round-trip                          | `backend/tests/test_admin_ops.py`                         |
| Frontend group modal                              | `frontend/tests/components/GroupManagementModal.test.tsx` |
| Frontend bulk add-to-groups modal                 | `frontend/tests/components/BulkGroupModal.test.tsx`       |

Local end-to-end setup and walkthroughs live in
[`.agents/skills/testing-hriv/SKILL.md`](../.agents/skills/testing-hriv/SKILL.md).
