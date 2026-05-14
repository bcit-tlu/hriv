# FluxCD values migration prompt (for downstream overlays)

Use the following prompt in this workspace **after** importing the downstream FluxCD repo.

---

You are updating a downstream FluxCD repo after breaking values-schema changes in the upstream `hriv` charts.

## Objective

Update Flux overlays (`HelmRelease` values, patch files, Kustomize overlays, and any docs/runbooks) so deployments continue working with the latest chart values.

## Scope

- Search the entire imported Flux repo for old keys and legacy value paths.
- Update all impacted chart value overrides for:
  - `hriv-backend`
  - `hriv-backup`
  - `hriv-frontend`
- Keep environment-specific values intact (domains, storage classes, secrets, Vault paths, resource sizing, etc.).
- Do **not** change unrelated behavior.

## Required key migrations

### Backend chart

1) Database keys
- `cnpg.enabled` -> `postgres.enabled`
- `cnpg.externalDatabaseUri` -> `postgres.uri`
- `cnpg.instances` -> `postgres.cluster.instances`
- `cnpg.imageName` -> `postgres.cluster.image`
- `cnpg.database` -> `postgres.auth.database`
- `cnpg.owner` -> `postgres.auth.username`
- `cnpg.devPassword` -> `postgres.auth.password`
- `cnpg.enableSuperuserAccess` -> `postgres.cluster.enableSuperuserAccess`
- `cnpg.storage.storageClass` -> `postgres.persistence.storageClass`
- `cnpg.storage.size` -> `postgres.persistence.size`

2) GitHub issue reporting keys
- `reportIssue.existingSecret` -> `github.token.existingSecret`
- `env.GITHUB_REPO` -> `github.repository`

3) Tiles sidecar keys
- `tileSidecar.enabled` -> `tiles.enabled`
- `tileSidecar.image` -> `tiles.nginx.image`
- `tileSidecar.port` -> `tiles.nginx.port`
- `tileSidecar.resources` -> `tiles.nginx.resources`

4) Scheduling keys
- `zoneAntiAffinity.enabled` -> `scheduling.zoneAntiAffinity.enabled`
- `zoneAntiAffinity.topologyKey` -> `scheduling.zoneAntiAffinity.topologyKey`

5) Bootstrap admin keys
- `seedAdmin.enabled` -> `bootstrapAdmin.enabled`
- `seedAdmin.name` -> `bootstrapAdmin.name`
- `seedAdmin.email` -> `bootstrapAdmin.email`
- `seedAdmin.passwordHash` -> `bootstrapAdmin.passwordHash`

6) Auth/OpenID Connect keys
- `oidc.enabled` -> `auth.openidConnect.enabled`
- `oidc.issuer` -> `auth.openidConnect.issuer`
- `oidc.clientId` -> `auth.openidConnect.clientId`
- `oidc.clientSecret` -> `auth.openidConnect.clientSecret`
- `oidc.existingSecret` -> `auth.openidConnect.existingSecret`
- `oidc.redirectUri` -> `auth.openidConnect.redirectUri`
- `oidc.scopes` -> `auth.openidConnect.scopes`
- `oidc.roleMapping` -> `auth.openidConnect.roleMapping`
- `oidc.postLoginRedirect` -> `auth.openidConnect.postLoginRedirect`
- `oidc.trustEmail` -> `auth.openidConnect.trustEmail`
- `oidc.corsOrigins` -> `auth.openidConnect.corsOrigins`

7) Observability/OpenTelemetry keys
- `otel.enabled` -> `observability.openTelemetry.enabled`
- `otel.serviceName` -> `observability.openTelemetry.serviceName`
- `otel.tracesExporter` -> `observability.openTelemetry.exporter.traces`
- `otel.metricsExporter` -> `observability.openTelemetry.exporter.metrics`
- `otel.logsExporter` -> `observability.openTelemetry.exporter.logs`
- `otel.exporterEndpoint` -> `observability.openTelemetry.exporter.endpoint`
- `otel.exporterProtocol` -> `observability.openTelemetry.exporter.protocol`
- `otel.excludedUrls` -> `observability.openTelemetry.excludedUrls`

8) Backend vault values note
- Backend chart now only uses `vault.enabled`.
- Remove obsolete backend overrides if present:
  - `vault.kvMount`
  - `vault.authRef`
  - `vault.refreshAfter`
  - `vault.dbAppSecretPath`
  - `vault.dbSuperuserSecretPath`
  - `vault.reportIssuePatSecretPath`
  - `vault.oidcSecretPath`

### Backup chart

1) DB secret reference
- `cnpgSecretName` -> `postgresSecretName`

2) Observability/OpenTelemetry keys
- `otel.enabled` -> `observability.openTelemetry.enabled`
- `otel.serviceName` -> `observability.openTelemetry.serviceName`
- `otel.tracesExporter` -> `observability.openTelemetry.exporter.traces`
- `otel.metricsExporter` -> `observability.openTelemetry.exporter.metrics`
- `otel.logsExporter` -> `observability.openTelemetry.exporter.logs`
- `otel.exporterEndpoint` -> `observability.openTelemetry.exporter.endpoint`
- `otel.exporterProtocol` -> `observability.openTelemetry.exporter.protocol`

### Frontend chart

1) Scheduling keys
- `zoneAntiAffinity.enabled` -> `scheduling.zoneAntiAffinity.enabled`
- `zoneAntiAffinity.topologyKey` -> `scheduling.zoneAntiAffinity.topologyKey`

## Behavioral notes to preserve

- Backend issue reporting now defaults to disabled unless `github.repository` is set.
  - If an environment should keep issue reporting, ensure `github.repository` is explicitly set (e.g. `owner/repo`).
- Storage class values may now be empty to use cluster default. Preserve existing explicit storage classes in overlays if required.

## What to edit

- `HelmRelease` manifests (`spec.values`, `valuesFrom` references)
- Overlay patch files (commonly `patch-*.yaml`)
- Environment value files consumed by HelmRelease
- Any docs/runbooks that mention old keys

## Validation steps (must run)

1. Search and confirm no old keys remain in the Flux repo:
- `cnpg.`
- `externalDatabaseUri`
- `reportIssue.`
- `tileSidecar.`
- `seedAdmin.`
- `zoneAntiAffinity` (backend/frontend context)
- `oidc.`
- `otel.`
- `cnpgSecretName`

2. Run local manifest builds for all relevant overlays (examples):
- `kustomize build <overlay-path>`
- or `flux build kustomization <name> --path <overlay-path>` if used by the repo

3. Ensure rendered HelmRelease values contain only new keys.

4. Summarize:
- files changed
- old->new key migrations applied
- any environment-specific decisions left unchanged
- any follow-up manual actions needed

## Output format

Provide:
1. A concise migration summary.
2. A per-file change list.
3. A list of any potential risks (if any).
4. Validation output excerpts.

---

If any old key appears in multiple environments, update all of them consistently.