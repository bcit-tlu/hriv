#!/usr/bin/env bash

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

extract_yaml_doc() {
  local manifest="$1"
  local kind="$2"
  local name="$3"
  awk -v kind="$kind" -v name="$name" '
    BEGIN { RS="---"; ORS="" }
    $0 ~ ("kind: " kind) && $0 ~ ("name: " name) { print; exit }
  ' <<<"$manifest"
}

backend_legacy_manifest="$(helm template test charts/backend \
  --set persistence.enabled=true \
  --set persistence.accessModes[0]=ReadWriteMany \
  --set tiles.enabled=true \
  --set redis.enabled=true \
  --set redis.worker.enabled=true)"

backend_legacy_tiles_pvc="$(extract_yaml_doc "$backend_legacy_manifest" "PersistentVolumeClaim" "test-hriv-backend-tiles")"
assert_contains "$backend_legacy_tiles_pvc" "- ReadWriteMany" \
  "legacy persistence.accessModes should still apply to the backend tiles PVC when tiles.accessModes stays at its default"

backend_explicit_tiles_manifest="$(helm template test charts/backend \
  --set persistence.enabled=true \
  --set persistence.accessModes[0]=ReadWriteOnce \
  --set persistence.tiles.accessModes[0]=ReadWriteMany)"

backend_explicit_tiles_pvc="$(extract_yaml_doc "$backend_explicit_tiles_manifest" "PersistentVolumeClaim" "test-hriv-backend-tiles")"
assert_contains "$backend_explicit_tiles_pvc" "- ReadWriteMany" \
  "explicit persistence.tiles.accessModes should not be overridden by the legacy flat accessModes fallback"
assert_not_contains "$backend_explicit_tiles_pvc" "- ReadWriteOnce" \
  "backend tiles PVC should not fall back to the legacy flat accessModes when an explicit split-PVC tiles access mode is set"

backup_legacy_manifest="$(helm template test charts/backup \
  --set persistence.data.enabled=true \
  --set persistence.data.existingClaim=hriv-backend-data)"

assert_contains "$backup_legacy_manifest" "claimName: hriv-backend-data" \
  "backup chart should still mount the shared legacy data PVC during upgrade"
assert_not_contains "$backup_legacy_manifest" "mountPath: /data/tiles" \
  "backup chart should not render a separate tiles mount when only the legacy shared data claim is configured"
assert_not_contains "$backup_legacy_manifest" "claimName: test-hriv-backup-tiles" \
  "backup chart should not create a separate tiles PVC when only the legacy shared data claim is configured"

backup_explicit_tiles_manifest="$(helm template test charts/backup \
  --set persistence.data.enabled=true \
  --set persistence.data.existingClaim=hriv-backend-data \
  --set persistence.tiles.existingClaim=hriv-backend-tiles \
  --set env.BACKUP_MODE=development)"

assert_contains "$backup_explicit_tiles_manifest" "mountPath: /data/tiles" \
  "backup chart should keep the tiles mount when an explicit split-PVC tiles claim is provided"
assert_contains "$backup_explicit_tiles_manifest" "claimName: hriv-backend-tiles" \
  "backup chart should keep the explicit split-PVC tiles claim when provided alongside the legacy shared data claim"

backup_no_volumes_manifest="$(helm template test charts/backup \
  --set persistence.sourceImages.enabled=false \
  --set persistence.tiles.enabled=false \
  --set persistence.backups.enabled=false)"

assert_not_contains "$backup_no_volumes_manifest" "volumeMounts:" \
  "backup deployment should omit volumeMounts when every backup chart data volume is disabled"
assert_not_contains "$backup_no_volumes_manifest" "volumes:" \
  "backup deployment should omit volumes when every backup chart data volume is disabled"

echo "Helm chart regression checks passed."
