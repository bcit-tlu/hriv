# OIDC / OAuth 2.0 — Identity Provider Setup

CORGI supports OpenID Connect (OIDC) single sign-on so that every user
authenticates through an external Identity Provider (IdP) instead of
local email/password credentials.  Local login is kept as a fallback for
admin bootstrap accounts.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OIDC_ENABLED` | No | `false` | Set to `true` to activate OIDC login. |
| `OIDC_ISSUER` | Yes (when enabled) | — | The IdP issuer URL, e.g. `https://login.microsoftonline.com/{tenant}/v2.0`. Must expose `/.well-known/openid-configuration`. |
| `OIDC_CLIENT_ID` | Yes | — | OAuth 2.0 client / application ID registered with the IdP. |
| `OIDC_CLIENT_SECRET` | Yes | — | OAuth 2.0 client secret. |
| `OIDC_REDIRECT_URI` | Yes | — | The callback URL registered with the IdP, e.g. `https://corgi.bcit.ca/api/auth/oidc/callback`. |
| `OIDC_SCOPES` | No | `openid email profile` | Space-separated list of scopes to request. |
| `OIDC_ROLE_MAPPING` | No | `{}` | JSON object mapping IdP group names to CORGI roles. See [Role Mapping](#role-mapping). |
| `OIDC_POST_LOGIN_REDIRECT` | No | — | Frontend URL to redirect to after OIDC login (e.g. `https://corgi.bcit.ca`). Falls back to the first non-wildcard `CORS_ORIGINS` entry. |

All variables should be provided via Kubernetes Secrets or a `.env` file
in development.

---

## IdP Registration Checklist

1. **Register an OAuth 2.0 / OIDC application** in your IdP (Azure AD,
   Keycloak, Okta, etc.).
2. Set the **redirect / callback URI** to:
   ```
   https://<your-corgi-domain>/api/auth/oidc/callback
   ```
3. Request the following **scopes**: `openid`, `email`, `profile`.
   If your IdP supports a `groups` claim, also request the scope that
   exposes it (e.g. `GroupMember.Read.All` in Azure AD, or a custom
   scope in Keycloak).
4. Note the **Client ID**, **Client Secret**, and **Issuer URL** and
   set them in the environment as shown above.

---

## Role Mapping

CORGI maps IdP group memberships to its three roles: `admin`,
`instructor`, and `student`.  Users whose groups do not match any entry
default to `student`.

Configure `OIDC_ROLE_MAPPING` as a JSON object where keys are IdP group
names and values are CORGI roles:

```json
{
  "bcit-tlu-admins": "admin",
  "bcit-tlu-instructors": "instructor",
  "bcit-tlu-students": "student"
}
```

The first matching group wins, so order does not matter as long as each
group maps to exactly one role.

> **Tip:** If the IdP does not emit a `groups` claim in the ID token,
> existing users keep their current role and new users default to
> `student`.  You can promote individual users to `admin` or
> `instructor` through the CORGI admin UI and those promotions will be
> preserved across OIDC logins as long as the IdP does not supply
> groups.

---

## How It Works

1. User clicks **"Sign in with BCIT"** on the login page.
2. The browser navigates to `GET /api/auth/oidc/login`, which redirects
   to the IdP authorization endpoint.
3. After the user authenticates, the IdP redirects back to
   `GET /api/auth/oidc/callback` with an authorization code.
4. The backend exchanges the code for tokens, extracts user info (sub,
   email, name, groups), upserts the user in the database (linking by
   `oidc_subject`), and issues a CORGI JWT.
5. The backend redirects to the frontend with the JWT in a URL
   fragment (`#oidc_token=...`) so the token is never sent to the
   server or recorded in access logs.  The frontend stores the token
   and cleans the URL.

---

## Database Changes

Phase 3 adds a nullable `oidc_subject` column to the `users` table.
This stores the IdP's unique subject identifier (`sub` claim) for each
user.  Existing local-only accounts have this column set to `NULL`.

When an OIDC user logs in for the first time and their email matches an
existing local account, the accounts are linked automatically by
populating `oidc_subject`.

### Migrating an existing database

The `db/init.sql` change only runs on **fresh** database creation.  If
you are upgrading an existing deployment, run the following migration
manually (or via a Kubernetes Job):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_subject VARCHAR(255) UNIQUE;
```

---

## Local Development

To test OIDC locally, set `OIDC_ENABLED=true` and point to a local
Keycloak instance or similar IdP.  Make sure `OIDC_REDIRECT_URI` points
to `http://localhost:8000/api/auth/oidc/callback` (or wherever the
backend is running).

The local email/password login form is always available below the OIDC
button, so admin bootstrap accounts continue to work regardless of OIDC
configuration.
