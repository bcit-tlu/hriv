# Security scanning and dependency updates

How container CVE findings reach the GitHub **Security → Code scanning** tab,
how suppressions are governed, and how automated dependency PRs are handled.

## Where code-scanning alerts come from

Two workflows upload Trivy SARIF, one category per component
(`frontend`, `backend`, `backup`, `restore-validation`, `synthetic-monitoring`)
and per source. Within a category each upload **replaces** the previous alert
set, so alerts update in place rather than duplicating.

| Source                                                                                        | Trigger                                                 | What is scanned                                                                             | SARIF category               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| `bcit-tlu/.github/.github/workflows/oci-build.yaml` (called from `.github/workflows/ci.yaml`) | Push to `main` that changes the component (path filter) | The freshly built rc image, by digest (what the staging env runs)                           | `trivy-<component>`          |
| `.github/workflows/security-rescan.yaml`                                                      | Weekly (Monday 14:00 UTC) + `workflow_dispatch`         | `ghcr.io/bcit-tlu/hriv/hriv-<component>:latest`, scan-only (released; what production runs) | `trivy-<component>-released` |

The two categories are deliberately separate: `:latest` is the digest of the
last _release_ (see [RELEASE_AND_DEPLOY_FLOW.md](RELEASE_AND_DEPLOY_FLOW.md)),
while `main` builds an rc that may be ahead of it. Sharing one category would
let each upload overwrite the other's findings. Expect the same CVE to appear
under both categories when the released and rc digests match.

Both scans use `severity: CRITICAL,HIGH`, `ignore-unfixed: false` and
`.trivyignore`, and SARIF uploads are limited to CRITICAL/HIGH via
`limit-severities-for-sarif: true` (trivy-action ignores `severity` for sarif
output without it — the shared `oci-build.yaml` gets the same fix in
bcit-tlu/.github PR #18). PR builds also run Trivy (table output,
`ignore-unfixed: true`) but do **not** upload SARIF and are advisory
(`exit-code: 0`).

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

`.github/dependabot.yml` opens weekly (Monday 05:00, `America/Vancouver`) PRs for
Docker base images, Poetry (`backend`, `backup`, `restore-validation`), npm
(`frontend`, `synthetic-monitoring`) and GitHub Actions. Minor + patch updates
are grouped per component; majors open one PR each. PR titles are
`chore(deps)` / `chore(deps-dev)` / `ci(deps)`, which `pr-title-lint` accepts
and release-please leaves out of changelogs.

Dependabot PRs do not run the Chromatic workflow: `dependabot[bot]`-triggered
workflows receive no repository secrets, so `CHROMATIC_PROJECT_TOKEN` is empty
and the job would fail with "Missing project token" before publishing anything.
The job is skipped via `if: github.actor != 'dependabot[bot]'`. The bump's
`main` build after merge is skipped too — dependency merges touch only
files excluded by the workflow's push-paths filter (`package.json`, the
lockfile, generated license notices), and a weekly scheduled `main` build
catches any resulting rendering drift. Dependabot branches are not
auto-rebased — comment `@dependabot rebase` (or `@dependabot recreate`) on the
PR to refresh one that has fallen behind `main`.

Dependabot cannot run repo tooling during an update, so lockfile bumps used to
land without the regenerated `THIRD-PARTY-LICENSES.txt` that CI's drift gate
requires. `.github/workflows/dependabot-licenses.yaml` closes that gap: it
triggers on `push` to `dependabot/**` branches (`github.actor ==
'dependabot[bot]'`), regenerates the notices for each component whose
manifest/lockfile changed, and commits them back to the branch. It pushes with
the release-please GitHub App token so the fixup push re-triggers the PR check
suite — a `GITHUB_TOKEN` push would be swallowed by the anti-recursion guard.
The workflow triggers on `push` rather than `pull_request` because Dependabot's
PR events get a read-only token and no repository secrets (GitHub treats them
like fork PRs), whereas in-repo branch pushes run in the trusted context.

Some majors are deliberately ignored in `dependabot.yml`: all `node` image and
`@types/node` majors (HRIV follows the even-numbered LTS line, so a move to the
next LTS is a deliberate PR that also edits those ignores), and frontend
`typescript`, `storybook`/`@storybook/*` and `vitest`/`@vitest/*` majors whose
peers cannot follow yet. Each ignore has a comment naming the blocker; when it
clears, delete the ignore and take the bump as a co-ordinated PR (all peers
together) rather than via single-package Dependabot PRs.

Checklist when merging one:

- **Runtime Python/npm dependency changed?** `dependabot-licenses.yaml`
  regenerates the component's `THIRD-PARTY-LICENSES.txt` automatically on the
  bot's branch; CI fails on drift if the job did not run (e.g. a human force-push
  to the branch — regen manually, see `AGENTS.md` → Setup Commands).
- **`@playwright/test` bump in `synthetic-monitoring`** (its own Dependabot
  group named `playwright`): self-contained — the Dockerfile installs the
  matching Chromium via `npx playwright install --with-deps chromium`, so no
  image co-bump is needed.
- **Base image bump?** The PR-time Trivy table shows any new CRITICAL/HIGH
  findings; the `main` build after merge uploads SARIF and refreshes alerts.

## Follow-up (not implemented)

Make PR-time Trivy scans blocking for CRITICAL findings (`exit-code: 1` in the
reusable `oci-build.yaml`) once the `.trivyignore` rewrite (WS4) lands and the
baseline is clean.
