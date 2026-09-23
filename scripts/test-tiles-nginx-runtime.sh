#!/usr/bin/env bash

# Runtime regression checks for the tiles sidecar nginx config (#1166).
#
# Rendered-YAML checks (helm lint, kubeconform, test-helm-chart-regressions.sh)
# cannot see subrequest variable scope, verdict-cache effectiveness, or
# location matching — the two bugs caught in PR #1163 review (auth_request
# treating a variable-bearing target as a literal URI, and $arg_tile_token
# being empty inside the auth subrequest) both shipped past those checks.
#
# This script renders the sidecar config, runs it in the chart's nginx image
# with a stub validator standing in for GET /api/tiles-auth on 127.0.0.1:8000,
# and exercises the auth boundary with real HTTP requests. The stub honours
# the validator's contract (backend/app/routers/tiles.py): the token
# "valid-<id>" passes only for image <id>, anything else is 401/403. Every
# stub hit is logged so the harness can count validator traffic.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if ! grep -Fq -- "$needle" <<<"$haystack"; then
    fail "$message"
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if grep -Fq -- "$needle" <<<"$haystack"; then
    fail "$message"
  fi
}

command -v helm >/dev/null || fail "helm is required (nix-shell -p kubernetes-helm)"
command -v docker >/dev/null || fail "docker is required for the runtime tiles sidecar checks"
command -v curl >/dev/null || fail "curl is required for the runtime tiles sidecar checks"
docker info >/dev/null 2>&1 || fail "docker daemon is not reachable"

# ── Render and extract the sidecar config ────────────────────────────

manifest="$(helm template test charts/backend \
  --set persistence.enabled=true \
  --set tiles.enabled=true)"

tiles_configmap="$(awk '
  BEGIN { RS="---"; ORS="" }
  $0 ~ "kind: ConfigMap" && $0 ~ "name: test-hriv-backend-nginx-tiles" { print; exit }
' <<<"$manifest")"
[[ -n "$tiles_configmap" ]] || fail "backend chart did not render the nginx-tiles ConfigMap"

# default.conf is the last key under data: — strip its 4-space block
# indent. Blank lines inside the literal block render without indent, so
# only a non-empty, unindented line ends the block.
nginx_conf="$(awk '
  /^  default\.conf: \|/ { capture=1; next }
  capture {
    if ($0 == "") { print "" } else if ($0 ~ /^    /) { print substr($0, 5) } else { exit }
  }
' <<<"$tiles_configmap")"
assert_contains "$nginx_conf" "auth_request" \
  "rendered tiles config should enforce auth_request on tile requests"

# auth_request does not expand variables — a variable-bearing target is
# matched literally and misses the internal location (PR #1163 bug 1).
auth_request_line="$(grep -E '^[[:space:]]*auth_request[[:space:]]' <<<"$nginx_conf")"
[[ -n "$auth_request_line" ]] || fail "no auth_request directive in rendered tiles config"
assert_not_contains "$auth_request_line" '$' \
  "auth_request target must be a literal URI — nginx does not expand variables there"

# Resolve the sidecar image and listen port from the rendered manifest so
# the harness always runs exactly what the chart deploys.
nginx_image="$(awk '
  /- name: tile-server/ { found=1; next }
  found && /image:/ { gsub(/"/, "", $2); print $2; exit }
' <<<"$manifest")"
[[ -n "$nginx_image" ]] || fail "could not resolve the tile-server image from the rendered Deployment"
tiles_port="$(awk '
  /^  default\.conf: \|/ { capture=1; next }
  capture && /listen [0-9]+;/ { gsub(/[^0-9]/, "", $2); print $2; exit }
' <<<"$tiles_configmap")"
[[ -n "$tiles_port" ]] || fail "could not resolve the tiles listen port from the rendered config"

# ── Assemble the fixture ─────────────────────────────────────────────

work="$(mktemp -d)"
container_id=""
cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/tiles/42/image_files/0" "$work/tiles/7" "$work/stub-logs"
printf 'dzi-descriptor-42' > "$work/tiles/42/image.dzi"
printf 'tile-bytes-42' > "$work/tiles/42/image_files/0/0_0.jpeg"
printf 'dzi-descriptor-7' > "$work/tiles/7/image.dzi"
printf '%s' "$nginx_conf" > "$work/default.conf"

# Stub validator on the same pod-local address the sidecar proxies to.
# It reconstructs what the real validator reads (X-Original-URI, whose
# query string still carries the original tile_token) and counts hits via
# a dedicated access log.
cat > "$work/stub.conf" <<'STUB'
map $http_x_original_uri $stub_image_id {
    ~^/api/tiles/([0-9]+)/ $1;
    default "";
}
map $http_x_original_uri $stub_token {
    ~[?&]tile_token=([^&]+) $1;
    default "";
}
map $stub_token $stub_token_image_id {
    ~^valid-([0-9]+)$ $1;
    ~^alt-([0-9]+)$ $1;
    default "";
}
server {
    listen 127.0.0.1:8000;
    access_log /stub-logs/validator-access.log;
    location = /api/tiles-auth {
        if ($stub_image_id = "") { return 403; }
        if ($stub_token_image_id = "") { return 401; }
        if ($stub_token_image_id != $stub_image_id) { return 403; }
        return 204;
    }
}
STUB

# Pull explicitly with retries and registry fallbacks: fresh runners pull
# anonymously from Docker Hub, and a throttled 429 must not fail the
# always-required helm-lint gate. The mirrors serve the identical
# manifest digest, so the container still runs the chart's own image
# reference.
pull_attempt=0
until docker image inspect "$nginx_image" >/dev/null 2>&1 || docker pull "$nginx_image"; do
  pull_attempt=$((pull_attempt + 1))
  [[ "$pull_attempt" -lt 4 ]] || break
  sleep $((pull_attempt * 10))
done
if ! docker image inspect "$nginx_image" >/dev/null 2>&1; then
  image_repo="${nginx_image%:*}"
  image_tag="${nginx_image##*:}"
  case "$image_repo" in
    */*) mirror_repo="$image_repo" ;;
    *) mirror_repo="library/$image_repo" ;;
  esac
  mirror_ref=""
  for mirror in \
    "mirror.gcr.io/$mirror_repo:$image_tag" \
    "public.ecr.aws/docker/$mirror_repo:$image_tag"; do
    if docker pull "$mirror"; then
      docker tag "$mirror" "$nginx_image"
      mirror_ref="$mirror"
      break
    fi
  done
  [[ -n "$mirror_ref" ]] || \
    fail "could not pull $nginx_image from Docker Hub or its mirrors"
  echo "Pulled $mirror_ref as $nginx_image"
fi

container_id="$(docker run -d \
  -v "$work/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$work/stub.conf:/etc/nginx/conf.d/zz-auth-stub.conf:ro" \
  -v "$work/tiles:/data/tiles:ro" \
  -v "$work/stub-logs:/stub-logs" \
  -p "127.0.0.1::${tiles_port}" \
  "$nginx_image")"

host_port="$(docker port "$container_id" "${tiles_port}/tcp" | head -1 | sed 's/.*://')"
[[ -n "$host_port" ]] || fail "container did not publish the tiles port"
base="http://127.0.0.1:${host_port}"

ready=0
for _ in $(seq 1 30); do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/healthz" || true)" == "200" ]]; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  docker logs "$container_id" >&2 || true
  fail "tiles sidecar fixture did not become ready"
fi

# ── Assertions ───────────────────────────────────────────────────────

hits() {
  local log="$work/stub-logs/validator-access.log"
  if [[ -f "$log" ]]; then wc -l < "$log"; else echo 0; fi
}

expect_status() {
  local want="$1" url="$2" msg="$3" got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$url")"
  [[ "$got" == "$want" ]] || fail "$msg (expected $want, got $got)"
}

image42="$base/api/tiles/42/image.dzi"
image7="$base/api/tiles/7/image.dzi"

# Valid token serves the tile, with private cache control (#1064).
headers="$(curl -s -D - -o "$work/tile-body" "${image42}?tile_token=valid-42")"
assert_contains "$headers" "HTTP/1.1 200" "valid token should serve the tile"
assert_contains "$(cat "$work/tile-body")" "dzi-descriptor-42" "tile body should come from the mounted tiles dir"
assert_contains "$headers" "Cache-Control: private" "authorized tiles must forbid shared-cache storage"
before="$(hits)"
[[ "$before" -eq 1 ]] || fail "first authorized request should hit the validator once (got $before)"

# Missing and invalid tokens are denied, and never populate the cache.
expect_status 401 "$image42" "missing tile token should be rejected"
expect_status 401 "$image42" "repeat tokenless request should still be rejected (empty keys must not alias)"
expect_status 401 "${image42}?tile_token=expired-token" "expired/invalid token should be rejected"
after_denials="$(hits)"
[[ "$after_denials" -eq 4 ]] || \
  fail "each denied request should reach the validator (204s only are cached); got $after_denials hits"

# A token bound to another image is denied — and re-requesting it hits
# the validator again (denials must never be cached).
expect_status 403 "${image42}?tile_token=valid-7" "token bound to another image should be denied"
expect_status 403 "${image42}?tile_token=valid-7" "repeated wrong-image token should still be denied"
after_wrong="$(hits)"
[[ "$after_wrong" -eq 6 ]] || \
  fail "wrong-image denials must not be cached; got $after_wrong hits"

# A burst of tile requests for one image collapses to a single validator
# hit — this is the cache the $request_uri-derived key exists for (PR
# #1163 bug 2: an empty-key cache would be bypassed on every request).
for path in image.dzi thumbnail.jpeg image_files/0/0_0.jpeg image_files/0/1_0.jpeg image_files/1/0_0.jpeg; do
  curl -s -o /dev/null "$base/api/tiles/42/${path}?tile_token=valid-42"
done
after_burst="$(hits)"
[[ "$after_burst" -eq 6 ]] || \
  fail "repeated requests for one image+token should reuse the cached verdict (expected 6 hits, got $after_burst)"
expect_status 404 "$base/api/tiles/42/missing.jpeg?tile_token=valid-42" \
  "a missing tile under a valid token should 404, not fail auth"

# A second image still goes through validation — the image id is part of
# the cache key so image A's verdict never authorizes image B.
expect_status 200 "${image7}?tile_token=valid-7" "second image should be served once its token validates"
after_second_image="$(hits)"
[[ "$after_second_image" -eq 7 ]] || \
  fail "a different image must trigger a fresh validation (expected 7 hits, got $after_second_image)"

# A second valid token for the same image misses the cache too — the
# verdict is keyed per token, not per image.
expect_status 200 "${image42}?tile_token=alt-42" "a different valid token should be validated independently"
after_token="$(hits)"
[[ "$after_token" -eq 8 ]] || \
  fail "a new token for a cached image must hit the validator (expected 8 hits, got $after_token)"
echo "Tiles sidecar runtime regression checks passed."
