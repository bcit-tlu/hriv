# Product and UI decisions

Rulings by the product owner that are not derivable from the code. They are
conventions, not suggestions: a change that contradicts one needs an explicit
decision first. Each entry links to the feature doc where the behaviour is
specified in detail.

## Access and visibility

- Only admins can see or download source images; instructors and students
  never can. See [`category-visibility-and-programs.md`](category-visibility-and-programs.md).
- Program membership for OIDC users is driven by the OIDC group → program
  mapping (`Program.oidc_group`): login sync adds and removes mapped programs,
  while assignments to programs that have no `oidc_group` are manual and are
  preserved by sync. Do not add other automatic sources of membership.
  Programs and groups remain independent dimensions. See
  [`groups.md`](groups.md) and [`OIDC_SETUP.md`](OIDC_SETUP.md).
- Instructor-set collection visibility overrides student scope.
  See [`collections.md`](collections.md).

## Collections

- Student caps: at most 10 owned collections per type and at most 20 images
  in a student's sequence collection; admins and instructors are not capped.
  See [`collections.md`](collections.md).
- Concurrent edits use validate-then-compare-and-swap; no server-side sync of
  `hrivpref:` browser preferences.
- Annotations on collection member images are **shared**: they live on the
  image record and appear everywhere the image does — never stored
  per-collection or per-member. Editing them inside a collection viewer is
  gated on the auth `canEditContent` role gate (admin/instructor) — a
  student's `permissions.canEdit` on the collection grants curation, not
  image annotation rights (#1861, #1863). See
  [`collections.md`](collections.md).

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
- Detection tuning is a small **semantic** set (`DetectionTuning`:
  sensitivity, min cell size, exclude nuclei) persisted on the finding's
  `params`; raw `DetectorParams` constants never cross the API. The semantic
  defaults map exactly onto the shipped constants, so tuning is opt-in and
  `detector_version` stays put.
- Approval promotes `params` to `metadata.detection_params` even when the
  reviewer corrected scale or objective — tuning describes detection, not
  the promoted value, so a correction never holds it back. Reset removes it
  only while the stored value still equals the finding's `params` (#1869).
- Counting preprocessing (#1870) ships as a subtractive flat-field behind
  one ops-level boolean `counting_preprocess` — deliberately the only
  knob; per-image tuning arrives only via `metadata.detection_params`.
  Division flat-field and percentile stretch were evaluated and rejected
  (noise amplification; Otsu-invariance). `scripts/counting_regress.py`
  diffs masks/counts across variants on a small corpus — the safety net
  for any future preprocessing change.

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
- Announcements (epic #1832) are one stream for every role: one bell with a
  peek + "See all", one page (one stream for all; admins/instructors add filter chips incl. "My announcements"), one composer
  dialog. Release notes are announcements (`kind=release`, default audience
  `staff`), not a separate changelog surface. The Admin page has no Changelog tab.
- Only posts flagged `banner` take the app-bar banner slot (warnings first, then
  pinned, then newest); closing the banner marks the post seen. The Home
  **Notices** shelf shows at most three pinned posts; the welcome message (#1655)
  is a seeded pinned `everyone` announcement, not bespoke UI.
- Announcements are _seen_, never dismissed: the Inbox is the record; an edit
  only resurfaces a post when the author ticks "Notify readers again" (a full
  reset: unseen for everyone, back in every bell and banner slot). The
  Announcements page never auto-marks the viewer's _own_ posts seen, so authors
  see their banner and bell entry exactly as readers do until they dismiss them.
- Announcement kind is a controlled icon set and the icon _is_ the kind
  (Release and Warning are admin-only); emoji are reactions only. "Seen by N
  of M" shows counts to admin/instructor/staff only, never names.
- Mouse click-to-zoom is disabled in the image viewer — user testing found it
  useless, and it would fire on every laser-pointer/ink click. Scroll, pinch
  and touch double-tap zoom remain. The zoom +/- toolbar buttons stay in
  normal view but hide in full-page mode (#1877).
- Presentation pointer tools (laser pointer, freehand ink) exist only in OSD
  full-page mode, are available to every role, and are strictly ephemeral:
  ink fades ~10s after each stroke and is never persisted to image metadata,
  share links, or exports (#1876).

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
