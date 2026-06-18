# Category visibility & program restriction

Category (and image) visibility for **students** is governed by a small set of
rules that are enforced in the backend and *mirrored* — for UX only — in the
frontend. This page is the single reference for those rules. It covers the
**dual-gate** model: visibility is gated independently by **programs** (admin/
OIDC-managed) and **groups** (instructor-managed), combined with **AND**.

- Programs: see [README → Programs](../README.md#programs).
- Groups: see [Groups](groups.md) for the groups-specific model, authz, and API.

> **Security note.** Frontend filtering is presentation only. Student visibility
> **must** be enforced in the backend (`backend/app/visibility.py`,
> `routers/categories.py`, `routers/images.py`). Never rely on the client to
> hide restricted content.

## The dual gate

A student sees a category only when **both** gates pass:

```
visible  ⇔  (category has no programs  OR  category.programs ∩ user.programs ≠ ∅)
        AND (category has no groups    OR  category.groups   ∩ user.groups   ≠ ∅)
```

An empty restriction list on a dimension means **unrestricted** on that
dimension (visible to everyone) — *not* "no access". Each gate is evaluated the
same way; groups were added as a second, independent dimension alongside the
pre-existing program gate.

### Truth table

`P` = program gate result, `G` = group gate result. A gate "passes" if the
category is unrestricted on that dimension *or* the user overlaps it.

| Program gate | Group gate | Visible? |
|--------------|-----------|----------|
| pass | pass | ✅ yes |
| pass | fail | ❌ no |
| fail | pass | ❌ no |
| fail | fail | ❌ no |

Both gates must pass. This is implemented by `_passes_gates()` in
`visibility.py`.

### Hidden status & ancestor cascade

Two further rules apply on top of the dual gate, both enforced by
`compute_excluded_category_ids()` (used for the tree) and
`is_category_visible_to_student()` (used for single-item checks):

1. **Hidden subtree.** A category with `status == "hidden"` is excluded, and so
   is its **entire descendant subtree**.
2. **Restriction cascade.** If any **ancestor** is excluded (hidden, or failing
   either gate), all of its descendants are excluded too — regardless of the
   descendant's own restrictions. The group gate cascades **identically** to the
   program gate.

Admins and instructors **bypass** all student visibility filtering entirely
(guarded by `if user.role == "student"` in the routers); they always see every
category and image.

## Worked examples

Assume a student in program `P1` and group `G1`.

| Scenario | Parent | Child | Child visible? | Why |
|----------|--------|-------|----------------|-----|
| Unrestricted parent / restricted child | (none) | programs `{P1}` | ✅ | Child program gate passes; no group restriction. |
| Restricted parent / unrestricted child | programs `{P2}` | (none) | ❌ | Parent program gate fails → subtree cascades out. |
| Hidden parent | `status=hidden` | (any) | ❌ | Hidden subtree rule hides all descendants. |
| Dual restriction, member of both | programs `{P1}`, groups `{G1}` | (none) | ✅ | Both gates pass. |
| Dual restriction, group only | programs `{P2}`, groups `{G1}` | (none) | ❌ | Program gate fails even though group gate passes (AND). |
| Conflicting nested restrictions | programs `{P1}` | programs `{P2}` | ❌ | Ancestor passes, but the child's own program gate fails. |

The "dual restriction, group only" row is exactly the case the
[`program_group_intersection` warning](groups.md#intersection-warning) advises
about at edit time: group members who are in none of the selected programs lose
access because the gates are combined with AND.

## Frontend narrowing (editing) vs. backend enforcement (visibility)

These are two different concerns and use different code:

- **Backend enforcement** (`visibility.py`) decides what a *student* may see at
  request time, using the dual-gate + cascade rules above.
- **Frontend narrowing** (`frontend/src/categoryUtils.ts`) shapes what an
  *editor* can pick in the category dialogs. It uses **narrowing / intersection
  semantics**: a child can never *widen* a restriction beyond what its ancestors
  allow.
  - `narrowProgramIds(ancestors)` — walks the ordered (top-down) ancestor chain;
    the first ancestor with `programIds` initialises the effective set, and each
    subsequent ancestor with `programIds` intersects (narrows) it.
  - `narrowGroupIds(ancestors)` — the group analogue, with identical semantics
    on the independent group dimension.
  - `splitDirectAncestorProgramIds(fullPath)` — splits the effective set into
    "direct" IDs (present on the leaf category itself) and "ancestor" IDs
    (inherited from above but not on the leaf), so the dialog can show inherited
    restrictions distinctly from ones set on the category.

Used by `App.tsx`, `ManageCategoriesDialog`, `CategoryPickerSelect`, and
`ManagePage`.

## Tree loading & ETag caching

The category tree is loaded in **exactly two database queries** regardless of
depth (`backend/app/routers/categories.py`, `_load_tree()`):

1. Fetch **all** categories in one query.
2. Fetch **all** images in one query.

The tree is then assembled in memory by indexing images by `category_id` and
categories by `parent_id`. For students, excluded categories and inactive images
are filtered out during assembly (using `compute_excluded_category_ids`). When
modifying the category/image models, keep this flat-query assembly working.

The tree endpoint also supports **conditional requests**:

- A weak `ETag` is computed as the MD5 of the serialised response body.
- `Cache-Control: private, no-cache` is set (always revalidate, but avoid
  re-downloading unchanged data).
- If the client's `If-None-Match` matches (or is `*`), the endpoint returns
  **304 Not Modified** with no body.

## Where this lives

| Concern | Files |
|---------|-------|
| Dual-gate + cascade enforcement | `backend/app/visibility.py` |
| Student guards on tree/images | `backend/app/routers/categories.py`, `backend/app/routers/images.py` |
| Intersection warning | `backend/app/routers/categories.py` (`_intersection_warnings`) |
| Frontend narrowing | `frontend/src/categoryUtils.ts` |
| Frontend visibility cascade helpers | `frontend/src/treeUtils.ts` (`isCategoryHiddenInTree`) |
| Frontend visibility UI (3-state buttons, desaturation) | `frontend/src/App.tsx`, `EditCategoryDialog`, `EditImageModal`, `CategoryPickerSelect`, `ManageCategoriesDialog`, `ManagePage`, `SortableTileGrid` |
| Tree → camelCase mapping | `frontend/src/useBrowseData.ts` |
| Tests | `backend/tests/test_visibility.py`, `test_categories.py`, `test_router_groups.py`, `test_router_images.py`; `frontend/tests/.../categoryUtils.test.ts`, `useBrowseData.test.ts`, `EditImageModal.test.tsx`, `EditCategoryDialog.test.tsx` |

See also: [Groups](groups.md), [Domain model](domain-model.md),
[`docs/TESTING.md`](TESTING.md), and the
[agent feature map](agent-feature-map.md).
