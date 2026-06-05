# Instructor-Scoped Programs (Tenants & Cohorts)

This document describes the program model that lets **instructors** subdivide a program
they belong to into **cohorts** and assign students to those cohorts, so that a category
restricted to a cohort is only visible to that cohort's students. The existing student
visibility filter (`backend/app/visibility.py`) does the enforcement; this feature just
produces the membership data that feeds it.

## The model

A **program** is the access-control unit that gates category/image visibility for students.
A single nullable self-reference, `programs.parent_program_id`, splits programs into two kinds:

| Kind       | `parent_program_id` | `oidc_group`      | Created by   | Membership controlled by |
|------------|---------------------|-------------------|--------------|---------------------------|
| **Tenant** | `NULL`              | optional          | admin        | admins / OIDC only        |
| **Cohort** | → a tenant          | always `NULL`     | instructor   | admins + tenant instructors |

- A tenant is a top-level program (e.g. *MedLab Science*). It may carry an `oidc_group` so
  membership can be provisioned from the identity provider.
- A cohort is an instructor-created subdivision of exactly one tenant. Cohorts are
  **single-level** — a cohort's parent must be a tenant, never another cohort.

`ProgramOut` exposes a computed `is_cohort` field; `is_tenant` / `is_cohort` helpers live in
`backend/app/authz.py`.

## Authority is tenant-derived

An instructor's **scope** is the set of tenants they belong to (assigned by an admin, or by
OIDC). All instructor authority derives from that membership:

- **Create:** an instructor may create a cohort only under a tenant in their scope.
  `oidc_group` is forced `NULL` and nesting is rejected.
- **Manage:** an instructor may rename/delete **any** cohort whose parent tenant is in their
  scope — regardless of who created it. So two instructors in the same tenant co-manage all of
  that tenant's cohorts automatically, with no invite or self-join step.
- **Assign:** an instructor may add/remove a **student** to/from a cohort under one of their
  tenants, provided the student already belongs to that tenant.

The pure authorization predicates (`backend/app/authz.py`):

```
can_create_cohort_under(user, parent) = admin OR (instructor AND is_tenant(parent) AND parent.id ∈ tenant_ids(user))
can_manage_program(user, program)     = admin OR (instructor AND program.parent_program_id ∈ tenant_ids(user))
can_change_cohort_membership(user, cohort, student) =
    student.role == "student" AND is_cohort(cohort) AND can_manage_program(user, cohort)
    AND (admin OR cohort.parent_program_id ∈ programs(student))   # student already in the tenant
```

> `can_manage_program` returns `True` for admins on **any** program (tenant or cohort) — the
> admin branch short-circuits before the cohort check, which is why it is named for programs
> generally rather than cohorts specifically.

### No self-escalation

Instructors can never change tenant membership — their own or anyone else's — and can never
set or clear a program's `oidc_group`. Because nobody can grant themselves a tenant, an
instructor cannot widen their own scope, so they can never reach another department's content.

## API surface

| Method | Endpoint | Min role | Notes |
|--------|----------|----------|-------|
| `GET`    | `/api/programs/` · `/api/programs/{id}` | student | List/read programs. |
| `POST`   | `/api/programs/` | instructor | Instructors → cohort under their tenant only (`oidc_group` forced `NULL`, no nesting). |
| `PATCH`  | `/api/programs/{id}` | instructor | Instructors → rename their cohorts only. Reparent/promote (`parent_program_id`, incl. `null`) and `oidc_group` writes are admin-only. |
| `DELETE` | `/api/programs/{id}` | instructor | Instructors → delete their cohorts only. |
| `POST`   | `/api/programs/{cohort_id}/members/{user_id}` | instructor | Add a student to a cohort. Idempotent (`INSERT ... ON CONFLICT DO NOTHING`). Returns the updated user. |
| `DELETE` | `/api/programs/{cohort_id}/members/{user_id}` | instructor | Remove a student from a cohort. Returns the updated user. |
| `GET`    | `/api/users/` | instructor | Admins: all users. Instructors: only **students** in their tenants (`DISTINCT`). |

Membership writes are **delta** operations (add/remove), never set-replace, so concurrent
edits by co-managing instructors don't clobber each other. Out-of-scope attempts return `403`;
attempting to give a cohort an `oidc_group` returns `422`.

## Frontend (incl. issue #559)

The Manage → Programs entry (`ProgramManagementModal`) is role-aware:

- **Instructor** — a simplified *Manage Cohorts* dialog: cohort name + a required tenant
  picker listing only the tenants they belong to. **No OIDC fields anywhere.**
- **Admin** — *Manage Programs*: a parent picker with a "None (top-level program)" option and
  the `oidc_group` field tucked behind an **Advanced** disclosure (create) / gear (edit). Admins
  can still create top-level tenants.

`CohortMembersDialog` toggles students in/out of a cohort via the delta endpoints and applies
the `ApiUser` returned by each call to local state (response-driven), so any server-side
cascade is reflected accurately rather than re-derived on the client.

Rename only sends `oidc_group` in the PATCH body when an admin edits a tenant; for instructor
cohort renames the field is omitted so the request doesn't trip the cohort OIDC invariant.

## Typical flow

1. An admin (or OIDC) seeds instructors and students into a **tenant** (e.g. *MedLab Science*).
2. Any instructor in that tenant creates a **cohort** under it and assigns their students.
3. The instructor tags a new assessment **category** with the cohort.
4. Only that cohort's students see the category — enforced by the existing student visibility
   filter. Instructors restrict/unrestrict access over time by adding/removing cohort members.

## Future: IdP-provisioned cohorts

The `parent_program_id` link is exactly the key an automated class→program association would
hang off later. If IT provisions class groups in Entra ID, a class becomes an OIDC-linked
cohort (`oidc_group` set, `parent_program_id` → its tenant) and membership flows automatically
through the existing OIDC sync. Instructor-created cohorts keep `oidc_group = NULL`, which the
sync preserves. No change to the authority rules above is required.
