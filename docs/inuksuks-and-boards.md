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
  exposes the read endpoints below; write endpoints are not implemented yet.
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
Inuksuk or see at least one of its Boards. Non-students can view all active-image
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
Successful image replacement clears stored Inuksuk thumbnail references
and removes the old thumbnails only after commit; failed replacement
preserves them. Neither helper removes source tiles or whole-image thumbnails.

The API container already mounts `tiles-data` at `/data/tiles` when chart
persistence is enabled, with `TILES_DIR` supplied from chart values. No
mount change is needed for future API-side generation; generation is not
wired to endpoints in this increment.

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

Inuksuks require an **active image for every role**. Students additionally
pass the image category's inherited program/group/hidden-subtree gates,
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
