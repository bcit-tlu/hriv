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

backend_zone_aa_manifest="$(helm template test charts/backend \
  --set scheduling.zoneAntiAffinity.enabled=true \
  --set replicaCount=2 \
  --set persistence.enabled=true \
  --set persistence.sourceImages.accessModes[0]=ReadWriteMany \
  --set persistence.tiles.accessModes[0]=ReadWriteMany)"

backend_zone_aa_deployment="$(extract_yaml_doc "$backend_zone_aa_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_zone_aa_deployment" "type: RollingUpdate" \
  "backend deployment should use RollingUpdate when hard zone anti-affinity is enabled with multiple replicas"
assert_contains "$backend_zone_aa_deployment" "maxSurge: 0" \
  "backend deployment should set maxSurge: 0 for the zone anti-affinity rollout strategy"
assert_contains "$backend_zone_aa_deployment" "maxUnavailable: 1" \
  "backend deployment should set maxUnavailable: 1 for the zone anti-affinity rollout strategy"

backend_rwo_manifest="$(helm template test charts/backend \
  --set persistence.enabled=true \
  --set persistence.sourceImages.accessModes[0]=ReadWriteOnce \
  --set persistence.tiles.accessModes[0]=ReadWriteOnce)"

backend_rwo_deployment="$(extract_yaml_doc "$backend_rwo_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_rwo_deployment" "type: Recreate" \
  "backend deployment should force Recreate when ReadWriteOnce persistence is enabled"

backend_default_manifest="$(helm template test charts/backend \
  --set replicaCount=1)"

backend_default_deployment="$(extract_yaml_doc "$backend_default_manifest" "Deployment" "test-hriv-backend")"
assert_not_contains "$backend_default_deployment" "strategy:" \
  "backend deployment should omit strategy when no rollout override is needed"

backend_override_manifest="$(helm template test charts/backend \
  --set scheduling.zoneAntiAffinity.enabled=true \
  --set replicaCount=2 \
  --set persistence.enabled=true \
  --set persistence.sourceImages.accessModes[0]=ReadWriteMany \
  --set persistence.tiles.accessModes[0]=ReadWriteMany \
  --set-json 'updateStrategy={"type":"Recreate"}')"

backend_override_deployment="$(extract_yaml_doc "$backend_override_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_override_deployment" "type: Recreate" \
  "backend deployment should honour an explicit Recreate override"
assert_not_contains "$backend_override_deployment" "type: RollingUpdate" \
  "backend deployment should not render RollingUpdate when updateStrategy explicitly requests Recreate"
assert_not_contains "$backend_override_deployment" "maxSurge:" \
  "backend deployment should not render rollingUpdate settings when updateStrategy explicitly requests Recreate"

if backend_guard_output="$(helm template test charts/backend \
  --set persistence.enabled=true \
  --set persistence.sourceImages.accessModes[0]=ReadWriteOnce \
  --set persistence.tiles.accessModes[0]=ReadWriteOnce \
  --set-json 'updateStrategy={"type":"RollingUpdate"}' 2>&1)"; then
  fail "expected ReadWriteOnce persistence with updateStrategy.type=RollingUpdate to be rejected"
fi
assert_contains "$backend_guard_output" "Recreate" \
  "backend deployment should explain that ReadWriteOnce persistence requires Recreate"

backend_worker_otel_manifest="$(helm template test charts/backend \
  --set redis.enabled=true \
  --set redis.worker.enabled=true \
  --set observability.openTelemetry.enabled=true)"

backend_worker_deployment="$(extract_yaml_doc "$backend_worker_otel_manifest" "Deployment" "test-hriv-backend-worker")"
assert_contains "$backend_worker_deployment" 'name: OTEL_SERVICE_NAME' \
  "backend worker deployment should set OTEL_SERVICE_NAME when OpenTelemetry is enabled"
assert_contains "$backend_worker_deployment" 'value: "hriv-backend-worker"' \
  "backend worker deployment should identify itself as hriv-backend-worker"
assert_contains "$backend_worker_deployment" 'name: WORKER_IMAGE_TAG' \
  "backend worker deployment should surface the worker image tag for build-info metrics"

backend_mode_default_manifest="$(helm template test charts/backend)"
backend_mode_default_deployment="$(extract_yaml_doc "$backend_mode_default_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_mode_default_deployment" 'name: TASK_EXECUTION_MODE' \
  "backend deployment should always render TASK_EXECUTION_MODE"
assert_contains "$backend_mode_default_deployment" 'value: "local"' \
  "backend deployment should default TASK_EXECUTION_MODE to local"
assert_contains "$backend_mode_default_deployment" 'name: WORKER_MAX_JOBS' \
  "backend deployment should render WORKER_MAX_JOBS for the in-process fallback concurrency"
assert_not_contains "$backend_mode_default_deployment" 'name: WORKER_TOTAL_SLOTS' \
  "backend deployment should omit WORKER_TOTAL_SLOTS when redis.worker.totalSlots is unset"
assert_not_contains "$backend_mode_default_deployment" 'name: FEEDBACK_EMAIL_SMTP_SECURITY' \
  "backend deployment should omit FEEDBACK_EMAIL_SMTP_SECURITY when feedback.email.smtpSecurity is unset"

backend_feedback_security_manifest="$(helm template test charts/backend \
  --set feedback.provider=email \
  --set feedback.email.existingSecret=hriv-feedback-smtp-relay \
  --set feedback.email.smtpSecurity=none)"
backend_feedback_security_deployment="$(extract_yaml_doc "$backend_feedback_security_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_feedback_security_deployment" 'name: FEEDBACK_EMAIL_SMTP_SECURITY' \
  "backend deployment should render FEEDBACK_EMAIL_SMTP_SECURITY when feedback.email.smtpSecurity is set"
assert_contains "$backend_feedback_security_deployment" 'value: "none"' \
  "backend deployment should pass the configured SMTP security mode"

backend_required_manifest="$(helm template test charts/backend \
  --set tasks.executionMode=required \
  --set redis.enabled=true \
  --set redis.worker.enabled=true \
  --set redis.worker.totalSlots=8)"

backend_required_api="$(extract_yaml_doc "$backend_required_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_required_api" 'value: "required"' \
  "backend deployment should render TASK_EXECUTION_MODE=required"
assert_contains "$backend_required_api" 'name: WORKER_TOTAL_SLOTS' \
  "backend deployment should render WORKER_TOTAL_SLOTS when redis.worker.totalSlots is set"

backend_required_worker="$(extract_yaml_doc "$backend_required_manifest" "Deployment" "test-hriv-backend-worker")"
assert_contains "$backend_required_worker" 'name: TASK_EXECUTION_MODE' \
  "worker deployment should render TASK_EXECUTION_MODE"
assert_contains "$backend_required_worker" 'value: "required"' \
  "worker deployment should render TASK_EXECUTION_MODE=required"
assert_contains "$backend_required_worker" 'name: WORKER_MAX_JOBS' \
  "worker deployment should render WORKER_MAX_JOBS"
assert_contains "$backend_required_worker" 'value: "8"' \
  "worker deployment should render the configured WORKER_TOTAL_SLOTS value"
assert_contains "$backend_required_worker" 'name: DB_POOL_SIZE' \
  "worker deployment should render the worker-specific DB_POOL_SIZE"
assert_contains "$backend_required_worker" 'name: DB_MAX_OVERFLOW' \
  "worker deployment should render the worker-specific DB_MAX_OVERFLOW"
assert_contains "$backend_required_worker" 'terminationGracePeriodSeconds: 300' \
  "worker deployment should default terminationGracePeriodSeconds to 300"
assert_contains "$backend_required_worker" '"arq", "--check", "app.worker.WorkerSettings"' \
  "worker deployment should render the arq --check liveness probe by default"

backend_worker_no_probe_manifest="$(helm template test charts/backend \
  --set redis.enabled=true \
  --set redis.worker.enabled=true \
  --set redis.worker.probes.liveness.enabled=false)"
backend_worker_no_probe="$(extract_yaml_doc "$backend_worker_no_probe_manifest" "Deployment" "test-hriv-backend-worker")"
assert_not_contains "$backend_worker_no_probe" 'livenessProbe:' \
  "worker deployment should omit the liveness probe when redis.worker.probes.liveness.enabled=false"

if backend_required_no_redis_output="$(helm template test charts/backend \
  --set tasks.executionMode=required 2>&1)"; then
  fail "expected tasks.executionMode=required without redis.enabled to be rejected"
fi
assert_contains "$backend_required_no_redis_output" "requires redis.enabled" \
  "backend chart should explain that required execution mode needs Redis"

if backend_required_no_worker_output="$(helm template test charts/backend \
  --set tasks.executionMode=required \
  --set redis.enabled=true 2>&1)"; then
  fail "expected tasks.executionMode=required without redis.worker.enabled to be rejected"
fi
assert_contains "$backend_required_no_worker_output" "requires redis.worker.enabled" \
  "backend chart should explain that required execution mode needs the worker Deployment"

if backend_low_max_jobs_output="$(helm template test charts/backend \
  --set redis.worker.maxJobs=1 2>&1)"; then
  fail "expected redis.worker.maxJobs below 2 to be rejected"
fi
assert_contains "$backend_low_max_jobs_output" "must be at least 2" \
  "backend chart should explain the redis.worker.maxJobs floor"

if backend_bad_mode_output="$(helm template test charts/backend \
  --set tasks.executionMode=worker 2>&1)"; then
  fail "expected an unknown tasks.executionMode value to be rejected"
fi
assert_contains "$backend_bad_mode_output" "must be 'local' or 'required'" \
  "backend chart should explain the valid tasks.executionMode values"

backend_frontend_version_manifest="$(helm template test charts/backend \
  --set frontendVersionConfigMap.enabled=true)"
assert_contains "$backend_frontend_version_manifest" 'name: frontend-version' \
  "backend deployment should mount the frontend version ConfigMap for build-info metrics"
assert_contains "$backend_frontend_version_manifest" 'name: FRONTEND_VERSION_FILE' \
  "backend deployment should expose FRONTEND_VERSION_FILE when the frontend version ConfigMap is enabled"

if backend_colliding_version_mounts_output="$(helm template test charts/backend \
  --set backupVersionConfigMap.enabled=true \
  --set frontendVersionConfigMap.enabled=true \
  --set frontendVersionConfigMap.mountPath=/etc/hriv-versions 2>&1)"; then
  fail "expected colliding backend version ConfigMap mount paths to be rejected"
fi
assert_contains "$backend_colliding_version_mounts_output" "must differ" \
  "backend deployment should explain that backup and frontend version ConfigMap mount paths must differ"

frontend_zone_aa_manifest="$(helm template test charts/frontend \
  --set scheduling.zoneAntiAffinity.enabled=true \
  --set replicaCount=2)"

frontend_zone_aa_deployment="$(extract_yaml_doc "$frontend_zone_aa_manifest" "Deployment" "test-hriv-frontend")"
assert_contains "$frontend_zone_aa_deployment" "type: RollingUpdate" \
  "frontend deployment should use RollingUpdate when hard zone anti-affinity is enabled with multiple replicas"
assert_contains "$frontend_zone_aa_deployment" "maxSurge: 0" \
  "frontend deployment should set maxSurge: 0 for the zone anti-affinity rollout strategy"
assert_contains "$frontend_zone_aa_deployment" "maxUnavailable: 1" \
  "frontend deployment should set maxUnavailable: 1 for the zone anti-affinity rollout strategy"

frontend_default_manifest="$(helm template test charts/frontend)"

frontend_default_deployment="$(extract_yaml_doc "$frontend_default_manifest" "Deployment" "test-hriv-frontend")"
assert_not_contains "$frontend_default_deployment" "strategy:" \
  "frontend deployment should omit strategy when no rollout override is needed"
assert_contains "$frontend_default_manifest" "kind: ConfigMap" \
  "frontend chart should publish a version ConfigMap for backend build-info metrics"
assert_contains "$frontend_default_manifest" "name: hriv-frontend-version" \
  "frontend chart should render the default frontend version ConfigMap"
assert_contains "$frontend_default_manifest" "location = /api/metrics {" \
  "frontend nginx should intercept the backend-only Prometheus metrics endpoint"
assert_contains "$frontend_default_manifest" "return 404;" \
  "frontend nginx should not expose Prometheus metrics through the public ingress"

frontend_override_manifest="$(helm template test charts/frontend \
  --set scheduling.zoneAntiAffinity.enabled=true \
  --set replicaCount=2 \
  --set-json 'updateStrategy={"type":"Recreate"}')"

frontend_override_deployment="$(extract_yaml_doc "$frontend_override_manifest" "Deployment" "test-hriv-frontend")"
assert_contains "$frontend_override_deployment" "type: Recreate" \
  "frontend deployment should honour an explicit Recreate override"
assert_not_contains "$frontend_override_deployment" "type: RollingUpdate" \
  "frontend deployment should not render RollingUpdate when updateStrategy explicitly requests Recreate"
assert_not_contains "$frontend_override_deployment" "maxSurge:" \
  "frontend deployment should not render rollingUpdate settings when updateStrategy explicitly requests Recreate"

echo "Helm chart regression checks passed."
