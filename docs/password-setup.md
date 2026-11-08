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
also revokes any outstanding setup credential. Existing access tokens and the
authenticated password-change flow are outside this feature's scope.

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
