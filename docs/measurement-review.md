# Measurement review

Most HRIV images have no `measurement_scale`, so the viewer's measuring tool
cannot report real units. Measurement review proposes a scale for each image
as a **finding**, and an admin or instructor approves, corrects, or rejects it.
Nothing is written to image metadata until a finding is approved.

## Model

`measurement_findings` (migration `0037_measurement_findings`):

| Column                            | Notes                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `image_id`                        | FK `images.id`, `ON DELETE CASCADE`                                                                                        |
| `status`                          | `pending` ↔ `approved` / `rejected` (reset returns to pending); a rescan marks the old live rows `superseded`              |
| `source`                          | How the value was found (`rbc` today)                                                                                      |
| `proposed_scale`, `proposed_unit` | Pixels per µm in source pixels, unit `um`; `NULL` scale when nothing could be found                                        |
| `objective`                       | Objective class picked from the camera profile (`10`, `40`, `100`), or `NULL`                                              |
| `confidence`                      | 0–1; the review list sorts on it                                                                                           |
| `evidence`                        | JSONB: measured RBC diameter, cell counts, peak share, class distances, or a `reason`                                      |
| `params`                          | JSONB, nullable: instructor-tuned detection values (`DetectionTuning`); `NULL` means the shipped defaults apply            |
| `detector_version`                | Bumped whenever the detector or calibration constants change                                                               |
| `approved_scale`, `approved_unit` | Value actually promoted (may differ from the proposal when the reviewer corrected it)                                      |
| `approved_objective`              | Objective the approval wrote to `objective_power` (migration `0039_finding_approved_objective`); `NULL` when it wrote none |
| `reviewed_by`, `reviewed_at`      | Reviewer (FK `users.id`, `ON DELETE SET NULL`) and time                                                                    |

At most one `pending` finding exists per image (partial unique index
`uq_measurement_findings_pending_image`).

## Detector: red blood cells as a ruler

`app/measurement/detector.py` (pure libvips) segments pink, non-nuclear cells,
fills their central pallor, and takes each component's inscribed radius. The
area-weighted mode of those radii is the dominant RBC diameter, which is
robust to clumps and rouleaux.

The detector's constants live on `DetectorParams` (threshold vs. the median
background saturation, the purple-nuclei hue/saturation window, the minimum
component radius, and the mode window). `DetectorParams()` reproduces the
shipped behaviour bit-for-bit, so parametrising did not bump
`DETECTOR_VERSION`. Callers tune through `DetectionTuning` (schemas.py) — a
small semantic set (`sensitivity`, `min_cell_size`, `exclude_nuclei`, plus an
`advanced` raw-override dict for API use) that `to_detector_params()`
translates; raw constants never cross the API.

`app/measurement/calibration.py` turns that diameter into a scale:

- **Known camera** (2880×2048, or 1440×1024 binned): ~86% of the `stable`
  library comes from one microscope camera, so the scale is one of a few
  objective constants. The detector picks the nearest objective in log space
  and proposes that objective's constant.
- **Unknown camera** (phone/DSLR through the eyepiece): the raw estimate
  (diameter ÷ 7.5 µm) is proposed with confidence capped at 0.3, so these
  always need a reviewer.

Confidence = peak share × cell-count factor × objective margin, halved when the
measurement is more than 1.5× (or under 1/1.5×) the nearest objective's scale.

> **Provisional constants.** The per-objective px/µm values are averages of
> RBC-size clusters on images whose notes name the objective. They will be
> replaced with stage-micrometer measurements; bump `DETECTOR_VERSION` when
> they change.

Validation on 36 labelled camera images: findings with confidence ≥ 0.4 picked
the right objective 25/26 times (96%); ≥ 0.5 picked it 24/24 times. The misses
all scored below 0.42.

Radiography and other non-microscopy images get a low-confidence finding or no
RBC population (`evidence.reason = "no_rbc_population"`); reviewers reject
them.

An RBC population needs at least 10 connected components overall and at least
10 inside the dominant size window. A few large blobs outweighing many small
ones (for example a landscape photo) records `no_rbc_population` with no
proposed scale, rather than a 0%-confidence proposal.

## API

All endpoints require **admin or instructor** (`require_role("admin",
"instructor")`).

| Method | Path                                       | Behaviour                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/measurement-findings/scan`           | `{limit: 1–50 (default 10), category_id?, rescan?, all?}`. Picks images with no non-superseded finding (scaled or not) and queues them in chunks of 50. `rescan` instead picks unscaled images with no live finding from the current `DETECTOR_VERSION` (never-scanned or stale-detector) and supersedes their old findings when processed. `all` ignores `limit` and queues every candidate. 202. |
| GET    | `/api/measurement-findings`                | `status` (default `pending`), `category_id`, `min_confidence`, `sort` (`confidence_desc` default, `confidence_asc`, `created_desc`, or `name`/`category`/`objective`/`proposed` with `_asc`/`_desc`; ties sort by image name), `limit`, `offset`. Each item carries `category_path` (e.g. `Hematology › Blood films`, `null` when uncategorized).                                                  |
| GET    | `/api/measurement-findings/categories`     | `status` (default `pending`); returns `[{id, path, count}]` for categories holding findings in that status, ordered by path — feeds the review page's Category filter.                                                                                                                                                                                                                             |
| POST   | `/api/measurement-findings/{id}/approve`   | Optional `{scale, unit, objective}` correction (`unit`: `um`, `nm`, `mm`, `cm`; `objective`: `4`, `10`, `20`, `40`, `50`, `60`, `100` or `null` for none — omitted keeps the detected objective). Promotes into metadata. 409 if not pending or the image already has a scale (the finding is then superseded), 422 if no scale.                                                                   |
| POST   | `/api/measurement-findings/{id}/reject`    | Marks rejected; metadata untouched. The image is not proposed again (a rescan overrides).                                                                                                                                                                                                                                                                                                          |
| POST   | `/api/measurement-findings/{id}/reset`     | Returns an approved or rejected finding to `pending` and clears `reviewed_by`/`reviewed_at`. Reverting an approval whose stored scale is still the promoted value also removes the four measurement keys from `Image.metadata_` and bumps `Image.version`; a scale changed since is left alone. 409 if not reviewed or another pending finding already exists for the image.                       |
| POST   | `/api/measurement-findings/{id}/rescan`    | Queues a re-detection of the finding's image; the scan supersedes all its live findings. 202.                                                                                                                                                                                                                                                                                                      |
| GET    | `/api/measurement-findings/scan-progress`  | `image_ids` (repeated, 1–200) from a scan response; returns `{total, done}` where done = images with a live finding, or deleted. `min_finding_id` counts only newer findings, so a rescan can be tracked past the row it supersedes.                                                                                                                                                               |
| GET    | `/api/measurement-findings/scan-remaining` | `rescan`, `category_id`; returns `{remaining}`, the count of scan candidates still unprocessed — progress for whole-library scans.                                                                                                                                                                                                                                                                 |
| POST   | `/api/measurement-findings/approve`        | Bulk `{ids: [...]}` (≤200) at the proposed scale; returns `{approved, skipped}`; findings on already-scaled images are superseded and skipped.                                                                                                                                                                                                                                                     |

Scans run as the `measurement_scan_task` arq job (one transaction per image;
an overlapping scan's duplicate pending finding is dropped). A scan is split
into jobs of 50 images so a whole-library pass churns through the queue in
parallel without one job holding a worker slot for hours; a rescan passes
`rescan=true` so the worker supersedes reviewed findings instead of stopping
at them. Scans fall back to in-process `BackgroundTasks` when the queue is
unavailable (503 in `TASK_EXECUTION_MODE=required`).

## Approval semantics

Approval merges only these keys into `Image.metadata_`; annotations, overlays
and every other key are preserved:

| Key                        | Value                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| `measurement_scale`        | Approved px/µm                                                                  |
| `measurement_unit`         | `um` unless the reviewer picked `nm`, `mm` or `cm`                              |
| `measurement_scale_source` | Finding `source` (e.g. `rbc`), or `manual` when the scale or unit was corrected |
| `measurement_finding_id`   | The approved finding                                                            |

When the image has no `objective_power` yet, approval also writes the
finding's objective (or the reviewer's corrected one) as a float, e.g. `40.0`,
and records it in `approved_objective`. An `objective_power` already on the
image — embedded SVS/TIFF metadata or an Edit image value — is authoritative
and never overwritten. Bulk approval writes each finding's detected objective
under the same rule. Resetting the approval removes `objective_power` only
when `approved_objective` is set and the stored value still matches it.

Finding responses include `approved_objective` and `objective_scales`, the
calibrated px/µm per objective for the image's camera profile (`null` for
unknown cameras), so the review page can coordinate objective and scale.

The image `version` is incremented (so stale viewer `If-Match` saves get 409)
and the browse revision is bumped when the image is categorized or in a
collection.

An approved scale also calibrates **object counting**: the counts router
derives `mpp = unit / measurement_scale` whenever `mpp_x` is absent
(`app/counting/mpp.py`), so approved measurements feed InstanSeg
`pixel_size` and the mpp-driven nuclei level rule instead of the 0.5
µm/px default.

Resetting an approved finding reverses that promotion: while the stored
scale is still exactly the value the finding approved (`measurement_scale`,
`measurement_unit` and `measurement_finding_id` all matching), the four keys
are removed and `version` incremented again. A scale changed since — by Edit
image, a newer finding, or tooling — is authoritative and kept; the finding
still returns to pending but stays hidden there while a scale exists.

Replacing an image's source supersedes all its findings, so the replacement
becomes eligible for a fresh scan.

Pyramidal SVS/TIFF uploads keep getting `measurement_scale` automatically from
embedded MPP.

## Existing scales are authoritative

A scan never re-detects an image that already has a numeric `measurement_scale`
(including one set while the scan was queued). Instead it records an
**approved** finding with confidence `1.0`, the stored scale and unit as both
proposed and approved values, `reviewed_by = null`, evidence
`{"reason": "existing_scale", "scale_source": …}`, and source:

- `embedded` when the metadata carries `mpp_x` (pyramid calibration);
- `existing` otherwise (Edit image, import, earlier tooling).

Metadata is not changed. Recording the stored scale also supersedes any older
pending proposal, and the image row is locked so overlapping scans record it
once. Pending findings on images that have since gained a
scale are hidden from the Pending list, and approving one returns 409 (bulk:
skipped) and marks it `superseded`, so a proposal can never overwrite a stored
value. A rescan supersedes the image's live findings first, so even a scaled
image gets a fresh `existing_scale` record stamped with the current
`detector_version`.

## Whole-slide images

The RBC detector works on a ≤2000 px thumbnail, so on slide scans (longest side

> 8000 px) cells vanish and tissue structures get measured instead. Those images
> get a pending finding with no proposal and reason `slide_too_large_for_rbc`;
> they need a manual value until a slide-specific method exists.

## Review page

**Manage → Measurement review** (`?page=measurement`, Admins and Instructors)
lists findings from `GET /api/measurement-findings`:

- **Pending / Approved / Rejected** tabs; pending is the default, sorted by
  confidence (highest first, click the column header to flip).
- **Image**, **Category**, **Detected objective**, **Proposed** and
  **Confidence** headers sort server-side across all pages (first click
  ascending, except Confidence which starts highest first; click again to
  flip). Ties fall back to image name, so sorting by Category groups a
  category's images in a stable order. Scale, Evidence and Actions are not
  sortable.
- A **Category** column shows each image's full category path
  (`Parent › Child`) or "Uncategorized", and a **Category** filter beside the
  tabs limits the list to one category (options come from
  `GET /api/measurement-findings/categories`, with finding counts).
- Scan next 10, Scan all, Re-scan outdated and Refresh live in an **Actions**
  menu at the top right; **Approve selected** stays a separate button.
- A one-line purpose statement heads the page, with a **Learn more** link
  opening a dialog covering the workflow and how confidence is calculated.
- **Scan next 10** calls `POST /api/measurement-findings/scan` with
  `limit: 10`, **Scan all** (a one-time bulk action) calls it
  with `all: true` to queue the whole library in the background, and
  **Re-scan outdated** calls it with
  `all: true, rescan: true` to re-detect images whose findings predate the
  current detector (use after a detector or calibration change bumps
  `DETECTOR_VERSION`). A snackbar ("Scanning images: N of M done", with a
  progress bar) polls `scan-progress` for small scans or `scan-remaining`
  for whole-library scans every 2 s. When every image is done the
  list reloads and "Scan finished" is shown; the scan buttons stay disabled
  meanwhile. A progress error ends tracking and is shown as an error. After 10 minutes
  with no progress (a busy queue or stopped worker) tracking stops with a
  notice to use **Refresh**; the scan itself may still finish.
- Each row's thumbnail opens the image in the viewer and its name opens the
  Edit image dialog (where manual scale values live).
- Each pending row shows the thumbnail, name and size, the **detected
  objective** (the ×10/×40/×100 objective lens matched for the known camera;
  a tooltip explains it), the read-only **proposed** scale in px/µm, an
  editable **scale** with a **unit** picker (µm, nm, mm, cm; µm by default),
  confidence, and an evidence summary (RBC diameter and cell count, the
  detector's reason for not proposing, or "existing value" / "embedded
  calibration" for stored scales). Approving an edited scale or unit
  sends it as the correction; findings with no proposal need a manual value
  before **Approve** enables and cannot be bulk-selected.
- The scale and unit fields are the shared `MeasurementScaleFields`
  component, also used by the Edit image dialog's Measurement Settings.
- The detected objective is an editable `MeasurementObjectiveSelect` dropdown
  (None, ×4, ×10, ×20, ×40, ×50, ×60, ×100). On a known camera, picking an
  objective fills in its calibrated scale and resets the unit to µm; on an
  unknown camera the scale is left as is. A changed objective is sent as the
  `objective` correction. Approved rows show the objective the approval wrote.
- **Approve selected** calls the bulk endpoint for unedited rows and approves
  rows with a scale or unit correction one by one; skipped IDs are reported.
- Approved and Rejected rows carry a **Reset** action that returns the
  finding to the review queue; reverting an approval also removes the scale
  it wrote when it is still the stored value. Per-image re-detection is
  available via `POST /api/measurement-findings/{id}/rescan` (not surfaced
  in the UI — use Re-scan outdated for bulk re-detection).

## Scans after upload and replacement

When `process_source_image` (single and bulk uploads) or
`process_replace_image` finishes and commits, it calls
`scan_after_processing(image_id)`. That enqueues a one-image
`measurement_scan_task`, or runs the scan inline when the queue is unavailable
in `local` mode. The scan follows the usual rules: an SVS/TIFF calibration
written during processing becomes an approved `embedded` finding, and anything
else gets a pending RBC finding (or no proposal, with a reason). It is
best-effort: a failure is logged as `measurement.upload_scan_failed` and never
fails the upload; the image just stays eligible for **Scan next**.

## Not yet built

- Stage-micrometer calibration constants (#1743).
