## Testing Metadata Operations

### Optimistic Concurrency

Images use version-based optimistic concurrency; PATCH requires `If-Match`:

```bash
VERSION=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/images/1 \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")

curl -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"name": "New Name"}'
```

Always re-fetch `version` before each PATCH or you'll get 409 Conflict.

### metadata_extra_merge (Partial Updates)

`metadata_extra_merge` patches individual keys in `metadata_extra` without
overwriting the rest — this is how the frontend updates locked overlays and
measurement settings independently:

```bash
# Add / update a key
curl -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"metadata_extra_merge": {"locked_overlays": [{"x":0.1,"y":0.2,"w":0.3,"h":0.4}]}}'

# Remove a key by setting it to null
curl -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"metadata_extra_merge": {"locked_overlays": null}}'
```

`metadata_extra` and `metadata_extra_merge` are mutually exclusive — sending both
in one request returns 422.

`locked_overlays` entries are validated by `OverlayRectSchema` — each must have
numeric `x`, `y`, `w`, `h`. Malformed entries are silently filtered on both
backend and frontend.

### Injecting Test Data

To exercise frontend handling of malformed metadata, inject directly:

```bash
docker exec hriv-db-1 psql -U hriv -d hriv -c \
  "UPDATE images SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{locked_overlays}', \
   '[{\"x\":0.1,\"y\":0.2,\"w\":0.3,\"h\":0.4},{\"garbage\":true},{\"x\":\"str\",\"y\":0,\"w\":0,\"h\":0}]') \
   WHERE id=2"
```

Then open that image in the browser to verify graceful handling.
