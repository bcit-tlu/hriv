# Access Control Map

## Backend Files

| Concern | Files |
|---|---|
| JWT, current user, role dependency | `backend/app/auth.py` |
| Scoped authorization predicates | `backend/app/authz.py` |
| Student category visibility | `backend/app/visibility.py` |
| Category restriction attachment | `backend/app/routers/categories.py` |
| Image visibility enforcement | `backend/app/routers/images.py` |
| Group CRUD and roster rules | `backend/app/routers/groups.py` |
| User/program membership | `backend/app/routers/users.py`, `backend/app/routers/programs.py` |
| OIDC provisioning | `backend/app/routers/oidc.py` |
| Models and junctions | `backend/app/models.py` |

## Frontend Files

| Concern | Files |
|---|---|
| User session fields | `AuthContext.tsx`, `useAuth.ts`, `api.ts` |
| Category restriction narrowing | `categoryUtils.ts` |
| Group utilities | `groupUtils.ts` |
| Category dialogs | `AddCategoryDialog.tsx`, `EditCategoryDialog.tsx`, `ManageCategoriesDialog.tsx` |
| Category picker | `CategoryPickerSelect.tsx` |
| Restriction chips/icons | `CategoryRestrictionIcons.tsx`, `restrictionStyles.ts`, `theme.ts` |
| Group management | `GroupManagementModal.tsx` |
| People and programs | `PeoplePage.tsx`, `ProgramManagementModal.tsx` |

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

## Docs And Tests

- Read `../../../../docs/category-visibility-and-programs.md`.
- Read `../../../../docs/groups.md`.
- Read `../../../../docs/OIDC_SETUP.md` for IdP group and role mapping.
- Update `../../../../README.md` and `../../../../docs/TESTING.md` when roles,
  credentials, endpoint permissions, or auth rules change.
