# OIDC / Vault IdP Configuration

BCIT uses HashiCorp Vault as an **OIDC provider middleware** that proxies
authentication through to Azure AD (Entra ID):

```text
OIDC Client (HRIV) → Vault OIDC Provider → Azure AD (Entra ID)
```

`docs/OIDC_SETUP.md` is the canonical product doc; this file captures the
agent-relevant config, gotchas, and code locations.

## Vault OIDC Configuration

- **Issuer URL**:
  `https://vault.ltc.bcit.ca:8200/v1/identity/oidc/provider/vault-provider`
  (must include port `8200` and the full
  `/v1/identity/oidc/provider/<name>` path). The HRIV backend appends
  `/.well-known/openid-configuration` automatically
  (`server_metadata_url=f"{_settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration"`
  in `backend/app/routers/oidc.py`), so `OIDC_ISSUER` must be the full provider
  path — **not** the bare `https://vault.ltc.bcit.ca`.
- **Discovery URL**: `{OIDC_ISSUER}/.well-known/openid-configuration`.
- **Vault OIDC client path**: `identity/oidc/client/hriv`.
- **Vault OIDC provider path**: `identity/oidc/provider/vault-provider`.
- **Azure AD auth method**: Vault uses `vault_jwt_auth_backend` (type `oidc`)
  with Azure AD's `https://login.microsoftonline.com/{tenant}/v2.0` discovery
  URL.
- **User claim**: `oid` (Azure AD object ID), **not** `sub`.

## Split Auth Strategy (stable vs latest)

- **Stable** (`hriv.ltc.bcit.ca`): direct Entra ID auth. Issuer =
  `https://login.microsoftonline.com/{tenant}/v2.0`. App ID =
  `a405c53e-3293-42f9-8d24-737a0613fed9`. Role mapping uses Entra group GUIDs.
- **Latest** (`hriv.latest.ltc.bcit.ca`): Vault OIDC proxy. Issuer = the Vault
  provider path above. Client ID from `vault read identity/oidc/client/hriv`.
  Role mapping uses Vault identity group names (`tlu_lab_admin`, `tlu_lab`).

## CRITICAL: OIDC Assignment Naming

Vault's OIDC provider has a hardcoded fast-path in `entityHasAssignment()`
(`identity_store_oidc_provider.go`): if the client's assignment name is exactly
`allow_all` (underscore), it bypasses all entity/group checks. The `"*"`
wildcards in `entity_ids`/`group_ids` are **not** treated as wildcards during ID
matching — they only work via this name-based bypass. Using `allow-all`
(hyphen) or any other name causes literal `"*"` vs UUID comparison, which always
fails with `access_denied: identity entity not authorized by client
assignment`. Use Vault's built-in `allow_all` assignment directly (created on
startup) rather than managing a custom one via Terraform.

## Redirect URI Registration (two levels required)

1. `vault_identity_oidc_client` → `redirect_uris`
2. `vault_jwt_auth_backend_role` → `allowed_redirect_uris`

Both must include the HRIV callback URL; missing either causes "Redirect URI
mismatch".

## Common Errors And Causes

- `AADSTS700016: Application not found` = wrong `client-id` in the Vault KV
  secret (for stable, must be the Entra app ID).
- `Invalid client ID` on latest = stale OIDC client ID; get a fresh one from
  `vault read identity/oidc/client/hriv`.
- `identity entity not authorized by client assignment` = assignment name does
  not match Vault's built-in `allow_all` constant (see above).
- `email` requires an explicit scope template; `sub` (entity ID) is automatic.
- `invalid_client` at token exchange = wrong client secret (not SSL/network).
- `invalid_scope` at authorize = a scope in `OIDC_SCOPES` is not in the Vault
  provider's `scopes_supported`.
- `Redirect URI mismatch` = update both client AND provider redirect URI lists.
- Vault does NOT emit `email_verified`, so `OIDC_TRUST_EMAIL=true` is required
  in HRIV. Vault has no dedicated userinfo endpoint; all claims come from the ID
  token.
- "Resultant ACL check failed" banner in the Vault UI is benign (the UI calls
  `sys/resultant-acl`, which the default policy does not grant).

## OIDC Code Locations In HRIV

- Backend OIDC router: `backend/app/routers/oidc.py` (Authlib registration,
  `/login`, `/callback`).
- Startup metadata/connectivity check: `backend/app/main.py`
  (`_check_oidc_connectivity`).
- Auth utilities: `backend/app/auth.py`.
- OIDC settings: `backend/app/database.py` (`Settings` class, `oidc_*` fields;
  `oidc_scopes` defaults to `"openid email profile"`).
- Frontend token handling: `frontend/src/AuthContext.tsx` (reads `#oidc_token=`
  URL fragment). Login UI: `frontend/src/components/LoginScreen.tsx` ("Sign in
  with BCIT" button).
- Tests: `backend/tests/test_router_oidc.py`, `backend/tests/test_main.py`.
- Docs: `../../../../docs/OIDC_SETUP.md`.
- Example env: `backend/.env.vault-example` (canonical `.env` to copy to
  `backend/.env`).
- Helm: `charts/backend/templates/configmap-openid-connect.yaml`,
  `charts/backend/templates/secret-openid-connect.yaml`.
