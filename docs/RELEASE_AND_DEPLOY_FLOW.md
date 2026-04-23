# Release & Deploy Flow

How code gets from a merged PR on `main` to a running pod, for each of the
three components (`frontend`, `backend`, `backup`). This is the contract
between this repo and `bcit-tlu/flux-fleet`.

## At a glance

```
         PR title (Conventional Commits)
                    │
                    ▼
 ┌──────────── main push ────────────┐
 │                                   │
 │  ci.yaml  ──►  GHCR: image        │   helm-publish.yaml  (runs ONLY on release)
 │                  sha-<full>       │                │
 │                  <ver>-rc.<ts>.<short>             │
 │                                   │                ▼
 │  release-please.yaml ──► chore    │       GHCR: hriv-<component>-<ver>.tgz
 │    release PR (if feat:/fix:)     │       (one chart artifact per release)
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

| When | Inputs | Workflow | GHCR artifacts |
|---|---|---|---|
| PR opened / synced against `main` | PR title | `pr-title-lint.yaml` (humans only; bot-authored PRs skipped) | — |
| PR opened / synced against `main` | component path change | `ci.yaml` builds but does **not** push | — |
| Push to `main` | commits since last component tag | `ci.yaml` computes next `<ver>` from `git log` conventional-commit analysis (`feat:` → minor, `!:`/`BREAKING CHANGE:` → major, else patch), builds per-component images | image: `sha-<fullsha>` + `<ver>-rc.<ts>.<short>` |
| Push to `main` | commits since last component tag | `release-please.yaml` opens/updates one chore release PR per component whose path has a release-triggering commit | — |
| Merge of a release PR | | `release-please.yaml` cuts a GitHub Release with tag `<component>-v<ver>`, then `dispatch-publish` job workflow-dispatches the two release workflows below | release created |
| Release published (via dispatch) | release tag | `release-retag.yaml` waits for the `sha-<fullsha>` image of the release commit, then aliases it | image: `<ver>`, `latest` (retag — same digest, no rebuild) |
| Release published (via dispatch) | release tag | `helm-publish.yaml` packages `charts/<component>/` and pushes to OCI | chart: `hriv-<component>-<ver>.tgz` |

**The chart is published only on release.** Main pushes never produce a
chart artifact. This is the single biggest asymmetry in the system and
matters for the flux-fleet flow below.

## Tag and version formats

| Thing | Format | Example | Notes |
|---|---|---|---|
| Image rc tag | `<ver>-rc.<14-digit UTC ts>.<7-char sha>` | `1.1.18-rc.20260414194220.b286051` | Valid SemVer prerelease. Timestamp exists for deterministic Flux `ImagePolicy` ordering (numerical). |
| Image release tag | `<ver>`, `latest` | `1.1.18`, `latest` | Produced by digest-retag, not rebuild. |
| Image immutable pointer | `sha-<40-char sha>` | `sha-b286051...` | Always published; survives across every retag. |
| Git release tag | `<component>-v<ver>` | `frontend-v1.1.18` | Cut by release-please. |
| Chart artifact | `ghcr.io/<owner>/<repo>/charts/hriv-<component>:<ver>` | `...charts/hriv-frontend:1.1.18` | OCI chart, one per release. |
| Display version (rendered) | `<ver>-rc.<short>` *or* `<ver>` | `1.1.18-rc.b286051` / `1.1.18` | Helm chart's `displayVersion` helper strips the timestamp from the image tag at deploy time. See `charts/<component>/templates/_helpers.tpl`. |

## Title → release-please

Release-please reads PR titles on `main` and uses them as the sole input
for whether to open a release PR and what version bump to apply. A title
that doesn't parse as a Conventional Commit is silently dropped (workflow
still exits 0, no release PR opens). `pr-title-lint` enforces the format
at the merge boundary for human PRs.

Full title rules and rationale: [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md#pr-titles-must-be-conventional-commits).

## flux-fleet side

Both environments in `bcit-tlu/flux-fleet` share the same
`OCIRepository`, `HelmRelease`, and chart (from `apps/hriv/base/`). They
differ only in the `ImagePolicy` regex and the `image.tag` value the
`ImageUpdateAutomation` writes into the env's `patch-<component>.yaml`.

### `latest` (staging)

```
OCIRepository            semver >=0.0.0
  url ghcr.io/…/charts/hriv-frontend
                │
                ▼  (polls every 5m; picks highest released chart)
HelmRelease
  chartRef → OCIRepository
  values.image.tag ← patch-frontend.yaml (set by ImageUpdateAutomation)
                │
                ▲  (rewrites image.tag whenever ImagePolicy
                │   points at a newer rc timestamp)
ImageUpdateAutomation (apps/hriv/latest)
                │
                └── ImagePolicy.hriv-frontend-latest
                       filter ^(\d+\.\d+\.\d+)-rc\.(\d{14})\.[a-f0-9]+$
                       extract $ts
                       policy numerical desc
```

**Net effect:** every main push ⇒ new rc image rolls out to `latest`
within one reconcile cycle, **but chart changes on `main` do not reach
`latest` until a release is cut.** The `latest` env always runs the
most recently released *chart* with the most recent rc *image*.

### `stable` (production)

Same picture as `latest`, but `ImagePolicy.hriv-frontend-stable` matches
only clean `<ver>` tags (regex `^\d+\.\d+\.\d+$`, semver ordering), so
`image.tag` tracks the highest released version. `stable` runs the most
recently released chart with the most recently released image — both
change only on release.

## Consequences worth knowing

- **Chart edits on `main` are invisible to `latest`.** If a PR changes
  only `charts/<component>/...` (e.g. adding an env var to a Deployment
  template), nothing in `latest` changes until the next release of that
  component is cut. The app image rc still builds and rolls out, but
  against the previously-released chart. Any new template logic the rc
  image relies on is simply missing in `latest` until a release happens.
  This is the asymmetry called out above.
- **Retag promotion preserves image identity.** `release-retag.yaml`
  does not rebuild on release; it creates a new OCI tag pointing at the
  *same manifest* as the `sha-<fullsha>` built on `main`. So the binary
  a `stable` pod runs is bit-identical to the rc built on `main` for
  that commit — only the displayed version string differs, because
  `APP_VERSION`/`VITE_APP_VERSION` are runtime-injected by Helm, not
  baked into the image (see `charts/<component>/templates/_helpers.tpl`
  `displayVersion` helper).
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

| Symptom | First place to look |
|---|---|
| No release PR opened after merging a `feat:`/`fix:` | release-please logs on the main-push workflow; check that the component path was touched |
| `release-please` workflow failing with "Stale `release-as`" | `release-please-config.json` — remove the `release-as` field for the named package |
| `latest` env not picking up a new main push | `ImagePolicy.hriv-<component>-latest` status; verify a tag matching the rc regex was actually pushed |
| `latest` env running stale chart logic | no release has been cut since the chart edit; cut one |
| Image retag didn't happen after release | `release-retag.yaml` run for the release; it waits up to 30 min for the rc image, then times out |
| Chart artifact missing for a release | `helm-publish.yaml` run for the release tag; parse step rejects malformed tags |
