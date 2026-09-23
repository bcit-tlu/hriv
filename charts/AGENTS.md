# Helm Charts

Commands run from the repo root:

- Lint all charts: `for chart in charts/*/; do helm lint "$chart"; done`
- Validate all charts: `for chart in charts/*/; do helm template test "$chart" | kubeconform -strict -summary -schema-location default -ignore-missing-schemas; done`
- Regression checks: `bash scripts/test-helm-chart-regressions.sh`
- Tiles sidecar runtime checks (requires docker): `bash scripts/test-tiles-nginx-runtime.sh`

## Release wiring

- `version:` and `appVersion:` lines in `Chart.yaml` carry
  `# x-release-please-version` annotations — release-please bumps them.
- Charts publish to `oci://ghcr.io/bcit-tlu/hriv/charts` on release; see
  [`docs/RELEASE_AND_DEPLOY_FLOW.md`](../docs/RELEASE_AND_DEPLOY_FLOW.md).

## Cross-repo hydration

Chart `secretKeyRef`/secret names must match the VaultStaticSecret /
VaultDynamicSecret `destination.name` in `bcit-tlu/flux-fleet`
(`apps/overlays/{latest,stable}/hriv/`): fixed names are
`postgres-db-credentials`, `oidc-credentials`,
`github-report-issue-token`, `azure-storage-credentials`. The chart values
key for issue reporting is `github-issue` (hyphenated).
`kustomize build` does NOT catch destination-name vs. chart-template
mismatches — cross-reference by hand. When workloads share a
VaultDynamicSecret, `rolloutRestartTargets` must list every Deployment
that consumes it.
