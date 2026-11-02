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

## API

All endpoints require **admin or instructor** (`require_role("admin",
"instructor")`).

| Method | Path                                     | Behaviour                                                                                                                                               |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/measurement-findings/scan`         | `{limit: 1–50 (default 10), category_id?}`. Picks the next images with no `measurement_scale` and no non-superseded finding, queues detection. 202.     |
| GET    | `/api/measurement-findings`              | `status` (default `pending`), `category_id`, `min_confidence`, `sort` (`confidence_desc` default, `confidence_asc`, `created_desc`), `limit`, `offset`. |
| POST   | `/api/measurement-findings/{id}/approve` | Optional `{scale, unit}` correction. Promotes into metadata. 409 if not pending, 422 if no scale.                                                       |
| POST   | `/api/measurement-findings/{id}/reject`  | Marks rejected; metadata untouched. The image is not proposed again.                                                                                    |
| POST   | `/api/measurement-findings/approve`      | Bulk `{ids: [...]}` (≤200) at the proposed scale; returns `{approved, skipped}`.                                                                        |

Scans run as the `measurement_scan_task` arq job (one transaction per image;
images that gained a scale since queueing are skipped, and an overlapping scan's
duplicate pending finding is dropped)
and fall back to in-process `BackgroundTasks` when the queue is unavailable
(503 in `TASK_EXECUTION_MODE=required`).

## Approval semantics

Approval merges only these keys into `Image.metadata_`; annotations, overlays
and every other key are preserved:

| Key                        | Value                                                     |
| -------------------------- | --------------------------------------------------------- |
| `measurement_scale`        | Approved px/µm                                            |
| `measurement_unit`         | `um`                                                      |
| `measurement_scale_source` | Finding `source` (e.g. `rbc`), or `manual` when corrected |
| `measurement_finding_id`   | The approved finding                                      |

The image `version` is incremented (so stale viewer `If-Match` saves get 409)
and the browse revision is bumped when the image is categorized or in a
collection.

Replacing an image's source supersedes all its findings, so the replacement
becomes eligible for a fresh scan.

Pyramidal SVS/TIFF uploads keep getting `measurement_scale` automatically from
embedded MPP; scans skip images that already have a scale.

## Review page

**Manage → Measurement review** (`?page=measurement`, Admins and Instructors)
lists findings from `GET /api/measurement-findings`:

- **Pending / Approved / Rejected** tabs; pending is the default, sorted by
  confidence (highest first, click the column header to flip).
- **Scan next 10** calls `POST /api/measurement-findings/scan` with
  `limit: 10`; findings appear after **Refresh** once the worker finishes.
- Each pending row shows the thumbnail, name and size, objective, an editable
  proposed scale, confidence, and an evidence summary (RBC diameter and cell
  count, or the detector's reason for not proposing). Approving an edited
  scale sends it as the correction; findings with no proposal need a manual
  value before **Approve** enables and cannot be bulk-selected.
- **Approve selected** calls the bulk endpoint; skipped IDs are reported.
- Approved and Rejected views are read-only.

## Not yet built

- Upload hook that creates a pending finding for each new image.
- Stage-micrometer calibration constants.
