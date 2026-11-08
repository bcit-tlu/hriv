# Local password-management validation

Read the [feature/runbook](../../../../docs/password-management.md) and
[API contract](../../../../docs/password-setup.md) first. Use local compose when
`latest` is unreachable; report that substitution, not a deployed-environment
pass. No passwordless guest was added to `db/seed.sql`: all documented seed
accounts keep password `password`. Create disposable guests instead.

## Start the local backend

From the worktree root:

```bash
docker compose -p hriv-password-validation up -d --build backend
docker compose -p hriv-password-validation ps -a
curl -fsS http://localhost:8000/api/health
```

Backend dependencies include Postgres, Redis, migration, seed, and seed-media.
Confirm the three one-shot jobs exited 0 before proceeding. Use a unique compose
project and confirm host ports 8000/5432/6379 are free; do not reuse another
project’s DB accidentally. Use the same `-p` on every subsequent compose command.

## Mint, open the fragment, redeem

1. Login as `admin@example.ca` / `password` using `POST /api/auth/login`. Keep
   `access_token` in memory as `ADMIN`; do not print it or store the response.
2. Generate a fresh identity for every run, including reruns on retained volumes:

   ```bash
   RUN_ID=$(python3 -c 'import uuid; print(uuid.uuid4().hex)')
   GUEST_EMAIL="password-validation-${RUN_ID}@example.test"
   GUEST_BODY=$(printf '{"name":"Disposable guest","email":"%s","role":"student","active":true}' "$GUEST_EMAIL")
   ```

   `POST /api/users/` with an admin bearer header and JSON body `$GUEST_BODY`
   (for curl, `--data "$GUEST_BODY"`). Keep the email for later guest logins.
   Expect 201, `has_local_password:false`, `oidc_linked:false`,
   `must_change_password:false`. Save its numeric `id` as `GUEST_ID`.
3. Mint with `POST /api/users/$GUEST_ID/password-setup-link`. Capture
   `setup_token` and `expires_at` in memory; they are not `token`/`url` response
   fields. Build `http://localhost:5173/#password_setup=<setup_token>` yourself.
4. For browser validation start the Compose frontend from the worktree root:
   `docker compose -p hriv-password-validation up -d --build frontend`.
   Vite’s `/api` proxy targets `http://backend:8000` in `frontend/vite.config.ts`
   with no environment override; a host-run `npm run dev` cannot resolve that
   Compose service name. Open the setup URL in a fresh private session, confirm the
   fragment disappears, enter matching passwords, and verify the signed-in shell.
   Also paste into an already-open tab to check same-document hash handling.
5. For API-only validation call `POST /api/auth/password-setup` with JSON
   `{"token":"<setup_token>","password":"<disposable password>"}` and no bearer
   header. Expect 200 `LoginResponse`; retain its access token as `GUEST` in
   memory. `/api/auth/me` must show a local password and no forced-change flag.

API-only redemption demonstrates session issuance, not browser navigation or
clipboard behavior. Never record an unredacted URL, password, nonce, or token.

## Required negative and recovery cases

| Action                                                                                   | Expected result                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Redeem the consumed link again while the account remains passworded                      | 409 `password_already_set`.                                        |
| Admin `PATCH /api/users/$GUEST_ID` with `{"password":null}`                              | 200, hash flag and forced flag false; old nonce removed.           |
| Mint B then C before redemption; redeem B                                                | 401 invalid/expired setup-token detail (nonce mismatch).           |
| Redeem C                                                                                 | 200 login response; the guest is re-invited successfully.          |
| Admin PATCH `{"must_change_password":true}` after a password exists                      | 200; `/auth/me` with `GUEST` remains 200 and reports true.         |
| `GET /api/categories/` with the flagged guest                                            | 403 `password_change_required`, not merely a role error.           |
| Change using an incorrect current password                                               | 401 `Invalid current password`; flag remains set.                  |
| Change using identical verified current/new passwords                                    | 422 `password_unchanged`; flag remains set.                        |
| `POST /api/auth/change-password` with correct current and a different valid new password | 204; `/auth/me` reports false and `/api/categories/` is 200 again. |

In the browser, verify forced login/reload offers no navigation, a protected
request from an already-signed-in flagged user enters the same gate, and a
successful change refreshes `/auth/me` before navigation reopens. Self-profile
and own-row editing must not show Clear password or force-change controls.

## OIDC fixture and reporting

In this isolated local database only, create a separate disposable passworded
account using email `password-validation-oidc-${RUN_ID}@example.test`, obtain its
login JWT, then set `users.oidc_subject` to a unique dummy
value with `docker compose -p hriv-password-validation exec -T db psql -U hriv -d hriv`.
For example, `UPDATE users SET oidc_subject='password-validation-oidc-<RUN_ID>' WHERE id=<fixture_id>;`
(substitute this run’s actual `RUN_ID` and numeric fixture ID).
Never change a real IdP identity or a deployed DB for this test.

Check `/auth/me` reports `oidc_linked:true`, admin mint returns **422
`oidc_linked`**, and its authenticated change-password returns **403
`oidc_linked`**. With the frontend, confirm the menu item is absent and People’s
credential actions disabled. A DB fixture does **not** validate an SSO roundtrip;
repeat a real provider login in the target environment before stable rollout.

Capture HTTP status and redacted JSON for each request in a transcript outside
the repo. Replace `access_token`, `setup_token`, input `token`, passwords and
nonces before writing output; do not save raw responses then redact afterward.
Keep rate-limit budgets in mind: do not clear Redis or disable throttling to
manufacture a pass. Stop this isolated project with `docker compose -p
hriv-password-validation down` when finished; retain volumes unless explicitly
asked to delete them.
