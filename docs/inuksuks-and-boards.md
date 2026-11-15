# Inuksuks and Boards

Inuksuks bookmark an image's exact viewport coordinates, zoom, and rotation.
Boards curate shared Inuksuks into ordered, one-level sections. Migration
`0046_inuksuks_and_boards` introduces the additive schema; creation, access
control, thumbnails, and UI arrive in subsequent issues of epic #1765.
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
  does not add endpoints in this schema-only release.
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
An Inuksuk is visible only when its image is visible **and** at least one of
its Boards is visible. These rules are for the forthcoming CRUD routers;
the thumbnail generator does not perform authorization or create endpoints.

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

Use `append_thumb_token` when serializing these URLs after visibility
checks. Thumbnail tokens authorize only `thumbnail.jpeg` and numeric
`inuksuks/<id>.jpg` paths within the same source image, never DZI tiles.
The nginx verdict cache uses the same thumbnail-vs-tile classification.

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
