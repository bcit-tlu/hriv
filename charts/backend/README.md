# hriv-backend chart notes

## GitHub issue reporting (`github.enabled`)

The backend can create GitHub issues via `POST /api/issues/report`.
This integration is now explicitly gated by `github.enabled`.

### Values

- `github.enabled` (bool, default `false`)
- `github.repository` (string, default `""`, format `owner/repo`)
- `github.token.existingSecret` (string, default `""`)

### Behavior

When `github.enabled: false`:

- `GITHUB_REPO` is not injected
- `GITHUB_TOKEN` is not injected
- No GitHub secret is referenced

When `github.enabled: true`:

- `GITHUB_REPO` is injected from `github.repository`
- `GITHUB_TOKEN` is read from secret `github.token.existingSecret`, key `token`
- chart render fails if either required value is missing

### Example (enabled)

```yaml
github:
  enabled: true
  repository: bcit-tlu/hriv
  token:
    existingSecret: my-release-backend-report-issue-pat
```

Create the referenced secret:

```bash
kubectl create secret generic my-release-backend-report-issue-pat \
  --from-literal=token=ghp_YOUR_SCOPED_PAT \
  -n <namespace>
```
