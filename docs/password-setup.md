# Local guest password setup

Admins can provision local guests without an initial password, mint a personally
delivered setup credential, and let the guest set a password and sign in. No SMTP,
public forgot-password flow, or OIDC credential management is provided here.
The frontend setup page and admin copy-link UI are separate follow-up work.

## API contract

`POST /api/users/{id}/password-setup-link` requires an authenticated admin. It
returns `{ "setup_token": "<jwt>", "expires_at": "<ISO-8601 UTC>" }`, not a URL.
The target must be active, passwordless, and not OIDC-linked. Missing accounts
return 404; inactive accounts return 403 `account_inactive`; OIDC-linked accounts
return 422 `oidc_linked`; passworded accounts return 409 `password_already_set`.
Each mint replaces `users.invite_nonce` with `secrets.token_urlsafe(16)`, so a new
link invalidates every previous link. Minting never clears an existing password.
An admin can first clear a local password with `PATCH /api/users/{id}` using
`{ "password": null }`, which also clears the nonce and forced-change flag.

`POST /api/auth/password-setup` is public (no bearer JWT required) and accepts
`{ "token": "<jwt>", "password": "<new password>" }`. Passwords require at least
eight characters and at most 72 UTF-8 bytes (the bcrypt limit); invalid request
bodies return 422. The successful response is the standard `LoginResponse`:
`{ "access_token": "<access jwt>", "token_type": "bearer", "user": { ... } }`.
Redemption sets the password hash and `last_access`, clears `invite_nonce` and
`must_change_password`, and immediately signs in the guest. User responses never
expose hashes, nonces, or raw OIDC subjects.

Redemption errors:

| Status | Meaning                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| 401    | Invalid, expired, wrong-purpose, missing-user, or nonce-mismatched token; also a user linked to OIDC after mint |
| 403    | `account_inactive`                                                                                              |
| 409    | `password_already_set` (including replay after a successful setup)                                              |
| 429    | `rate_limited`, with `Retry-After` seconds                                                                      |

Mint and redeem lock the user row until commit, serializing nonce rotations and
redemptions. Concurrent redeems cannot both change the password. Password clearing
also revokes any outstanding setup credential. Revocation of existing access
tokens is outside this feature's scope.

## Token configuration and enforcement

`app/password_tokens.py` issues JWTs signed by `JWT_SECRET` with the configured
algorithm and claims `purpose="password_setup"`, `sub=str(user.id)`, `nonce`, and
`exp`. Validation requires all four claims. These credentials cannot authorize
ordinary bearer-protected endpoints. Nonces are compared in constant time.

`PASSWORD_SETUP_TOKEN_TTL_MINUTES` defaults to `10080` (seven days), with bounds
60–43200 (one hour through 30 days). Helm exposes it as
`auth.passwordSetupTokenTtlMinutes`. A stable shared JWT secret is required across
replicas; changing the secret invalidates setup credentials too.

Separate Redis buckets apply the existing login budgets: before signature work,
per-client-IP `rate:pwsetup:{ip}` uses `RATE_LIMIT_LOGIN_MAX/WINDOW`. Only after
signature, expiry, and claims validation, a hashed verified-subject bucket uses
`RATE_LIMIT_LOGIN_EMAIL_MAX/WINDOW`. Invalid tokens consume only the IP budget,
so forged subjects cannot exhaust another guest's subject budget.
Subject budgets survive IP changes and nonce rotations. Redis failure is
fail-open, following the login limiter; no public endpoint mints links.

Structured `auth.invite_minted` and `auth.password_setup` events use canonical
`auth.*` fields. Mint events additionally include `admin_id`; setup events report
success/failure without logging tokens, passwords, or nonces.

## Regression coverage

`backend/tests/test_password_setup.py` covers claims/expiry/settings, bearer
rejection, role gates, rotation, success/replay, account/nonce/error guards,
password validation, structured events, and both rate-limit budgets. Full backend
verification: `cd backend && poetry run pytest` (80% coverage gate).

## Authenticated password change

`POST /api/auth/change-password` requires a valid bearer JWT and accepts
`{ "current_password": "<old>", "new_password": "<new>" }`. Any local user role
can use it, including a user flagged `must_change_password`. Success is **204 No
Content**: the hash is replaced and `must_change_password` is cleared in the same
transaction. Existing bearer JWTs remain valid; a replacement JWT is not needed.

OIDC-linked accounts receive 403 `oidc_linked`. Missing, empty, wrong, or overlong
current passwords, and passwordless local accounts, receive 401. A new password
must have at least eight characters and at most 72 UTF-8 bytes (bcrypt's limit),
otherwise validation returns 422. A missing bearer JWT also returns 401.

The per-user Redis bucket `rate:pwchange:{user.id}` runs **before password
verification**, using `RATE_LIMIT_LOGIN_MAX` and `RATE_LIMIT_LOGIN_WINDOW` (default
5 attempts per 60 seconds). Exhaustion returns 429 `rate_limited` with
`Retry-After` seconds. Redis failure remains fail-open, matching login. Structured
`auth.password_change` events record success/failure with canonical `auth.*`
fields, never either password. Concurrent changes serialize on the user row.

## Forced password changes and auth-path audit

Admins can set `must_change_password: true` on a local, passworded account. Login
still succeeds and returns that flag. On subsequent bearer requests,
`get_current_user` returns 403 `password_change_required`; all `require_role`
dependencies inherit the block, including admins. Image/category serialization
is blocked too, preventing new tile/thumbnail credentials from being minted.
`GET /api/auth/me` and change-password deliberately use `get_user_from_token`
directly, so the guest can recover their session and clear the flag. Logout is
client-side token removal; there is no backend logout endpoint.

The admin download-cookie path rechecks the persisted user and forced-change
flag before serving a file. Synthetic-result **bearer** ingestion also enforces
the flag, even for synthetic accounts; admins must not flag monitor accounts.
The operator-provisioned synthetic ingest token is an independent service
credential, not user authentication, and retains its existing behavior.

OIDC callback establishes IdP identity independently. Linking an existing local
account clears the flag; OIDC-linked accounts cannot be flagged through the API.
Password setup cannot bypass forced change for a passworded account (409).
Request middleware decodes JWT identity only for logging, not authorization.
Public health/configuration and operator-authenticated routes remain independent
of this user-authentication gate.

### Existing tile/thumbnail credentials

Already-issued image-scoped tile/thumbnail tokens remain valid until expiry
after deactivation or a forced-password-change flag. They have no user subject
and validate without a database lookup. The default remaining window is at most
15 minutes (`TILE_TOKEN_TTL_MINUTES`, configurable 1–1440). Both the FastAPI tile
fallback and nginx `tiles-auth` validator preserve this bounded exception; new
credentials cannot be minted by blocked users. Previously cached/downloaded
bytes cannot be revoked. See [user deactivation](user-deactivation.md).

`tests/test_change_password.py`, `tests/test_router_admin.py`, and
`tests/test_telemetry.py` cover these user-authentication boundaries, successful
recovery, current/new-password validation, rate-limit ordering, and audit events.
