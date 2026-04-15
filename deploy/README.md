# Deployment Guide

This directory contains everything needed to deploy HRIV to Kubernetes clusters
using [Flux CD](https://fluxcd.io/) and OCI Helm charts stored in GitHub
Container Registry (GHCR).

## Architecture Overview

```
Developer → PR → main → Release Please PR → merge → GitHub Release (v1.2.3)
                   │                                        │
                   ▼                                        ▼
            CI builds images                         CI builds images
            tagged: sha, main-*                      tagged: 1.2.3, latest
            Charts: 0.1.0-dev.*                      Charts: 1.2.3
                   │                                        │
                   ▼                                        ▼
         ┌─────────────────┐                     ┌─────────────────┐
         │ latest cluster   │                     │ stable cluster   │
         │ (staging)        │                     │ (production)     │
         │ auto-deploys     │                     │ auto-deploys     │
         │ dev pre-releases │                     │ stable releases  │
         └─────────────────┘                     └─────────────────┘
```

### How it works

| Event | Images pushed | Charts pushed | latest cluster | stable cluster |
|---|---|---|---|---|
| PR opened | Built (not pushed) | Linted only | No change | No change |
| PR merged to `main` | `sha`, `main-*`, `latest` | `0.1.0-dev.<ts>` | Auto-deploys | No change |
| Release PR merged | `1.2.3`, `latest` | `1.2.3` | Auto-deploys | Auto-deploys |

**latest** accepts any chart version (`>=0.0.0-0`), including `dev` pre-releases.
**stable** accepts only stable semver releases (`>=1.0.0`).

Both clusters have:
- **Drift detection** — manual `kubectl` edits are reverted automatically.
- **Automatic rollback** — failed upgrades retry 3 times, then roll back.
- **Cosign signatures** — all images and charts are signed with keyless Sigstore.
- **Trivy scanning** — vulnerabilities reported in GitHub's Security tab.
- **SBOM + provenance** — attached to every container image.

---

## Prerequisites

1. **Flux v2** installed on both clusters ([install guide](https://fluxcd.io/flux/installation/))
2. **Flux Notification Controller** (included in default Flux install)
3. **GHCR read access** — if packages are private, create a pull secret:

```bash
kubectl -n hriv create secret docker-registry ghcr-auth \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-pat-read-packages>
```

Then uncomment `secretRef` in `deploy/flux/base/helm-repository.yaml`.

---

## Bootstrap a Cluster

### Option A: Flux bootstrap (recommended)

This connects Flux to this repository and applies manifests from the chosen
environment path.

**latest (staging) cluster:**

```bash
flux bootstrap github \
  --owner=bcit-tlu \
  --repository=hriv \
  --branch=main \
  --path=deploy/flux/latest \
  --personal=false
```

**stable (production) cluster:**

```bash
flux bootstrap github \
  --owner=bcit-tlu \
  --repository=hriv \
  --branch=main \
  --path=deploy/flux/stable \
  --personal=false
```

### Option B: Manual apply

If Flux is already bootstrapped and watching a different repo, apply the
manifests directly:

```bash
# Build the kustomize overlay
kubectl apply -k deploy/flux/latest/   # or deploy/flux/stable/
```

---

## Notifications (Slack / Teams / Webhook)

The base manifests include a generic webhook `Provider` and `Alert`. To
activate:

```bash
# Create the webhook secret
kubectl -n hriv create secret generic notification-webhook \
  --from-literal=address=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

Flux will send notifications for all HelmRelease events (install, upgrade,
rollback, failure) in the `hriv` namespace.

To switch to Slack-native formatting, change the Provider `spec.type` from
`generic` to `slack` in `deploy/flux/base/notifications.yaml`.

---

## Promoting to Stable (Production)

When a new release is created (e.g., `v1.2.3`), the **stable** cluster will
auto-deploy it because its HelmReleases use `version: ">=1.0.0"`.

If you prefer manual promotion, pin the version in the stable HelmReleases:

```yaml
# deploy/flux/stable/helmrelease-frontend.yaml
spec:
  chart:
    spec:
      version: "1.2.3"   # Pin to specific release
```

Commit and push — Flux reconciles within 5 minutes.

---

## Versioning (Release Please)

Versions are managed automatically by [Release Please](https://github.com/googleapis/release-please).

1. Developers write **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.)
2. On every push to `main`, Release Please opens or updates a **Release PR**
3. The Release PR shows the calculated next version and changelog
4. **Merging the Release PR** creates a GitHub Release + git tag (`v1.2.3`)
5. The tag triggers CI which builds and publishes release-versioned images and charts

Files updated automatically by Release Please:
- `version.txt`
- `charts/*/Chart.yaml` (version + appVersion)
- `frontend/package.json` (version)
- `CHANGELOG.md`

---

## Verifying Signatures

All container images and Helm charts are signed with
[Cosign](https://github.com/sigstore/cosign) using keyless Sigstore
(GitHub Actions OIDC). To verify:

```bash
# Verify a container image
cosign verify \
  --certificate-identity-regexp="https://github.com/bcit-tlu/hriv/" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/bcit-tlu/hriv/frontend:1.2.3

# Verify a Helm chart
cosign verify \
  --certificate-identity-regexp="https://github.com/bcit-tlu/hriv/" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/bcit-tlu/hriv/charts/hriv-frontend:1.2.3
```

---

## Adapting for Other Applications

This pipeline is designed to be reusable. To adapt it for a new app:

1. **Copy the CI workflows** (`.github/workflows/ci.yaml` and `release-please.yaml`)
2. **Update `release-please-config.json`** — adjust `extra-files` to match your chart/package paths
3. **Add `# x-release-please-version`** annotations to your `Chart.yaml` and `values.yaml` files
4. **Copy `deploy/flux/`** — update hostnames, chart names, and namespace
5. **Bootstrap Flux** on your cluster pointing to the new app's `deploy/flux/<env>/` path

The CI workflow auto-discovers charts via `charts/*/` glob — add or remove
chart directories and the pipeline adapts with zero config changes.
