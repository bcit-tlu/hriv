---
name: hriv-deployment-release
description: Work on HRIV Dockerfiles, docker-compose, Helm charts, Kubernetes deployment values, Flux/Vault/CNPG configuration, backup service deployment, observability, CI workflows, release-please, changelogs, and deployment documentation. Use when changing charts, deploy docs, .github workflows, Docker images, backup infrastructure, release flow, or operational configuration.
---

# HRIV Deployment And Release

Use this skill for infrastructure, deployment, release, backup, CI, and
operational documentation changes.

## Start Here

1. Read `references/deployment-release-map.md`.
2. Read `../../../docs/RELEASE_AND_DEPLOY_FLOW.md` for release and deployment
   behavior.
3. Read `../../../docs/observability-conventions.md` for tracing/logging/metrics
   conventions.
4. Use `$testing-backup-service` for backup service verification.
5. Use `$hriv-admin-operations` when deployment changes affect admin import,
   export, or background task operations.

## Operational Rules

- Release Please uses manifest mode with separate frontend, backend, and backup
  components; do not switch it to `GITHUB_TOKEN`.
- Keep `.release-please-manifest.json`, component changelogs, and chart
  `# x-release-please-version` annotations consistent when release tooling
  changes.
- CI uses shared `bcit-tlu/.github` OCI build reusable workflow and Node 24
  JavaScript actions.
- Helm changes must preserve Vault Secrets Operator, CNPG, image repository, and
  chart publishing assumptions documented in AGENTS and deploy docs.
- Backup and DB tooling must keep PostgreSQL client/server major versions
  compatible.

## Validation

For chart changes:

```bash
for chart in charts/*/; do helm lint "$chart"; done
for chart in charts/*/; do helm template test "$chart" | kubeconform -strict -summary -schema-location default -ignore-missing-schemas; done
```

For backup changes, use `$testing-backup-service`.
