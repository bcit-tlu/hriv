---
name: hriv-access-control
description: Work on HRIV roles, permissions, OIDC group mapping, users, programs, groups, category visibility, student access filtering, frontend restriction chips, and backend authorization. Use when changing auth.py, authz.py, visibility.py, routers/categories.py, routers/images.py, routers/groups.py, routers/users.py, OIDC config, categoryUtils.ts, groupUtils.ts, or docs about roles, groups, programs, and visibility.
---

# HRIV Access Control

Use this skill for role, user, program, group, OIDC, and category visibility
changes.

## Required Reading

1. Read `references/access-control-map.md`.
2. Read `../../../docs/category-visibility-and-programs.md` for the dual-gate
   visibility contract.
3. Read `../../../docs/groups.md` for group ownership, membership, API, and UI
   rules.
4. Read `../../../docs/OIDC_SETUP.md` when changing OIDC, group mapping, or
   role provisioning.

## Critical Invariants

- Student visibility is backend-enforced in `visibility.py`,
  `routers/categories.py`, and `routers/images.py`; frontend filtering is only
  presentation.
- Student visibility is a dual gate: programs AND groups must pass, with hidden
  subtree and ancestor cascade rules.
- Always pass `user_group_ids` into visibility helpers for student-scoped
  callers.
- Programs and groups are independent. Group membership never implies program
  membership.
- Category edit authority is global for admins/instructors; attach authority is
  scoped to the instructor's programs and managed groups.
- Group members must be students, group instructors must be instructors, the
  last instructor cannot be removed, and attached groups cannot be deleted.
- Frontend category narrowing uses intersection semantics; children must never
  widen ancestor restrictions.

## Validation

Use the test matrix, then usually run targeted backend and frontend tests around:

- `backend/tests/test_visibility.py`
- `backend/tests/test_categories.py`
- `backend/tests/test_router_groups.py`
- `backend/tests/test_router_images.py`
- `backend/tests/test_router_users.py`
- `frontend/tests/**/*categoryUtils*`
- relevant dialog/component tests for restriction chips or category editing
