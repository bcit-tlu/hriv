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
- Category card covers are the one sanctioned exception: `card_thumb` is
  resolved server-side (`resolve_card_image` in `routers/categories.py`)
  regardless of `active`/hidden/program/group gates and carries a
  thumbnail-only tile token (`purpose="thumb"` in `tile_tokens.py`); the raw
  `card_image_id` is scrubbed from student `metadata_extra`. Do not route it
  back through the filtered tree or issue it a full `tile` token (#1609).

## Validation

Use the test matrix, then usually run targeted backend and frontend tests around:

- `backend/tests/test_visibility.py`
- `backend/tests/test_categories.py`
- `backend/tests/test_router_groups.py`
- `backend/tests/test_router_images.py`
- `backend/tests/test_router_users.py`
- `frontend/tests/**/*categoryUtils*`
- relevant dialog/component tests for restriction chips or category editing

## Local password management

Read `../../../docs/password-management.md` and the detailed
`../../../docs/password-setup.md` before changing guest credentials. User state
includes nullable `password_hash`, `oidc_subject`, `invite_nonce`, and non-null
`must_change_password` (migration `0038_user_auth_state`). API flags are
`has_local_password`, `oidc_linked`, and `must_change_password`; never expose the
hash, nonce, or raw subject. Invite mint/redemption and self-service password
changes require `oidc_subject IS NULL` even when a linked account retains a hash.

Admin mint, public credential-scoped redemption, and authenticated self-change
are in `references/access-control-map.md`. `get_current_user` blocks flagged
users with 403 `password_change_required`; `require_role` inherits that guard.
Only `/auth/me` and change-password use `get_user_from_token` for recovery.
Explicit password null clears the nonce and forced flag; simultaneous explicit
true is 422. OIDC linking clears the flag. Existing tile/thumbnail tokens retain
the bounded expiry exception described in the feature docs.

Run `test_password_setup.py`, `test_change_password.py`, `test_router_users.py`,
`test_router_auth.py`, and relevant People/password frontend tests. Use the
testing-hriv skill’s local password-management reference for a live curl flow;
do not claim mocked UI tests validate an IdP login or a deployed environment.

OIDC-linked accounts are SSO-only: first email-linking clears the hash, invite
nonce and forced-change flag. Migration `0040_oidc_clear_password` cleans existing
linked accounts (irreversible data cleanup; downgrade is a no-op). Password login
rejects linked users with generic 401 and reason `oidc_linked`, still charging the
normal rate limit. Admin non-null password updates return 422 `oidc_linked`;
database imports discard linked-user hashes. Credential-changing paths lock and
refresh the user row so concurrent setup/change cannot restore a hash after linking.
Test `test_router_oidc.py`, `test_migration_oidc_credentials.py`, and
`test_admin_ops.py` alongside the password/auth/user suites for this invariant.
