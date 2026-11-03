# Measurement review

Most HRIV images have no `measurement_scale`, so the viewer's measuring tool
cannot report real units. Measurement review proposes a scale for each image
as a **finding**, and an admin or instructor approves, corrects, or rejects it.
Nothing is written to image metadata until a finding is approved.

## Model

`measurement_findings` (migration `0037_measurement_findings`):

| Column                            | Notes                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `image_id`                        | FK `images.id`, `ON DELETE CASCADE`                                                   |
| `status`                          | `pending` → `approved` / `rejected`; a rescan marks the old pending row `superseded`  |
| `source`                          | How the value was found (`rbc` today)                                                 |
| `proposed_scale`, `proposed_unit` | Pixels per µm in source pixels, unit `um`; `NULL` scale when nothing could be found   |
| `objective`                       | Objective class picked from the camera profile (`10`, `40`, `100`), or `NULL`         |
| `confidence`                      | 0–1; the review list sorts on it                                                      |
| `evidence`                        | JSONB: measured RBC diameter, cell counts, peak share, class distances, or a `reason` |
| `detector_version`                | Bumped whenever the detector or calibration constants change                          |
| `approved_scale`, `approved_unit` | Value actually promoted (may differ from the proposal when the reviewer corrected it) |
| `reviewed_by`, `reviewed_at`      | Reviewer (FK `users.id`, `ON DELETE SET NULL`) and time                               |

At most one `pending` finding exists per image (partial unique index
`uq_measurement_findings_pending_image`).

## Detector: red blood cells as a ruler

`app/measurement/detector.py` (pure libvips) segments pink, non-nuclear cells,
fills their central pallor, and takes each component's inscribed radius. The
area-weighted mode of those radii is the dominant RBC diameter, which is
robust to clumps and rouleaux.

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

| Method | Path                                      | Behaviour                                                                                                                                                                                            |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/measurement-findings/scan`          | `{limit: 1–50 (default 10), category_id?}`. Picks the next images with no non-superseded finding (scaled or not), queues them. 202.                                                                  |
| GET    | `/api/measurement-findings`               | `status` (default `pending`), `category_id`, `min_confidence`, `sort` (`confidence_desc` default, `confidence_asc`, `created_desc`), `limit`, `offset`.                                              |
| POST   | `/api/measurement-findings/{id}/approve`  | Optional `{scale, unit}` correction (`unit`: `um`, `nm`, `mm`, `cm`). Promotes into metadata. 409 if not pending or the image already has a scale (the finding is then superseded), 422 if no scale. |
| GET    | `/api/measurement-findings/scan-progress` | `image_ids` (repeated, 1–200) from a scan response; returns `{total, done}` where done = images with a live finding, or deleted.                                                                     |
| POST   | `/api/measurement-findings/{id}/reject`   | Marks rejected; metadata untouched. The image is not proposed again.                                                                                                                                 |
| POST   | `/api/measurement-findings/approve`       | Bulk `{ids: [...]}` (≤200) at the proposed scale; returns `{approved, skipped}`; findings on already-scaled images are superseded and skipped.                                                       |

Scans run as the `measurement_scan_task` arq job (one transaction per image;
an overlapping scan's duplicate pending finding is dropped)
and fall back to in-process `BackgroundTasks` when the queue is unavailable
(503 in `TASK_EXECUTION_MODE=required`).

## Approval semantics

Approval merges only these keys into `Image.metadata_`; annotations, overlays
and every other key are preserved:

| Key                        | Value                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| `measurement_scale`        | Approved px/µm                                                                  |
| `measurement_unit`         | `um` unless the reviewer picked `nm`, `mm` or `cm`                              |
| `measurement_scale_source` | Finding `source` (e.g. `rbc`), or `manual` when the scale or unit was corrected |
| `measurement_finding_id`   | The approved finding                                                            |

The image `version` is incremented (so stale viewer `If-Match` saves get 409)
and the browse revision is bumped when the image is categorized or in a
collection.

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

Metadata is not changed. Pending findings on images that have since gained a
scale are hidden from the Pending list, and approving one returns 409 (bulk:
skipped) and marks it `superseded`, so a proposal can never overwrite a stored
value.

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
- A short purpose statement heads the page: the tool sets image scales so
  students can measure in real units.
- **Scan next 10** calls `POST /api/measurement-findings/scan` with
  `limit: 10`, then a snackbar ("Scanning images: N of 10 done", with a
  progress bar) polls `scan-progress` every 2 s. When every image is done the
  list reloads and "Scan finished" is shown; the scan button stays disabled
  meanwhile. A progress error ends tracking and is shown as an error.
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
- **Approve selected** calls the bulk endpoint for unedited rows and approves
  rows with a scale or unit correction one by one; skipped IDs are reported.
- Approved and Rejected views are read-only.

## Not yet built

- Upload hook that creates a pending finding for each new image.
- Stage-micrometer calibration constants.
