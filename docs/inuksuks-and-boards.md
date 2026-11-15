# Inuksuks and Boards

Inuksuks bookmark an image's exact viewport coordinates, zoom, and rotation.
Boards curate shared Inuksuks into ordered, one-level sections. Migration
`0046_inuksuks_and_boards` introduces the additive schema; thumbnails and
read access follow in #1767/#1768, with creation and UI in subsequent issues
of epic #1765.
See the [domain model](domain-model.md) for fields and deletion rules.

## Feature flag (`INUKSUKS_ENABLED`)

- Backend `Settings.inuksuks_enabled` reads `INUKSUKS_ENABLED`, default
  `false`. `GET /api/features` exposes `inuksuks: bool`.
- Pure ASGI `InuksuksFeatureMiddleware` returns `404 {"detail":"Not Found"}`
  for `/api/boards`, `/api/inuksuks`, and their slash-delimited descendants
  while disabled, before authentication or body parsing. Maintenance takes
  precedence (503). Other paths and non-HTTP scopes pass through.
- `require_inuksuks_enabled` in `app/inuksuks.py` is the secondary
  router-level dependency for subsequent routers. Enabling the flag alone
  exposes the read and write endpoints below.
- Helm `inuksuks.enabled: false` renders `INUKSUKS_ENABLED` on the API
  Deployment. Enable it explicitly in deployment overlays for incremental
  testing; leave it off elsewhere until the epic ships.
- Docker Compose defaults `INUKSUKS_ENABLED=true` for local development;
  override it with `INUKSUKS_ENABLED=false` to exercise the dark-launch gate.

## Verification

`backend/tests/test_inuksuks.py` covers metadata and pre-parser feature gating;
`backend/tests/test_inuksuks_db.py` uses `TEST_DATABASE_URL` against migrated
PostgreSQL for cascades and user-deletion cleanup.

## Settled access model

Every Inuksuk belongs to at least one Board. Boards follow Collections
visibility: admins, instructors, and staff see all; students see their own,
public, and restricted Boards that pass both program and group gates.
An Inuksuk requires a visible image; students additionally must own the
Inuksuk or see at least one of its Boards. Non-students can view all
Inuksuks. The read API enforces these rules; the thumbnail generator itself
does not perform authorization or create endpoints.

## Viewport thumbnails

`app.inuksuk_thumbs.generate_inuksuk_thumbnail(image, inuksuk_id, x, y, zoom,
rotation)` is synchronous CPU-bound pyvips work, suitable for
`asyncio.to_thread`. It reads a local `/api/tiles/<source_id>/image.dzi`
pyramid, reuses the counting stitcher's level planner and tile compositing,
and writes `TILES_DIR/<source_id>/inuksuks/<inuksuk_id>.jpg`: 320×240 JPEG,
quality 82. Its return value is the relative API URL
`/api/tiles/<source_id>/inuksuks/<inuksuk_id>.jpg` for `Inuksuk.thumb`.
Missing or external pyramids return `None`; callers fall back to `Image.thumb`.
Malformed manifests and missing intersecting tiles raise rather than silently
substituting unrelated content.

Both viewport axes use image width: the centre is `(x*W, y*W)` and the
4:3 window has full-resolution width `W/zoom`. The coarsest DZI level
still providing at least 320 crop pixels is selected (full resolution if
necessary). Out-of-bounds space is padded, never shifted inward, with
`#212121`, matching the viewer container's MUI `grey.900` background.
For clockwise OSD rotations the pre-crop is a square expanded by √2 of
the window's longer side; this also avoids clipping the 4:3 rectangle
at arbitrary angles. Invalid/nonfinite geometry and excessive decode
sizes raise `ValueError`. The shared 25-million-pixel guard applies.
Writes use a unique temporary JPEG and atomic replacement.

Use `append_inuksuk_thumb_token(url)` when serializing these URLs after
image and Board visibility checks. It derives the Inuksuk id from the URL
and mints `purpose="thumb"` with an integer `iid` claim, using
`issue_inuksuk_thumb_token(source_image_id, inuksuk_id)`. This token
authorizes only `inuksuks/<iid>.jpg` within that source image: not another
Inuksuk, `thumbnail.jpeg`, or DZI tiles. Plain `append_thumb_token`
tokens remain limited to `thumbnail.jpeg`, so hidden card-cover tokens
cannot reveal zoomed regions. The nginx verdict cache includes the exact
normalized URI for Inuksuk paths, preventing cached authorization from
crossing Inuksuk ids; the `tiles` class remains shared.

`remove_inuksuk_thumbnail` is the helper for future Inuksuk-delete routers.
Single/bulk image deletion removes the `inuksuks/` directory after commit.
Successful image replacement deletes the old image's Inuksuk records and
removes the old thumbnails only after commit; failed replacement preserves
both. Neither cleanup helper removes source tiles or whole-image thumbnails.

The API container already mounts `tiles-data` at `/data/tiles` when chart
persistence is enabled, with `TILES_DIR` supplied from chart values. No
mount change is needed for future API-side generation; generation is not
wired to create and geometry-update endpoints in #1769.

`backend/tests/test_inuksuk_thumbs.py` covers geometry, synthetic clockwise
rotation, padding, missing/corrupt tiles, and file lifecycle.

## Read API (#1768)

All four reads require an authenticated user and `INUKSUKS_ENABLED=true`.
The Board/Inuksuk routers use both the middleware and router dependency;
the image drawer route explicitly applies `require_inuksuks_enabled`
because it lives outside those middleware path prefixes. Flag-off returns
404 even before authentication.

| Endpoint                        | Response                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/boards`               | Visible Board summaries with owners, scope ids, permissions, visible `inuksuk_count` and cover thumbnail        |
| `GET /api/boards/{id}`          | Board summary plus ordered `sections` and visible `inuksuks`, each with per-Board `section_id` and `sort_order` |
| `GET /api/inuksuks`             | Visible Inuksuks, with owners, permissions, source tag and only their visible `board_ids`                       |
| `GET /api/images/{id}/inuksuks` | Drawer items tagged `mine`, `instructor`, or `public`, once each                                                |

Admins, instructors and staff see all Boards, including private Boards.
Students see Boards they own/co-own, public Boards, and restricted Boards
passing **both** the program and group gates; empty restrictions on a
dimension mean unrestricted. An invisible or nonexistent Board detail
(or explicit `board_id` filter) is 404, never 403.

Inuksuks require an **active image for students only**, matching image reads.
Students also pass the image category's inherited program/group/hidden-subtree gates,
even when they own the Inuksuk or it is on a public Board. With that image
gate satisfied, students need ownership of the Inuksuk or a visible Board
containing it; non-students need no further gate. This owner exception
permits an owner to retain access even if all its Boards are private to
someone else. `board_ids` never discloses those private Boards.
The drawer returns 404 for an invisible or nonexistent image.

Source tags have strict precedence:

1. `mine`: the caller is an Inuksuk owner.
2. `instructor`: a **visible** containing Board has an instructor/admin
   owner or an `owner_program`.
3. `public`: another user's Inuksuk is on a public Board.

Other visible Inuksuks have `source: null` in the Organize list and remain
reachable through Boards, but are omitted from the drawer. For example,
staff can see a student's private/restricted Board without its Inuksuks
appearing in the drawer. Drawer order is source precedence, then
Inuksuk `sort_order`, then id.

### Filtering, ordering and conditional requests

Board list search `q` is a case-insensitive literal substring of name,
description or owner label. `visibility` may be repeated. Board sorts:
`id`, `name`, `description`, `visibility`, `owner`, `inuksuk_count`,
`sort_order`, `created_at`, `updated_at`.

Inuksuk list filters: `board_id`, `section_id`, `image_id`, `favourite`,
and `scope=mine|instructor|public` (using the same precedence as drawer tags).
Board/section membership filters only match visible Boards. `q` searches
title/description. Inuksuk sorts: `id`, `title`, `description`,
`image_id`, `favourite`, `sort_order`, `created_at`, `updated_at`.

Both lists accept `order=asc|desc` (or Collections-compatible `direction`).
The default is `sort=updated_at` descending; text and explicit
`sort_order` sorts default ascending, magnitude/recency sorts descending.
Ties use id in the same direction. Filtering precedes pagination.
`page` requires `page_size` (1–200); `page_size` alone means page 1.
`limit` (1–100) cannot be combined with page parameters. Bad filters,
sorts or paging combinations return 422. Lists expose pre-slice
`X-Total-Count`; results are arrays, including empty arrays.

Reads carry weak content-derived ETags, `Cache-Control: private, no-cache`,
and support comma-separated/weak/strong `If-None-Match` comparison and
`*` for 304. Unlike Collections' revision shortcut, these are computed
after loading and filtering, so image/owner/scope changes cannot leave a
stale authorization result even before #1769 introduces write endpoints.
The fingerprint includes viewer memberships, query, filtered content,
total count and a token-TTL epoch. Token strings are excluded from the
content hash; the epoch forces renewal before cached thumbnail tokens
expire. Board membership, images and owners/scopes are eager-loaded in
batches, not queried per item.

### Capability predicates for upcoming writes

Board predicates reuse Collections' rules: admins manage all; instructors
edit/change scope/delete/transfer when owners/co-owners or members of the
owning program. Students/staff edit their own/co-owned Boards, but may
change scope/delete only as sole user-owner with no program owner, and
cannot transfer. Inuksuk edit/delete is granted to admins or any user-owner
(including co-owners); merely viewing an instructor/public Board does not
grant edit authority over someone else's Inuksuks. Permissions in read
responses are UX hints, not a substitute for checking future mutations.

Every thumbnail projection, including Board covers, uses only
`append_inuksuk_thumb_token` for a saved crop and `append_thumb_token`
for the image-thumbnail fallback, after image visibility checks.
No read projection issues a full tile token.

Verification: `test_board_authz.py` covers the role × visibility × dual-gate
and capability matrices; `test_board_reads.py` exercises PostgreSQL reads,
hidden/inactive image exclusion, drawer precedence, filtering/paging,
ETags, flag-off paths and token scoping.

## Write API (#1769)

All writes share the feature gate and authenticated-user dependency of the
read routers. Visibility is checked before authority: invisible ids return
404, visible resources the caller cannot edit return 403. Read projections
and permission fields are reused in write responses.

| Endpoint                                        | Body / result                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/boards`                              | `name`, optional `description`, `visibility`, `program_ids`, `group_ids`; 201 Board detail                                        |
| `PATCH /api/boards/{id}`                        | Same editable fields plus concurrency token; Board detail                                                                         |
| `DELETE /api/boards/{id}`                       | Concurrency header; 204, deletes orphaned Inuksuks and derived files                                                              |
| `PUT /api/boards/order`                         | `items: [{board_id, version}]`; ordered Board details                                                                             |
| `PUT /api/boards/{id}/owners`                   | `user_ids` and token; Board detail                                                                                                |
| `POST /api/boards/{id}/transfer`                | Required nullable `program_id` and token; Board detail                                                                            |
| `POST /api/boards/{id}/sections`                | `name`, optional `sort_order`, parent token; 201 Board detail                                                                     |
| `PATCH /api/boards/{id}/sections/{section_id}`  | `name` / `sort_order`, parent token; Board detail                                                                                 |
| `DELETE /api/boards/{id}/sections/{section_id}` | Parent concurrency header; 204; member `section_id` becomes null                                                                  |
| `PUT /api/boards/{id}/sections/order`           | `section_ids` containing all Board sections once, parent token; Board detail                                                      |
| `POST /api/inuksuks`                            | `image_id`, `title`, `x`, `y`, `zoom`, nonempty `board_assignments`; optional `description`, `rotation`, `favourite`; 201 Inuksuk |
| `PATCH /api/inuksuks/{id}`                      | Mutable create fields except `image_id`, plus token; Inuksuk                                                                      |
| `DELETE /api/inuksuks/{id}`                     | Concurrency header; 204 and thumbnail cleanup                                                                                     |
| `PUT /api/inuksuks/order`                       | `items: [{inuksuk_id, version}]`; ordered Inuksuks                                                                                |
| `PUT /api/inuksuks/{id}/owners`                 | Nonempty active-user `user_ids` and token; Inuksuk                                                                                |
| `PUT /api/boards/{id}/inuksuks/order`           | `items: [{inuksuk_id, section_id?}]`, parent token; Board detail                                                                  |
| `DELETE /api/boards/{id}/inuksuks/{inuksuk_id}` | Parent concurrency header; Board detail                                                                                           |

Every Inuksuk must have at least one Board link. Missing/empty
`board_assignments` on create is 422. Assignments contain `board_id`,
optional nullable `section_id`, and optional `sort_order`; new links
append by default. Duplicate Board assignments are 422. Every submitted
Board must be visible and editable; a section from another Board is 422.
Create checks image visibility using the same context as the drawer.
Coordinates/rotation must be finite; zoom must be positive.

An Inuksuk editor's assignment PATCH replaces **only editable-Board links**.
Uneditable-Board links retain their section and order unchanged, even if
omitted. An empty replacement is accepted only if such retained links keep
the Inuksuk on at least one Board; otherwise it is 422. Explicitly submitting
an uneditable Board is 403 (404 if invisible). Board editors can reorder or
remove someone else's Inuksuk from their own Board without gaining edit
authority over the Inuksuk itself. Board removal returns 422 for the last
link. Deleting a Board instead deletes any newly orphaned Inuksuks and cleans
their files after commit; shared Inuksuks and their thumbnails survive.

Board member reorder submits every **visible** member once. It may move
members between that Board's sections (null means unsectioned); invisible
members are preserved and appended, like hidden image retention in
Collections. Global Board/Inuksuk order endpoints update only the listed
editable rows, assigning zero-based order in submitted sequence. Empty
reorder lists are valid no-ops.

### Write concurrency, ownership and lifecycle

PATCH, owners, transfer, section mutations and Board-member mutations require
an integer `version` in the body or `If-Match: "<version>"`. DELETE uses the
header. Missing both returns **428**, malformed/conflicting header/body tokens
return 400, and atomic CAS mismatch returns **409** with the current read
projection in `detail`. Success returns the new integer version as the ETag.
Sections use their **parent Board's version**, not a separate section version;
their writes return Board detail (DELETE returns its new ETag).
Multi-row global reorder uses each item's `version`.
Collections currently requires body `version`; these endpoints retain that
format while also implementing the explicit If-Match/428 contract.

Board content, scope, deletion and transfer predicates remain the read API's
capabilities. Creating/changing restricted scope requires admin/instructor;
new program attachments require membership for instructors, and new group
attachments require instructor co-ownership of the group. Existing scope
may be retained/narrowed like Collections. Leaving restricted clears scope.
Board owners PUT uses Collections' transfer authority and active-user
validation; an empty owner set requires an owning program. Program transfer
clears user owners; clearing program ownership requires user owners to remain.
Inuksuk owners PUT requires Inuksuk edit authority and cannot remove all
owners. Students may own at most 10 Boards and 200 Inuksuks, including
co-ownership and owner additions; excess ownership is 422. Other roles have
no cap.

Writes lock Boards in id order before affected Inuksuks, recheck visibility
and edit authority, and use atomic version updates. A new parent linked
during graph-lock acquisition is 409 and must be retried. Student quota
checks lock target owners before resource locks. Membership changes advance
the affected aggregate versions. Mutations bump browse revision and are
covered by the existing HTTP audit middleware plus mutation logs.

Create and geometry PATCH take a shared Image row lock before Board and
Inuksuk locks; image replacement takes an exclusive Image row lock before
deleting the old Inuksuks. The geometry read and write therefore serialize
with replacement rather than inserting bookmarks into its deletion window.

The shared membership revision helper invalidates every affected Board on
assignment changes, Inuksuk deletion, user cleanup and image replacement or
deletion (before links cascade away). Old Board versions then return 409,
including when membership changes through an image endpoint rather than a
Board endpoint. Orphan deletion has no surviving membership to invalidate.

After create commits (id known), or a committed geometry change, thumbnail
generation runs through `asyncio.to_thread`. It rechecks the Inuksuk version
under a row lock so a stale generator cannot overwrite a newer edit or
resurrect a deleted record. Geometry changes clear the old reference; the
old crop is removed/replaced. Missing pyramids or generation failures are
logged and leave `thumb=null`, so reads use the plain image-thumb fallback
without failing the successful write. Inuksuk/Board orphan deletion removes
files only after commit, with cleanup failures logged.

Single/bulk user deletion applies the same invariant: deleted sole-owned Boards
also delete newly orphaned Inuksuks owned by surviving users. Co-owned and
program-owned Boards survive; solely departing-user-owned Inuksuks are deleted
even on surviving Boards. Their thumbnail cleanup is deferred until commit.

`test_board_writes.py` exercises PostgreSQL CRUD, role gates, CAS/428,
sections/assignments/reorder, ownership/caps, real thumbnail generation,
fallback and deletion, commit-failure file preservation and replacement.
`test_inuksuk_thumbs.py` also checks replacement rollback cleanup boundaries.
