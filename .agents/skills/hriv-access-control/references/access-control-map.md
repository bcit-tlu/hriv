# Access Control Map

## Backend Files

| Concern                            | Files                                                             |
| ---------------------------------- | ----------------------------------------------------------------- |
| JWT, current user, role dependency | `backend/app/auth.py`                                             |
| Scoped authorization predicates    | `backend/app/authz.py`                                            |
| Student category visibility        | `backend/app/visibility.py`                                       |
| Category restriction attachment    | `backend/app/routers/categories.py`                               |
| Image visibility enforcement       | `backend/app/routers/images.py`                                   |
| Group CRUD and roster rules        | `backend/app/routers/groups.py`                                   |
| User/program membership            | `backend/app/routers/users.py`, `backend/app/routers/programs.py` |
| OIDC provisioning                  | `backend/app/routers/oidc.py`                                     |
| Models and junctions               | `backend/app/models.py`                                           |

## Frontend Files

| Concern                        | Files                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------- |
| User session fields            | `AuthContext.tsx`, `useAuth.ts`, `api.ts`                                       |
| Category restriction narrowing | `categoryUtils.ts`                                                              |
| Group utilities                | `groupUtils.ts`                                                                 |
| Category dialogs               | `AddCategoryDialog.tsx`, `EditCategoryDialog.tsx`, `ManageCategoriesDialog.tsx` |
| Category picker                | `CategoryPickerSelect.tsx`                                                      |
| Restriction chips/icons        | `CategoryRestrictionIcons.tsx`, `restrictionStyles.ts`, `theme.ts`              |
| Group management               | `GroupManagementModal.tsx`                                                      |
| People and programs            | `PeoplePage.tsx`, `ProgramManagementModal.tsx`                                  |

## Role Model

- `admin`: can manage users, programs, all groups, all category attachments,
  admin operations, and all content.
- `instructor`: can edit content globally, create/manage owned groups, and
  attach only their own programs plus groups they manage.
- `student`: read-only and filtered by backend visibility.

## Visibility Model

Student category visibility passes only if:

```text
(no program restriction OR category programs overlap user programs)
AND
(no group restriction OR category groups overlap user groups)
```

Then apply hidden-subtree and ancestor-cascade exclusions. Images inherit
category visibility; do not add image-level program visibility.

## Backend And Frontend Enforcement

- `require_role(*allowed_roles)` in `backend/app/auth.py` returns FastAPI
  dependencies for coarse role gates. Student visibility is enforced in backend
  query/tree logic — frontend filtering is UX only, never security.
- `ancestorProgramIds` / `getInheritedProgramIds` compute effective program
  restrictions by walking the category tree. Always pass `user_group_ids` to
  visibility helpers for student-scoped category/image calls.
- Frontend flags: `canManageUsers` is `true` only for admins (controls
  People/Admin tabs); `canEditContent` is `true` for admins or instructors
  (controls edit buttons, upload, Images tab, Manage dropdown).
- Tab visibility by role: all roles see Home; admin + instructor also see Images
  and Manage (Categories, Groups, Announcements); admin-only adds People, Admin,
  and Programs inside Manage; students see Home only.
- Tab visibility ≠ API access: the People tab is admin-only, but instructors may
  call `GET /api/users/` (group-management pickers). Instructors get a minimal
  projection (`id`, `name`, `email`, `role`); admins get full `UserOut`.

## Endpoint Role Map

| Minimum role | Endpoints                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No auth      | `POST /api/auth/login`, `GET /api/health`                                                                                                                                                        |
| student      | `GET /api/categories/*`, `GET /api/images/*`                                                                                                                                                     |
| instructor   | Category/image create, patch, reorder, upload, delete; `GET /api/users/` (instructor-scoped projection/filter); `/api/groups/*`; editor admin tasks such as bulk import routed through `_editor` |
| admin        | User mutations (`POST/PATCH/DELETE /api/users/*`), `/api/admin/*`, `/api/programs/*`, and unrestricted group/program attachment                                                                  |

Keep this in sync with `../../../../docs/TESTING.md` (the canonical endpoint →
minimum-role table) when endpoints, roles, or auth rules change.

## Groups Invariants And Gotchas

Groups are a first-class, instructor-managed visibility dimension independent of
programs (the stacked groups refactor is complete — cohort removal #601, backend
#604, frontend #645 are merged; do not treat groups as "not started").

- Group membership is role-enforced: members must be students, instructors must
  be instructors (422 on mismatch). A group's last instructor cannot be removed
  (409); a group attached to categories cannot be deleted (409).
- `program_group_intersection` warnings are non-blocking and symmetric.
- `created_by_user_id` is audit-only (`SET NULL`); role changes after membership
  are not retroactively cleaned up.
- Frontend uses the integrated `GroupManagementModal` (selection/create/rename/
  delete + student and instructor co-owner management, server-paginated search,
  program filters, bulk add, inline removal) — not the removed
  `GroupMembersDialog`.
- `GET /api/users/` accepts optional `?role=`; instructors are constrained to
  `student` or `instructor`.
- In `routers/groups.py`, register `/bulk` routes **before** parametric
  `/{user_id}` routes, or FastAPI matches `bulk` as `user_id` and returns 422.
- Preserve regression tests for route ordering, dual-gate visibility, group
  management, and admin export/import when touching this area.
- Backend models/files: `models.py` (`Group`, `group_members`,
  `group_instructors`, `category_groups`), `authz.py`, `visibility.py`,
  `routers/groups.py`, `routers/categories.py`, `routers/users.py`,
  `routers/images.py`, `admin_ops.py`.

## Local Test Credentials

All seeded local test users use password `password`: `admin@bcit.ca`,
`instructor@bcit.ca`, `student@bcit.ca`.

## Docs And Tests

- Read `../../../../docs/category-visibility-and-programs.md`.
- Read `../../../../docs/groups.md`.
- Read `../../../../docs/OIDC_SETUP.md` for IdP group and role mapping.
- Read `oidc-vault-idp.md` (in this folder) for the Vault→Azure AD OIDC chain,
  issuer/redirect requirements, and troubleshooting.
- Update `../../../../README.md` and `../../../../docs/TESTING.md` when roles,
  credentials, endpoint permissions, or auth rules change.
