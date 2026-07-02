# hriv-backend chart notes

## Feedback delivery (`feedback.provider`)

The backend accepts in-app feedback via `POST /api/issues/report`, then routes
the submission through the configured delivery provider. The new generic chart
config uses `feedback.provider`, with GitHub as the only implemented provider in
this first foundation step.

### Values

- `feedback.provider` (string, default `""`; supported: `github`)
- `feedback.github.repository` (string, default `""`, format `owner/repo`)
- `feedback.github.token.existingSecret` (string, default `""`)

Legacy fallback values are still honored for upgrade compatibility:

- `github-issue.enabled`
- `github-issue.repository`
- `github-issue.token.existingSecret`

### Behavior

When `feedback.provider: ""` and `github-issue.enabled: false`:

- no feedback delivery env vars are injected
- no feedback secret is referenced

When `feedback.provider: github`:

- `FEEDBACK_DELIVERY_PROVIDER=github` is injected
- `FEEDBACK_GITHUB_REPOSITORY` is injected from `feedback.github.repository`
- `FEEDBACK_GITHUB_TOKEN` is read from secret
  `feedback.github.token.existingSecret`, key `token`
- chart render fails if either required value is missing

When `feedback.provider` is empty but `github-issue.enabled: true`:

- the chart maps the legacy GitHub-only values into the new generic runtime env
- this fallback is intended only for upgrade compatibility while overlays move
  to the `feedback.*` config

### Example (enabled)

```yaml
feedback:
  provider: github
  github:
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
