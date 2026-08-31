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
`"Account is inactive"`.

### OIDC callback

If the resolved existing user is inactive, `GET /api/auth/oidc/callback`
redirects to the frontend with:

- `#oidc_error=account_inactive`

### Token-authenticated access

Token validation checks both existence and `active == true`. A deactivated user
with a previously issued token is rejected on protected endpoints.

### Admin download tokens

`GET /api/admin/tasks/{id}/download` re-checks that the token subject is still
an active admin account before serving the file.

## Backup export/import behavior

Database export includes `users[].active` and import restores it so deactivated
accounts remain deactivated after restore.

## Frontend behavior (People page)

- People table shows user status (`Active` / `Inactive`).
- Add/Edit Person modal includes an account status toggle.
- Bulk action supports status changes for selected users.
- Bulk status dialog is single-flight: while saving, controls and close actions
  are disabled and the Save button shows progress.
