# Password management for local accounts

This is the feature overview and administrator runbook for epic #1757. Local
credentials support bootstrap and guest accounts; OIDC credentials remain with
the identity provider. There is no public forgot-password workflow, SMTP
delivery, or OIDC password reset. Administrators deliver setup links privately.

For request/response bodies, complete error contracts, rate limits, auth-path
exceptions, and frontend mechanics, see [password setup](password-setup.md).
This page complements that reference rather than replacing it.

## Credential-state model

| Database state                                   | API flag                     | Meaning                                                                 |
| ------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------- |
| `password_hash IS NOT NULL`                      | `has_local_password: true`   | A local password exists; the hash is never returned.                    |
| `oidc_subject IS NOT NULL`                       | `oidc_linked: true`          | Identity-provider linked, even if a previous local hash remains.        |
| `must_change_password = true`                    | `must_change_password: true` | Local password rotation is required before normal protected API access. |
| `password_hash IS NULL AND oidc_subject IS NULL` | Both credential flags false  | Passwordless local account; People labels it **Invite pending**.        |

`invite_nonce` is a nullable server-side value, not an API field. Minting rotates
it; successful redemption and explicit password clearing remove it. **Invite
pending** describes the credential state, not proof that a usable link exists.
Inactive accounts cannot mint or redeem links. Invite mint/redemption and
self-service change require `oidc_subject IS NULL`, not merely a local hash.

`must_change_password` requires a local password and no OIDC link; invalid
create/update combinations return 422. Explicit `password: null` automatically
clears the flag unless that same request explicitly asks for true (422).
OIDC linking also clears it. See the [domain model](domain-model.md) and
[OIDC setup](OIDC_SETUP.md).

Login and `/api/auth/me` provide authoritative flags. Instructor directory
projections omit them. The frontend does not cache `has_local_password` or
`must_change_password` in localStorage and validates `/auth/me` before opening
the shell after reload.

## Administrator runbook

### Invite a guest

1. In People, add the person using **Invite by link (user sets their own
   password)**. Keep the account active. Creation omits `password` entirely.
2. The existing account’s link dialog mints a purpose-scoped setup token,
   replacing its nonce. If minting fails, retry from that dialog or the row;
   do not create the account again.
3. Copy the `/#password_setup=<setup_token>` URL and deliver it privately. The
   dialog shows the expiry in local time. A link is a credential: never put it
   in tickets, application logs, shared screenshots, or persistent app storage.
4. In a fresh browser session the guest opens the link, chooses a password, and
   receives a login response directly. No second login is required. The fragment
   is stripped from the address bar, including on same-document navigation.

The token is single-use. Replay while a password remains set returns 409
`password_already_set`. Re-minting before redemption invalidates the older link
(401 on nonce mismatch). Closing a dialog discards its token; reopening mints a
replacement after any earlier same-user mint finishes. The dialog itself is the
only frontend owner of the credential.

### Clear a password and re-invite

Open another person’s local-password account, choose **Clear password**, and
confirm. This sends explicit `password: null`, clears the hash, invite nonce,
and forced-change flag, then offers a new setup link. Minting is optional and
requires an active account. Existing local passwords cannot be overwritten by
minting alone: mint returns 409 until the hash is cleared. The self-profile
editor and an administrator’s own People row hide clear/force controls to avoid
self-lockout; use **Change password** for self-service rotation.

### Force a password change

Enable **Force password change on next login** on another local-password
account. Passwordless and OIDC accounts have disabled controls with explanations.
The backend checks the DB flag on protected requests, so an already-signed-in
user is also affected: `/api/auth/me` still returns 200, while normal protected
endpoints return 403 `password_change_required`. Login/reload and the central
403 handler show the forced-change screen instead of the application shell.

The user submits their current password and a different new password. Successful
change returns 204, clears the flag, refreshes `/auth/me`, and reopens navigation.
Wrong/missing current passwords return 401; reusing the verified current password
returns 422 `password_unchanged`. Setup and change require at least eight
characters and at most 72 UTF-8 bytes. OIDC-linked change-password returns 403
`oidc_linked`; OIDC-linked mint returns 422 `oidc_linked` (not 403).

Do not interpret forced change as universal credential revocation. Previously
issued tile/thumbnail tokens remain valid until expiry, and cached/downloaded
bytes cannot be recalled. Public routes and the independent synthetic ingest
credential are not user sessions. See the bounded exceptions in
[password setup](password-setup.md#forced-password-changes-and-auth-path-audit) and
[user deactivation](user-deactivation.md).

## Rollout notes for stable

- Apply Alembic migration **`0038_user_auth_state`** before running the new
  backend: nullable `invite_nonce` plus non-null `must_change_password` with
  false default. Existing users keep their passwords and start unflagged; no
  seed guest or new bootstrap credentials were introduced.
- Set **`PASSWORD_SETUP_TOKEN_TTL_MINUTES`** as needed: default **10080**
  (7 days), bounded **60–43200** (1 hour–30 days). The chart already exposes
  `auth.passwordSetupTokenTtlMinutes`. The setting controls newly minted links;
  existing tokens retain their signed expiry. See [configuration](password-setup.md#token-configuration-and-enforcement).
- **`JWT_SECRET` rotation kills outstanding invites** as well as sessions signed
  with the old key. Keep the secret stable/shared across replicas; after a
  rotation, re-mint and privately redistribute unused invites. Local ephemeral
  secrets also make outstanding links fail after a backend restart.
- **No feature flag:** the backend routes and People/profile flows are enabled
  when the corresponding release is deployed. Deploy the migration/backend
  before the frontend; coordinate stable image/chart promotion through the
  existing release process, not a password-management toggle.
- Before stable promotion, repeat the [validation checklist](TESTING.md#password-management-local-validation-1763)
  against the intended environment and check a real OIDC login. Local curl
  validation cannot verify deployed ingress, clipboard delivery, the forced
  screen, or a live identity provider. Do not describe these as validated on
  `latest` when it is unreachable.
