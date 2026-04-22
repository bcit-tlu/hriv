# Contributing

## PR titles must be Conventional Commits

GitHub links this file automatically from the "Open a pull request" UI,
so please skim it before titling your first PR.

### Required structure

```
<type>[optional scope][!]: <subject>
```

- `<type>` — one of the allowed types below
- `[optional scope]` — `(frontend)` / `(backend)` / `(backup)` / etc.
- `[!]` — mark a breaking change (alternatively, put `BREAKING CHANGE:` in the PR body)
- `<subject>` — imperative mood, lowercase first letter, no trailing period

### Allowed types

Release-triggering:

- `feat` — new user-facing feature → **minor** version bump
- `fix` — user-facing bug fix → **patch** version bump

Non-release-triggering (still required to land, but don't open a release PR):

- `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

### Examples

Good:

```
feat(frontend): add bulk-edit dialog for images
fix(backend): prevent OIDC login loop on expired token
refactor(backup): split restore pipeline into composable steps
feat(backend)!: drop legacy /v1 endpoints
```

Bad (why):

```
New release2                   # no type — release-please drops this silently
Add bulk edit                  # no type
feat: Add bulk edit            # subject starts with uppercase
Feat(frontend): add bulk edit  # type must be lowercase
update stuff                   # no type, vague
```

### Why the structure matters (tl;dr)

The repo uses
[release-please](https://github.com/googleapis/release-please)
to cut GitHub Releases, bump versions, and write CHANGELOGs. It derives
all three entirely from the PR titles on `main`.

- A `feat:` or `fix:` title → release-please opens a chore release PR that,
  when merged, bumps the version and publishes a Release.
- A title that fails to parse as a Conventional Commit → release-please
  silently drops it. No release PR. No error. The workflow still exits 0.
- This has bitten us: PRs like `New release2 (#185)` and
  `adds draft to release-please (#184)` are invisible to release-please
  forever. Any release intent behind them is lost.

The `pr-title-lint` check (workflow:
[`.github/workflows/pr-title-lint.yaml`](workflows/pr-title-lint.yaml))
gates titles at the merge boundary so non-conformant titles can't land
and starve the release pipeline.

### If the lint fails

The check posts a comment on your PR with the specific failing reason
(unknown type / uppercase subject / missing `:` / etc.) and a link back
to this file. Edit the PR title in the GitHub UI and the check re-runs
automatically within seconds — no need to push a new commit.

### Further reading

- Full Conventional Commits spec: <https://www.conventionalcommits.org/en/v1.0.0/>
- release-please commit parser:
  <https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-conventionalcommits>
