# Security scanning and dependency updates

How container CVE findings reach the GitHub **Security → Code scanning** tab,
how suppressions are governed, and how automated dependency PRs are handled.

## Where code-scanning alerts come from

Two workflows upload Trivy SARIF, both under the category `trivy-<component>`
(`frontend`, `backend`, `backup`, `restore-validation`, `synthetic-monitoring`).
Because the category is shared, a rescan **updates alerts in place** — it
never creates a duplicate alert set.

| Source                                                                                        | Trigger                                                 | What is scanned                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `bcit-tlu/.github/.github/workflows/oci-build.yaml` (called from `.github/workflows/ci.yaml`) | Push to `main` that changes the component (path filter) | The freshly built image, by digest                         |
| `.github/workflows/security-rescan.yaml`                                                      | Weekly (Monday 14:00 UTC) + `workflow_dispatch`         | `ghcr.io/bcit-tlu/hriv/hriv-<component>:latest`, scan-only |

Both scans use `severity: CRITICAL,HIGH`, `ignore-unfixed: false` and
`.trivyignore`. PR builds also run Trivy (table output, `ignore-unfixed: true`)
but do **not** upload SARIF and are advisory (`exit-code: 0`).

The rescan closes the gap where a component that has not changed for weeks
never gets rescanned: newly published CVEs in its base image or pinned
dependencies would otherwise stay invisible until someone happened to touch
that directory. It never rebuilds or pushes — retagging `latest` would roll
the staging environment on a timer (see
[RELEASE_AND_DEPLOY_FLOW.md](RELEASE_AND_DEPLOY_FLOW.md)).

Run it manually from **Actions → [Security] Weekly Trivy rescan of published
images → Run workflow** after a base-image or dependency bump lands on `main`
if you want the alert state refreshed immediately.

## Reviewing `.trivyignore`

`.trivyignore` at the repo root is the single suppression list for every
scan (PR, `main`, and rescan). Its header documents the rules: every entry
needs a group header, a justification for why the CVE is unreachable /
unfixable / accepted, and a trailing `# sev=` comment. It is reviewed
**quarterly**; the `Last reviewed:` date in the header is the record of that
review. Removing an entry is free — the next scan simply re-reports the CVE.

## Handling Dependabot PRs

`.github/dependabot.yml` opens weekly (Monday, `America/Vancouver`) PRs for
Docker base images, Poetry (`backend`, `backup`, `restore-validation`), npm
(`frontend`, `synthetic-monitoring`) and GitHub Actions. Minor + patch updates
are grouped per component; majors open one PR each. PR titles are
`chore(deps)` / `chore(deps-dev)` / `ci(deps)`, which `pr-title-lint` accepts
and release-please leaves out of changelogs.

Checklist when merging one:

- **Runtime Python/npm dependency changed?** Regenerate the component's
  `THIRD-PARTY-LICENSES.txt` (see `AGENTS.md` → Setup Commands); CI fails on
  drift.
- **`@playwright/test` bump in `synthetic-monitoring`** (its own Dependabot
  group named `playwright`): also bump the
  `FROM mcr.microsoft.com/playwright:vX.Y.Z-noble` tag in
  `synthetic-monitoring/Dockerfile` to the same version on that PR.
  `synthetic-monitoring/scripts/check-playwright-image-version.mjs` fails CI
  until the two agree. The Playwright image is deliberately **ignored** in the
  Docker ecosystem so Dependabot never opens a lone image bump that would
  break this invariant.
- **Base image bump?** The PR-time Trivy table shows any new CRITICAL/HIGH
  findings; the `main` build after merge uploads SARIF and refreshes alerts.

## Follow-up (not implemented)

Make PR-time Trivy scans blocking for CRITICAL findings (`exit-code: 1` in the
reusable `oci-build.yaml`) once the `.trivyignore` rewrite (WS4) lands and the
baseline is clean.
