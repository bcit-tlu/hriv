# ADR: Authorized Tile-Delivery Boundary

- **Status:** Accepted (2026-08-31)
- **Issues:** [#1069](https://github.com/bcit-tlu/hriv/issues/1069) (design),
  [#1064](https://github.com/bcit-tlu/hriv/issues/1064) (enforcement),
  [#1079](https://github.com/bcit-tlu/hriv/issues/1079) (route audit — see
  [`docs/unauthenticated-routes.md`](unauthenticated-routes.md))

## Context

DZI descriptors, thumbnails, and full-resolution tiles are served with no
authorization at all, from two paths:

1. `backend/app/main.py` mounts `settings.tiles_dir` at `/api/tiles` via
   Starlette `StaticFiles` (dev/compose, and any deployment without the
   sidecar).
2. In Kubernetes, the frontend nginx proxies `/api/tiles/` straight to the
   backend chart's nginx tiles sidecar
   (`charts/backend/templates/configmap-nginx-tiles.yaml`), which serves the
   tiles PVC with `Cache-Control: public, max-age=2592000, immutable`.

Source-image IDs are numeric and enumerable
(`/api/tiles/<source_image_id>/image.dzi`, `.../thumbnail.jpeg`,
`.../image_files/<level>/<col>_<row>.jpeg`), so the student visibility model
(`backend/app/visibility.py` — dual program/group gate up the ancestor chain)
is bypassed for the actual image content (CWE-862/CWE-639).

Constraints:

- OpenSeadragon issues hundreds of tile requests per viewing session; a DB
  authorization query per tile is unacceptable (#1069), and FastAPI must stay
  out of the per-tile hot path in production.
- `<img>` tags (browse thumbnails, Manage table) cannot carry an
  `Authorization` header.
- Blanket `Cache-Control: public` is forbidden once tiles are authorized
  (#1064): a shared cache must never serve a tile to a client that never
  presented a valid credential.
- The tiles sidecar should remain vanilla `nginx:alpine` (no njs/OpenResty)
  and independently scalable.
- `tile_sources` and `thumb` are persisted columns on `images`
  (`models.py`), returned by the image API and consumed verbatim by the
  frontend — a natural interception point that already sits _behind_ the
  visibility check.

## Decision

**Stateless HMAC tile tokens, issued at image-serialization time and validated
by nginx `auth_request` against a DB-free FastAPI endpoint.**

```text
client ──GET /api/images… (bearer auth, visibility filter)──▶ FastAPI
   ◀── image payload; tile_sources/thumb URLs carry ?tile_token=…

client ──GET /api/tiles/<id>/…?tile_token=…──▶ frontend nginx ──▶ tiles sidecar
                                                    │ auth_request /api/tiles-auth
                                                    ▼
                                     FastAPI validator (HMAC + expiry only,
                                     no DB) ── 204 / 403
                                                    │
                                      sidecar serves tile from PVC
                                      Cache-Control: private
```

### Token

- HMAC-SHA256 over `source_image_id` + expiry (compact `<id>.<exp>.<sig>`
  or JWT with `purpose="tile"`, following the existing task-download token
  precedent in `routers/admin.py`), signed with the backend's secret.
- Scope: a single `source_image_id` — a leaked token exposes one image for
  minutes, not the corpus.
- TTL: configurable, default ~15 minutes.
- Issuance: whenever an image row is serialized into an API response (list,
  detail, browse tree), the stored `tile_sources` / `thumb` paths gain a
  `tile_token` query parameter. Issuance happens only _after_ the existing
  auth + student-visibility filtering, so authorization stays exactly where it
  is today; HMAC signing is microseconds per image and needs no extra DB work.
  Implementation note: injection must be **centralized in one hook on the
  image response schema** (a Pydantic `field_serializer` on `ImageOut`'s
  `thumb`/`tile_sources`) so every serialization path — automatic, explicit,
  and nested — is covered without per-router calls. Implemented (as this
  ADR's C3a slice) in [#1159](https://github.com/bcit-tlu/hriv/pull/1159);
  the slice table below tracks each slice's PR.
- Validation: signature + expiry + that the token's image id matches the
  requested `/api/tiles/<id>/…` path. **No DB access** — revocation within the
  TTL window is explicitly out of scope (acceptable: visibility changes take
  effect within minutes, matching the pre-existing exposure of already-fetched
  content).

### Delivery layers

1. **Kubernetes (sidecar enabled):** the tiles sidecar nginx adds
   `auth_request /_tiles_auth;` where `/_tiles_auth` is an `internal` location
   proxying to the backend Service's `GET /api/tiles-auth` with
   `X-Original-URI` and the token. The validator is a constant-time HMAC
   check. An nginx `proxy_cache` on the internal auth location (key:
   `$tile_auth_token:$tile_image_id`, TTL ≤ 60 s, cache 204 only) collapses
   the per-tile subrequest storm to roughly one backend hit per image per
   minute. Token-only keying is unsafe: tokens are image-scoped, so a cached
   204 for image A must not bypass the validator's wrong-image 403 for image
   B; including the image id preserves that check while still sharing one
   verdict across the image's descriptor, thumbnail, and tile hierarchy.
2. **FastAPI fallback (dev/compose, sidecar disabled):** the unauthenticated
   `StaticFiles` mount in `main.py` is **removed**, replaced by a router route
   `GET /api/tiles/{source_image_id}/{path:path}` that validates the token and
   returns `FileResponse` (with path-traversal guarding). Same token, same
   semantics, one code path for issuance and validation.

### Caching

- Tile and thumbnail responses change from
  `Cache-Control: public, max-age=2592000, immutable` to
  **`Cache-Control: private, max-age=2592000`** — browser caching stays fully
  effective (the tile bytes are immutable; see
  [`docs/tile-cache-provenance.md`](tile-cache-provenance.md)), but shared
  caches/CDNs must not store them, satisfying #1064. Both proxy layers
  currently set the `public` header and both must change in C3b: the tiles
  sidecar (`charts/backend/templates/configmap-nginx-tiles.yaml`) and the
  frontend nginx `/api/tiles/` location
  (`charts/frontend/files/default.conf.template`), which adds its own
  `Cache-Control … always` that would otherwise override the sidecar's.
- Browser cache keys include the query string, so a renewed token re-fetches
  tiles. This is bounded: within one viewing session the token is constant,
  and OpenSeadragon's in-memory tile cache is unaffected by renewal.
- **Accepted residual risk — local browser cache outlives authorization.**
  `private, max-age=2592000` lets the _user's own browser_ re-serve already
  fetched tiles for up to 30 days without a valid token; logout or a
  visibility change does not purge that cache. This is the same residue as
  any previously viewed content (screenshots, memory, the pre-existing
  public-cache behavior was strictly worse) and is bounded to tiles the user
  was authorized to fetch at the time. On shared machines, rely on the usual
  controls: separate OS/browser profiles or private-browsing sessions in
  labs. Revisit (e.g. `no-store` at the cost of re-fetch traffic) only if a
  concrete shared-workstation requirement emerges.
- The `auth_request` subrequest cache (above) is keyed by token plus
  source-image id, never by client identity, and stores only allow/deny — no
  image bytes are cached at any shared layer.

### Frontend

- No URL construction changes: the frontend already uses `tile_sources` and
  `thumb` verbatim, so tokenized URLs flow through OSD tile sources and
  `<img src>` unchanged.
- **Renewal:** on a tile/thumbnail 401/403 (token expired mid-session), the
  viewer re-fetches `GET /api/images/{id}` to obtain freshly tokenized URLs
  and swaps the OSD tile source without closing the viewer. OpenSeadragon
  failure bursts are debounced into one refresh. Descriptor failures renew only
  for explicit 401/403 responses; JPEG tile loads use `<img>` elements that do
  not expose HTTP status, so their generic load failure also triggers the
  bounded renewal path. Confirmed non-auth failures do not consume renewal
  attempts. The viewer preserves zoom, pan, and rotation across the swap,
  retains existing selection rectangles and measurement labels, limits renewal
  to two attempts per selected image, and reports an unrecoverable refresh
  through the existing error UI. A response that completes after the selected
  image changes is ignored.
- **Thumbnail renewal is required too, not just the viewer.** `<img>`
  consumers (browse `CategoryTile`, `ManagePage` table, search results) may
  render a `thumb` URL long after its token expired, and the browse tree's
  `304` short-circuit ([`docs/browse-state.md`](browse-state.md)) means token
  expiry never invalidates the cached payload — stale tokenized URLs persist
  indefinitely on an unchanged tree. C3c therefore adds a shared `onError`
  recovery for thumbnails: one re-fetch of the affected image's metadata to
  swap in a fresh URL, single retry per stale rendered URL (no loops), with
  concurrent refreshes deduplicated per image. Renewal merges only `thumb` and
  `tile_sources` into current client state so a late token refresh cannot
  overwrite newer metadata, visibility, or version changes. The browse ETag
  deliberately stays token-independent — recovery is per-image on failure, not
  a revision change.

## Alternatives considered

| Alternative                                                            | Why rejected                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-tile signed URLs** (sign every `<level>/<col>_<row>.jpeg` URL)   | The `.dzi` descriptor drives OSD's tile URL construction, so per-tile signing requires a custom OSD tile source and re-signing on every pan/zoom; enormous URL churn defeats browser caching. Image-scoped tokens give the same boundary at a fraction of the complexity.               |
| **FastAPI + `X-Accel-Redirect`**                                       | Puts FastAPI back into the per-tile hot path (one app request per tile even though nginx serves the bytes), and couples the sidecar's lifecycle to API pod internals. Chosen design touches FastAPI ~once per image per auth-cache window.                                              |
| **nginx `secure_link`** (validate HMAC in nginx itself, no subrequest) | The stock `secure_link` module is MD5-based with awkward expiry encoding; an HMAC variant needs OpenResty/njs, breaking the vanilla-nginx constraint. `auth_request` + cache achieves near-identical per-tile cost with the validation logic kept in one place (Python, unit-testable). |
| **Session cookie scoped to `/api/tiles`**                              | Works transparently for `<img>`, but is per-user rather than per-image (violates least privilege), complicates dev (cross-origin Vite:5173 → backend:8000 cookies), and CSRF-adjacent review burden. Query-param tokens follow the existing task-download precedent.                    |
| **Optional-auth on the static mount**                                  | Forbidden by the standing rule in [`docs/unauthenticated-routes.md`](unauthenticated-routes.md) (no optional-auth pattern), and `StaticFiles` cannot express per-image authorization anyway.                                                                                            |

## Consequences

- The `/api/tiles` route moves from "unauthenticated mismatch" to
  **app-credential** in [`docs/unauthenticated-routes.md`](unauthenticated-routes.md).
- Tokens appear in query strings and therefore may appear in access logs;
  tile locations keep `access_log off` (already the case in the sidecar), and
  the tokens are single-image, short-TTL — same accepted posture as the
  task-download token (#1153 tracks hardening for both patterns).
- Tile URLs stop being shareable across users; any consumer that hotlinked
  tile paths (none known beyond the app itself and synthetic monitoring) must
  authenticate. Synthetic monitoring flows through the app and receives
  tokenized URLs like any client.
- Direct-access integration tests become possible and required: unauth, wrong
  program, wrong group, hidden ancestor, inactive image (AC on #1064/#1069).

## Implementation plan (Wave C3)

| Slice        | Content                                                                                                                                                       | PR                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| C3a backend  | Token issue/validate module, serializer wiring, remove `StaticFiles` mount, authorized FastAPI tile route, `GET /api/tiles-auth` validator, integration tests | backend [#1159](https://github.com/bcit-tlu/hriv/pull/1159)  |
| C3b delivery | Sidecar `auth_request` + auth cache + `private` cache-control (both proxy layers); frontend chart passthrough; helm regression checks                         | charts [#1163](https://github.com/bcit-tlu/hriv/pull/1163)   |
| C3c frontend | 401/403 renewal path (viewer re-fetch + tile-source swap, thumbnail `onError` recovery), viewer tests                                                         | frontend [#1165](https://github.com/bcit-tlu/hriv/pull/1165) |

With the backend validator/fallback route in C3a and sidecar enforcement in
C3b, the `/api/tiles` rows in
[`docs/unauthenticated-routes.md`](unauthenticated-routes.md) move from
_mismatch_ to **app-credential**.

Rollout: C3a ships the fallback route first (dev parity), C3b flips the
sidecar; the chart change is gated on a backend version carrying
`/api/tiles-auth` (documented in the chart values).
