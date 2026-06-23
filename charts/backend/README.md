# hriv-backend chart notes

## GitHub issue reporting (`github-issue.enabled`)

The backend can create GitHub issues via `POST /api/issues/report`.
This integration is now explicitly gated by `github-issue.enabled`.

### Values

- `github-issue.enabled` (bool, default `false`)
- `github-issue.repository` (string, default `""`, format `owner/repo`)
- `github-issue.token.existingSecret` (string, default `""`)

### Behavior

When `github-issue.enabled: false`:

- `GITHUB_REPO` is not injected
- `GITHUB_TOKEN` is not injected
- No GitHub secret is referenced

When `github-issue.enabled: true`:

- `GITHUB_REPO` is injected from `github-issue.repository`
- `GITHUB_TOKEN` is read from secret `github-issue.token.existingSecret`, key `token`
- chart render fails if either required value is missing

### Example (enabled)

```yaml
github-issue:
  enabled: true
  repository: bcit-tlu/hriv
  token:
    existingSecret: github-report-issue-token
```

Create the referenced secret:

```bash
kubectl create secret generic github-report-issue-token \
  --from-literal=token=ghp_YOUR_SCOPED_PAT \
  -n <namespace>
```

## Persistence Layout

When `persistence.enabled=true`, the chart now expects two storage concerns:

- `persistence.sourceImages` mounts at `/data`
- `persistence.tiles` mounts at `/data/tiles`

The source-images PVC remains the `/data` root on purpose so the backend can
keep using `/data/.maintenance` and `/data/admin_tasks` without changing the
runtime paths stored in the database:

- `SOURCE_IMAGES_DIR=/data/source_images`
- `TILES_DIR=/data/tiles`

For multi-replica API or worker deployments, both PVCs must use
`ReadWriteMany`.

## Upgrade Notes

The legacy flat backend persistence keys are deprecated but still honored as
fallbacks during upgrade:

- `persistence.storageClass`
- `persistence.size`
- `persistence.accessModes`

Move those values into `persistence.sourceImages.*` and set
`persistence.tiles.*` explicitly in your overlay when you adopt the split-PVC
layout.

Also note that older releases created a single PVC named
`{fullname}-data`. This chart now creates `{fullname}-source-images` and
`{fullname}-tiles`, so the upgrade requires a manual cutover. Helm will not
migrate or delete the old data PVC for you.
