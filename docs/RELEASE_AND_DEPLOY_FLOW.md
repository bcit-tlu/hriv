# Release & Deploy Flow

How code gets from a merged PR on `main` to a running pod, for the three
deployable components (`frontend`, `backend`, `backup`). This is the contract
between this repo and your downstream FluxCD repository (for example, `bcit-tlu/flux-fleet`).

A fourth Release Please component, `synthetic-monitoring`, follows the same
image-release contract (RC images on `main`, `<component>-v<ver>` tags, digest
retag to `<ver>`/`latest`) but is **image-only — it has no Helm chart**, so its
`helm-publish.yaml` dispatch is skipped in `release-please.yaml` and it is
absent from the `helm-publish.yaml` and `ci.yaml` chart-publish loops.
Flux-fleet still deploys it, as a raw CronJob manifest rather than a chart:
`apps/base/hriv/synthetic-monitoring/`, with the stable overlay pinned to a
released semver (`synthetic-monitoring-pin.yaml`) that must be bumped when a
`synthetic-monitoring-vX.Y.Z` release ships. See
[synthetic-monitoring.md](synthetic-monitoring.md).

## At a glance

```
         PR title (Conventional Commits)
                    │
                    ▼
 ┌──────────── main push ────────────┐
 │                                   │
 │  ci.yaml  ──►  GHCR: image        │   helm-publish.yaml  (runs ONLY on release)
 │                  sha-<full>       │                │
 │                  <ver>-rc.<ts>.g<short>            │
 │             ──►  GHCR: chart      │                │
 │                  hriv-<component>-│                ▼
 │                  <ver>-rc.<ts>.   │       GHCR: hriv-<component>-<ver>.tgz
 │                  g<short>.tgz     │       (one release chart artifact
 │                                   │        per release)
 │  release-please.yaml ──► chore    │
 │    release PR (if feat:/fix:)     │
 │                                   │
 └───────────────────────────────────┘
                    │
          merge chore PR ──► GitHub Release ─► dispatches:
                    │                            - helm-publish.yaml
                    │                            - release-retag.yaml
                    ▼
          release-retag.yaml ──► image aliases:
                                   <ver>, latest
                                   (same OCI digest, no rebuild)
```

## Inputs, artifacts, triggers

| When                              | Inputs                           | Workflow                                                                                                                                                                | GHCR artifacts                                             |
| --------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| PR opened / synced against `main` | PR title                         | `pr-title-lint.yaml` (humans only; bot-authored PRs skipped)                                                                                                            | —                                                          |
| PR opened / synced against `main` | component path change            | `ci.yaml` builds but does **not** push                                                                                                                                  | —                                                          |
| Push to `main`                    | commits since last component tag | `ci.yaml` computes next `<ver>` from `git log` conventional-commit analysis (`feat:` → minor, `!:`/`BREAKING CHANGE:` → major, else patch), builds per-component images | image: `sha-<fullsha>` + `<ver>-rc.<ts>.g<short>`          |
| Push to `main`                    | component path change            | `ci.yaml` `helm-publish` job packages `charts/<component>` and pushes to OCI (cosign-signed)                                                                            | chart: `hriv-<component>:<ver>-rc.<ts>.g<short>`           |
| Push to `main`                    | commits since last component tag | `release-please.yaml` opens/updates one chore release PR per component whose path has a release-triggering commit                                                       | —                                                          |
| Merge of a release PR             |                                  | `release-please.yaml` cuts a GitHub Release with tag `<component>-v<ver>`, then `dispatch-publish` job workflow-dispatches the two release workflows below              | release created                                            |
| Release published (via dispatch)  | release tag                      | `release-retag.yaml` waits for the `sha-<fullsha>` image of the release commit, then aliases it                                                                         | image: `<ver>`, `latest` (retag — same digest, no rebuild) |
| Release published (via dispatch)  | release tag                      | `helm-publish.yaml` packages `charts/<component>/` and pushes to OCI                                                                                                    | chart: `hriv-<component>:<ver>.tgz`                        |

**Charts are published on every main push _and_ on release.** Main pushes
produce rc charts (`<ver>-rc.<ts>.g<short>`, cosign-signed); releases produce
the clean `<ver>` chart. Which one an environment follows is decided by the
OCIRepository semver filter on the flux-fleet side, described below.

`ci.yaml` uses path filters to run each component's quality gate only when its
source or directly coupled build configuration changes. Workflow changes run
all component gates; `helm-lint` remains a required, unconditional check.
Skipped component jobs satisfy their required check status, while the
corresponding reusable OCI build is skipped as well.

### Initial restore-validation release

`restore-validation` intentionally remains at `0.0.0` until its first release; there is no version bump in feature PRs. Manifest mode plus `bump-minor-pre-major: true` means a conventional `feat:` commit affecting that component produces the intended first release proposal `0.1.0` (and tag `restore-validation-v0.1.0`). A repository test locks the manifest seed, Python release type, and pre-major minor-bump setting together.

## Tag and version formats

| Thing                      | Format                                                 | Example                                              | Notes                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image rc tag               | `<ver>-rc.<14-digit UTC ts>.g<7-char sha>`             | `1.1.18-rc.20260414194220.gb286051`                  | Valid SemVer prerelease. Timestamp gives chronological ordering; `g<sha>` marks the build commit.                                                                                                                                                                                                  |
| Image release tag          | `<ver>`, `latest`                                      | `1.1.18`, `latest`                                   | Produced by digest-retag, not rebuild.                                                                                                                                                                                                                                                             |
| Image immutable pointer    | `sha-<40-char sha>`                                    | `sha-b286051...`                                     | Always published; survives across every retag.                                                                                                                                                                                                                                                     |
| PR preview image (fe/be)   | `sha-<PR head sha>`, `pr-<number>`                     | `sha-9f1c2e3...`, `pr-1702`                          | Same-repo PRs only (`push_pr_images` on the shared oci-build). Built from the PR **head** commit, unsigned, never rc-tagged. `sha-<head>` is what a flux-fleet-v2 preview (`preview` label → `hriv-pr<N>.latest.tlu.bcit.ca`) pins; `pr-<N>` is a moving alias. Not retained as release artifacts. |
| Git release tag            | `<component>-v<ver>`                                   | `frontend-v1.1.18`                                   | Cut by release-please.                                                                                                                                                                                                                                                                             |
| Chart artifact (rc)        | `...charts/hriv-<component>:<ver>-rc.<ts>.g<short>`    | `...hriv-frontend:1.1.18-rc.20260414194220.gb286051` | OCI chart pushed by `ci.yaml` on each main push that changed the component (cosign-signed).                                                                                                                                                                                                        |
| Chart artifact (release)   | `ghcr.io/<owner>/<repo>/charts/hriv-<component>:<ver>` | `...charts/hriv-frontend:1.1.18`                     | OCI chart pushed by `helm-publish.yaml` on release.                                                                                                                                                                                                                                                |
| Display version (rendered) | `<ver>-rc.<short>` _or_ `<ver>`                        | `1.1.18-rc.gb286051` / `1.1.18`                      | Helm chart's `displayVersion` helper strips the timestamp from the image tag at deploy time. See `charts/<component>/templates/_helpers.tpl`.                                                                                                                                                      |

## Title → release-please

Release-please reads PR titles on `main` and uses them as the sole input
for whether to open a release PR and what version bump to apply. A title
that doesn't parse as a Conventional Commit is silently dropped (workflow
still exits 0, no release PR opens). `pr-title-lint` enforces the format
at the merge boundary for human PRs.

Full title rules and rationale: [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md#pr-titles-must-be-conventional-commits).

## flux-fleet side

Both environments in a downstream FluxCD repo (for example, `bcit-tlu/flux-fleet`)
share the same objects from `apps/base/`: one `OCIRepository` per component
pointing at `oci://ghcr.io/bcit-tlu/hriv/charts/hriv-<component>`, and a
`HelmRelease` whose `chartRef` points at that OCIRepository. For the three
chart-deployed components the templates use `.Values.image.tag | default
.Chart.AppVersion`, and the overlays set no `image.tag`, so chart and image
move together — there is no `ImagePolicy`, `ImageUpdateAutomation`, or
`image.tag` patch. (`restore-validation` is the exception: its chart runs
digest-pinned images from its own overlay values, so its chart can advance
without its images changing.)

### `latest` (staging)

```
GitHub webhook (push + package) ──► Receiver (components/notifications-hriv)
                                          │  package/published fires seconds
                                          ▼  after `helm push`
OCIRepository            semver ">= 0.0.x-0", semverFilter "^.*-rc.*$"
  url ghcr.io/…/charts/hriv-frontend      (patched in clusters/cluster03/latest)
                │
                ▼  source-controller pulls the new rc chart
HelmRelease
  chartRef → OCIRepository
  appVersion = image tag ⇒ rc chart + rc image roll out together
```

**Net effect:** every main push ⇒ a new rc chart rolls out to `latest`
seconds after the CI `helm-publish` job finishes — chart and image together.

### `stable` (production)

Same objects, but the base `semver: ">= 0.0.x"` admits only clean release
versions, so `stable` tracks the most recently released chart (and its
matching image) and moves only on release.

### Triggering: webhook vs polling

A GitHub webhook on this repo fires to both `flux.latest.ltc.bcit.ca` and
`flux.ltc.bcit.ca`. The Flux `Receiver` (defined in
`flux-fleet/components/notifications-hriv`) authorises `push` and `package`
events. The `package`/`published` event for the chart package arrives
seconds after `helm push` and makes source-controller pull the new chart
immediately. The `push` event also reaches the receiver but lands several
minutes before the chart exists, so it is effectively a no-op for chart
rollout. `OCIRepository.spec.interval: 48h` remains as a catch-all for
missed deliveries — it is not the rollout path.

## Consequences worth knowing

- **Chart edits on `main` reach `latest` via the rc chart — when a chart is
  published.** `ci.yaml` only runs a component's build (and therefore
  `helm-publish`) when its path filter matches: `frontend` watches
  `frontend/**` and `charts/frontend/files/**`, `backend` watches
  `backend/**` only, while `backup` and `restore-validation` watch their
  whole `charts/<component>/**`. So a PR touching only
  `charts/frontend/templates/` or `charts/backend/**` publishes no rc chart
  on its own; the template change ships with the next source change to that
  component (or a release). `stable`'s semver filter only admits clean
  `<ver>` charts, so every chart change reaches production when the
  component is next released.
- **Long-running features ship dark behind a chart flag, not on a branch.**
  Work that spans more than one release (e.g. the collections epic,
  `collections.enabled` → `COLLECTIONS_ENABLED`, see
  [collections.md](collections.md)) merges to `main` in small PRs behind a
  chart value that defaults off, is switched on in the `latest` overlay,
  and is removed by the epic's closing issue. This keeps `fix:`/`feat:`
  bumps and `stable` re-pins flowing for unrelated work; release branches
  are reserved for genuine emergencies.
- **Retag promotion preserves image identity.** `release-retag.yaml`
  does not rebuild on release; it creates a new OCI tag pointing at the
  _same manifest_ as the `sha-<fullsha>` built on `main`. So the binary
  a `stable` pod runs is bit-identical to the rc built on `main` for
  that commit — only the displayed version string differs, because
  `APP_VERSION`/`VITE_APP_VERSION` are runtime-injected by Helm, not
  baked into the image (see `charts/<component>/templates/_helpers.tpl`
  `displayVersion` helper).
- **`images.backupChild` in flux-fleet is a manual pin.** The
  restore-validation select/restore child Jobs run a digest-pinned
  `hriv-backup` image from the env overlay values
  (`apps/overlays/*/hriv-restore-validation/values-*.yaml`), not the tag
  the backup Deployment runs. When a `backup` release changes the
  published marker/state/manifest documents, bump `images.backupChild`
  in both overlays to a reviewed released digest in the same rollout —
  otherwise `validation-select` rejects new backups with
  `COMPONENT_INCOHERENT`. Newer readers accept older documents, so
  bumping forward is safe.
- **`pr-title-lint` skips bot-authored PRs.** Release-please's own PRs
  (author type `Bot`) bypass the lint. Without this guard every
  release-please PR would be held under "1 workflow awaiting approval"
  because `pr-title-lint` is the only `pull_request_target` workflow in
  the repo and the repo's Actions settings require approval for
  first-time contributors.
- **`release-as` is a one-shot override, not a pinning mechanism.** If
  you use it to unstick release-please, remove it once the manifest
  catches up — the staleness guard in `release-please.yaml` will fail
  the next main-push workflow until you do.

## Where to look when something breaks

| Symptom                                                                 | First place to look                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No release PR opened after merging a `feat:`/`fix:`                     | release-please logs on the main-push workflow; check that the component path was touched                                                                                                                                                                                             |
| `release-please` workflow failing with "Stale `release-as`"             | `release-please-config.json` — remove the `release-as` field for the named package                                                                                                                                                                                                   |
| `latest` env not picking up a new main push                             | GitHub repo Settings → Webhooks → Recent Deliveries (`package`/`published` for `hriv/charts/hriv-<component>` should be HTTP 200); `kubectl -n hriv get ocirepository` revision vs GHCR; notification-controller logs; fallback `flux reconcile source oci hriv-<component> -n hriv` |
| `stable` env running stale chart logic                                  | no release has been cut since the chart edit; cut one                                                                                                                                                                                                                                |
| Image retag didn't happen after release                                 | `release-retag.yaml` run for the release; it waits up to 30 min for the rc image, then times out                                                                                                                                                                                     |
| Chart artifact missing for a release                                    | `helm-publish.yaml` run for the release tag; parse step rejects malformed tags                                                                                                                                                                                                       |
| `validation-select` fails `COMPONENT_INCOHERENT` after a backup release | flux-fleet `images.backupChild` pin — likely older than the deployed backup writer; bump both overlays                                                                                                                                                                               |
