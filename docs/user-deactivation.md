# User deactivation

This feature lets administrators disable account access without deleting user
records.

## Scope

- Applies to **user authentication**, not image/category visibility.
- Applies to both local password login and OIDC login.
- Applies immediately to existing bearer-token sessions once the next protected
  request resolves the user record.

## Authorization rules

- Only `admin` users can update another user's activation status.
- Self-deactivation is blocked to avoid locking out the acting administrator.

## Backend API

### User shape

`UserOut` includes:

- `active: boolean`

### Single-user update

- `PATCH /api/users/{id}`
- Body may include `active: true|false`
- If `active` is explicitly `null`, the API returns `422`.
- If an admin attempts to deactivate themself, the API returns `400`.

### Bulk status update

- `PATCH /api/users/bulk/active`
- Body:

```json
{
  "user_ids": [1, 2, 3],
  "active": false
}
```

- If any requested user ID does not exist, the API returns `404`.
- If an admin attempts to deactivate themself via bulk update, the API returns
  `400`.

## Authentication behavior

### Local login

`POST /api/auth/login` rejects inactive accounts with `403` and
`"Account is inactive"`. The login screen maps the `403` to a user-facing
message: "Account has been disabled. Please contact the TLU Learning Tech
Lab via Teams to activate your account."

### OIDC callback

If the resolved existing user is inactive, `GET /api/auth/oidc/callback`
redirects to the frontend with:

- `#oidc_error=account_inactive`

The login screen maps this code to the same disabled-account message shown
for local login.

### Token-authenticated access

Token validation checks both existence and `active == true`. A deactivated user
with a previously issued token is rejected on protected endpoints.

### Admin download credentials

`GET /api/admin/tasks/{id}/download` authenticates via a short-lived JWT
carried in a path-scoped `HttpOnly` cookie (minted by
`POST /api/admin/tasks/{id}/download-token`, cleared on successful download)
and re-checks that the token subject is still an active admin account before
serving the file.

### Forced password changes

Unlike deactivation (which also prevents login), `must_change_password` allows
login but blocks protected use with 403 `password_change_required`. `/auth/me`
and `/auth/change-password` remain available to active users; changing the local
password clears the flag. Download cookies and synthetic-result bearer ingestion
also check the flag. See [password management](password-setup.md) and the
[user model](domain-model.md#user) for details.

### Existing tile/thumbnail credentials

Already-issued image-scoped tile/thumbnail tokens remain valid until expiry
after deactivation or a forced-password-change flag. They have no user subject
and validate without a database lookup. The default remaining window is at most
15 minutes (`TILE_TOKEN_TTL_MINUTES`, configurable 1–1440). Both the FastAPI tile
fallback and nginx `tiles-auth` validator preserve this bounded exception; new
credentials cannot be minted by blocked users. Previously cached/downloaded
bytes cannot be revoked.

## Backup export/import behavior

Database export includes `users[].active` and import restores it so deactivated
accounts remain deactivated after restore.

## Frontend behavior (People page)

- People table shows user status (`Active` / `Inactive`).
- Add/Edit Person modal includes an account status toggle.
- Bulk action supports status changes for selected users.
- Bulk status dialog is single-flight: while saving, controls and close actions
  are disabled and the Save button shows progress.
