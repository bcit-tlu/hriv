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
4. Read `../../../docs/observability-operations.md` when the change affects
   alerting, runbooks, or operator validation.
5. Read `../../../docs/restore-validation.md` before changing restore-validation charts,
   Flux/Vault/CNPG wiring, RBAC, fixed proxy NetworkPolicies, weekly/manual scheduling, sole-retained cleanup, or
   the one native alert. The simplified contract excludes exporter metrics, dashboards, autonomous reapers, and #1252. Keep it a separate component and namespace; never grant Kubernetes API access to the
   hardened backup Deployment.
6. Use `$testing-backup-service` for backup service verification.
7. Use `$hriv-admin-operations` when deployment changes affect admin import,
   export, or background task operations.

## Operational Rules

- Release Please uses manifest mode with separate frontend, backend, backup,
  restore-validation, and synthetic-monitoring components; do not switch it to
  `GITHUB_TOKEN`.
- The restore-validation seed remains `0.0.0`; with
  `bump-minor-pre-major: true`, its first conventional `feat:` release is
  `0.1.0`.
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
