# Product and UI decisions

Rulings by the product owner that are not derivable from the code. They are
conventions, not suggestions: a change that contradicts one needs an explicit
decision first. Each entry links to the feature doc where the behaviour is
specified in detail.

## Access and visibility

- Only admins can see or download source images; instructors and students
  never can. See [`category-visibility-and-programs.md`](category-visibility-and-programs.md).
- Program membership comes from the OIDC group → program mapping
  (`Program.oidc_group`), never from manual assignment; programs and groups
  remain independent dimensions. See [`groups.md`](groups.md) and
  [`OIDC_SETUP.md`](OIDC_SETUP.md).
- Instructor-set collection visibility overrides student scope.
  See [`collections.md`](collections.md).

## Collections

- Student caps: at most 10 owned collections per type and at most 20 images
  in a student's sequence collection; admins and instructors are not capped.
  See [`collections.md`](collections.md).
- Concurrent edits use validate-then-compare-and-swap; no server-side sync of
  `hrivpref:` browser preferences.

## Measurement review

- Detector findings are promoted to `measurement_scale` / `measurement_unit`
  only when a reviewer approves them (optionally corrected); nothing is
  written automatically.
- Existing values are authoritative (very high confidence): never re-detected
  or overwritten. `objective_power` is authoritative once present; approval
  writes it only when absent and records ownership in
  `measurement_findings.approved_objective` so a reset can undo it.
- Objective ↔ scale auto-coordination exists only in Measurement review; Edit
  image keeps the two fields independent. Review and Edit image share one
  scale + unit component. See [`measurement-review.md`](measurement-review.md).

## UI conventions

- Colours come from theme palette tokens, never hard-coded, except the
  approved static OpenSeadragon active/pressed SVG fills.
- Sentence-case headings; copy says "categorize", not "file".
- Controls the user cannot use are hidden, not rendered translucent.
- Buttons are themed MUI `Button`s, not pill `Fab`s.
- On viewer pages at the `md` breakpoint and up, the OpenSeadragon viewer is
  the only flexible element; tile sizes never jump while resizing (fixed
  minimum, then scroll). Plans for layout changes state concrete pixel values.
- Expand/collapse motion scrolls first, then animates.
- Tables use plain-text name cells with row click; view toggles show icon and
  label.
- Chromatic: frontend PRs include stories; baselines are accepted by the
  product owner; no white icon backgrounds.

## Telemetry

- Observability is recorded consistently across pages (same attributes,
  same event shapes). See [`observability-conventions.md`](observability-conventions.md).
- The `error_message` sanitizer uses a narrow DZI allowlist (`TileSize`,
  `Overlap`, `Format`, `Width`, `Height`) rather than redacting every
  `key=value`; frontend and backend sanitizers stay identical.

## Documentation for end users

- Brief, visual, friendly to non-technical readers; editable Markdown
  integrated into the app rather than a separate site.

## Delivery

- Epics that span releases ship trunk-based behind a chart-level runtime flag
  (env var, default off, enabled on `latest` first) and the flag is removed by
  the epic's closing issue. The SPA reads flags from `GET /api/features`.
