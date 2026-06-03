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
