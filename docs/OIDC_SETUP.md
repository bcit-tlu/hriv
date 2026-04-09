# OIDC / OAuth 2.0 — Identity Provider Setup

HRIV supports OpenID Connect (OIDC) single sign-on so that every user
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
| `OIDC_REDIRECT_URI` | Yes | — | The callback URL registered with the IdP, e.g. `https://hriv.bcit.ca/api/auth/oidc/callback`. |
| `OIDC_SCOPES` | No | `openid email profile` | Space-separated list of scopes to request. |
| `OIDC_ROLE_MAPPING` | No | `{}` | JSON object mapping IdP group names to HRIV roles. See [Role Mapping](#role-mapping). |
| `OIDC_POST_LOGIN_REDIRECT` | No | — | Frontend URL to redirect to after OIDC login (e.g. `https://hriv.bcit.ca`). Falls back to the first non-wildcard `CORS_ORIGINS` entry. |
| `OIDC_TRUST_EMAIL` | No | `false` | Set to `true` to skip the `email_verified` check when linking existing accounts by email. **Only enable this with trusted corporate IdPs** (e.g. Vault, internal LDAP) where all emails are known to be valid. Do not enable with public/self-registration IdPs. |

All variables should be provided via Kubernetes Secrets or a `.env` file
in development.

---

## IdP Registration Checklist

1. **Register an OAuth 2.0 / OIDC application** in your IdP (Azure AD,
   Keycloak, Okta, etc.).
2. Set the **redirect / callback URI** to:
   ```
   https://<your-hriv-domain>/api/auth/oidc/callback
   ```
3. Request the following **scopes**: `openid`, `email`, `profile`.
   If your IdP supports a `groups` claim, also request the scope that
   exposes it (e.g. `GroupMember.Read.All` in Azure AD, or a custom
   scope in Keycloak).
4. Note the **Client ID**, **Client Secret**, and **Issuer URL** and
   set them in the environment as shown above.

---

## Role Mapping

HRIV maps IdP group memberships to its three roles: `admin`,
`instructor`, and `student`.  Users whose groups do not match any entry
default to `student`.

Configure `OIDC_ROLE_MAPPING` as a JSON object where keys are IdP group
names and values are HRIV roles:

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
> `instructor` through the HRIV admin UI and those promotions will be
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
   `oidc_subject`), and issues a HRIV JWT.
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

---

## HashiCorp Vault as OIDC Provider

BCIT uses HashiCorp Vault's [OIDC identity
provider](https://developer.hashicorp.com/vault/docs/secrets/identity/oidc-provider)
for SSO.  This section documents the Vault-specific configuration
required for local testing.

### Vault OIDC provider details

| Field | Value |
|---|---|
| Issuer | `https://vault.ltc.bcit.ca:8200/v1/identity/oidc/provider/vault-provider` |
| Discovery URL | `https://vault.ltc.bcit.ca:8200/v1/identity/oidc/provider/vault-provider/.well-known/openid-configuration` |
| Authorization endpoint | `https://vault.ltc.bcit.ca:8200/v1/identity/oidc/provider/vault-provider/authorize` |
| Token endpoint | `https://vault.ltc.bcit.ca:8200/v1/identity/oidc/provider/vault-provider/token` |
| JWKS URI | `https://vault.ltc.bcit.ca:8200/v1/identity/oidc/provider/vault-provider/.well-known/keys` |
| Client ID (HRIV) | `hkPdYUJqqEYWxiVwIrgrAjiS8fLja2ip` |

> **Important:** `OIDC_ISSUER` must be the **full provider path**
> including port 8200 and `/v1/identity/oidc/provider/vault-provider`.
> The backend appends `/.well-known/openid-configuration` automatically.
> Using a short URL like `https://vault.ltc.bcit.ca` will fail because
> the discovery document will not be found at that path.

### Quick start (local Docker)

```bash
# 1. Copy the Vault-specific example env
cp backend/.env.vault-example backend/.env

# 2. Edit backend/.env — replace the OIDC_CLIENT_SECRET placeholder
#    with the real secret from Vault (ask your Vault admin, or retrieve
#    it from Terraform output / Vault UI).
$EDITOR backend/.env

# 3. Start the stack
docker compose up --build

# 4. Open the app
open http://localhost:5173
```

Click **"Sign in with BCIT"** on the login page.  The browser will
redirect to the Vault authorization endpoint.  After authenticating,
Vault redirects back to
`http://localhost:8000/api/auth/oidc/callback`, which exchanges the
code for tokens, upserts your user, and redirects to the frontend with
a JWT fragment.

### Retrieving the client secret from Vault

The client secret is set when the OIDC client is created in Vault.  If
you manage Vault via Terraform, the secret is in the Terraform state or
output:

```bash
# If using Terraform
terraform output -raw hriv_oidc_client_secret

# If using Vault CLI
vault read identity/oidc/client/hriv
```

If you do not have access to either, ask your Vault administrator for
the client secret associated with client ID
`hkPdYUJqqEYWxiVwIrgrAjiS8fLja2ip`.

### Vault-specific notes

- **No `email_verified` claim:** Vault's OIDC provider does not emit
  `email_verified` in the ID token.  Set `OIDC_TRUST_EMAIL=true` so
  that first-time OIDC users can be linked to existing accounts by
  email.  This is safe because Vault is a trusted corporate IdP where
  all email addresses are administrator-managed.

- **No dedicated userinfo endpoint:** Vault returns all claims in the
  ID token itself.  The backend handles this correctly — it reads
  `userinfo` from the parsed ID token first, and only falls back to the
  userinfo endpoint if that is missing.

- **Groups claim:** To enable role mapping, the Vault OIDC scope /
  template must include a `groups` claim.  If it is not present, all
  new users default to `student` and existing users keep their current
  role.

### Verifying the OIDC flow step by step

You can test each stage of the OIDC flow independently:

```bash
# 1. Check that OIDC is enabled
curl -s http://localhost:8000/api/auth/oidc/enabled | python3 -m json.tool
# Expected: {"enabled": true}

# 2. Verify Vault discovery is reachable from the backend container
docker compose exec backend python3 -c "
import urllib.request, json
url = 'https://vault.ltc.bcit.ca:8200/v1/identity/oidc/provider/vault-provider/.well-known/openid-configuration'
data = json.loads(urllib.request.urlopen(url).read())
print(json.dumps(data, indent=2))
"

# 3. Initiate the login flow (browser redirect — open in browser)
#    This will redirect to Vault's authorize endpoint.
open "http://localhost:8000/api/auth/oidc/login"

# 4. After successful login, the frontend URL will briefly contain:
#    http://localhost:5173/#oidc_token=eyJhbG...
#    The token is extracted automatically by the frontend and stored.

# 5. Validate the resulting JWT
TOKEN="<paste the oidc_token value here>"
curl -s http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 404 on `/api/auth/oidc/login` | `OIDC_ENABLED` is not `true` | Check `backend/.env` is mounted and has `OIDC_ENABLED=true` |
| `OIDC client not configured` (500) | Authlib could not register the client at startup | Check backend logs for discovery URL errors; verify `OIDC_ISSUER` is the full Vault path |
| `OIDC authentication failed` (401) | Token exchange failed | Verify `OIDC_CLIENT_SECRET` is correct; check that `OIDC_REDIRECT_URI` matches what is registered in Vault |
| Redirect loop or blank page | Frontend redirect misconfigured | Verify `OIDC_POST_LOGIN_REDIRECT=http://localhost:5173` and `CORS_ORIGINS` includes it |
| `IdP did not return required claims` (401) | ID token missing `sub` or `email` | Check Vault OIDC scope template includes `email` and `sub` claims |
| `email_verified` linking skipped | `OIDC_TRUST_EMAIL` not set | Set `OIDC_TRUST_EMAIL=true` for Vault |
