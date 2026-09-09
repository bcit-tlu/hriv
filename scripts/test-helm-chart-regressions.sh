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

assert_occurrences() {
  local haystack="$1"
  local needle="$2"
  local expected="$3"
  local message="$4"
  local actual
  actual="$(grep -Fc -- "$needle" <<<"$haystack")"
  if [[ "$actual" -ne "$expected" ]]; then
    fail "$message (expected $expected, found $actual)"
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

extract_kind_name() {
  local manifest="$1"
  local kind="$2"
  awk -v kind="$kind" '
    $0 == "kind: " kind { found=1; next }
    found && /^  name: / { print $2; exit }
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
  --set onDemandBackup.enabled=false \
  --set persistence.sourceImages.enabled=false \
  --set persistence.tiles.enabled=false \
  --set persistence.backups.enabled=false)"

assert_contains "$backup_no_volumes_manifest" "mountPath: /tmp" \
  "backup deployment should retain its writable /tmp mount when every data volume is disabled"
assert_contains "$backup_no_volumes_manifest" "emptyDir:" \
  "backup deployment should retain its /tmp emptyDir when every data volume is disabled"
assert_not_contains "$backup_no_volumes_manifest" "persistentVolumeClaim:" \
  "backup deployment should omit PVC volumes when every backup chart data volume is disabled"

backup_default_manifest="$(helm template test charts/backup)"
backup_deployment="$(extract_yaml_doc "$backup_default_manifest" "Deployment" "test-hriv-backup")"
backup_on_demand_cronjob="$(extract_yaml_doc "$backup_default_manifest" "CronJob" "test-hriv-backup-on-demand")"
backup_long_name_a_manifest="$(helm template test charts/backup \
  --set fullnameOverride=abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyza)"
backup_long_name_b_manifest="$(helm template test charts/backup \
  --set fullnameOverride=abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyzb)"
backup_long_name_a="$(extract_kind_name "$backup_long_name_a_manifest" "CronJob")"
backup_long_name_b="$(extract_kind_name "$backup_long_name_b_manifest" "CronJob")"
[[ ${#backup_long_name_a} -le 52 && "$backup_long_name_a" == *-on-demand ]] || \
  fail "on-demand CronJob A should retain its suffix within the 52-character limit"
[[ ${#backup_long_name_b} -le 52 && "$backup_long_name_b" == *-on-demand ]] || \
  fail "on-demand CronJob B should retain its suffix within the 52-character limit"
[[ "$backup_long_name_a" != "$backup_long_name_b" ]] || \
  fail "distinct long fullnames with a shared prefix should produce distinct on-demand CronJob names"

backup_vault_manifest="$(helm template test charts/backup \
  --set vault.enabled=true \
  --set env.AZURE_STORAGE_CONTAINER=hrivbackup)"
backup_existing_secret_manifest="$(helm template test charts/backup \
  --set azureSecretName=hriv-backup-azure-existing \
  --set env.AZURE_STORAGE_CONTAINER=hrivbackup)"
backup_existing_secret_deployment="$(extract_yaml_doc \
  "$backup_existing_secret_manifest" "Deployment" "test-hriv-backup")"
backup_vault_deployment="$(extract_yaml_doc \
  "$backup_vault_manifest" "Deployment" "test-hriv-backup")"
backup_existing_secret_on_demand="$(extract_yaml_doc \
  "$backup_existing_secret_manifest" "CronJob" "test-hriv-backup-on-demand")"
backup_vault_on_demand="$(extract_yaml_doc \
  "$backup_vault_manifest" "CronJob" "test-hriv-backup-on-demand")"

assert_contains "$backup_on_demand_cronjob" "schedule: \"0 0 31 2 *\"" \
  "on-demand CronJob should use the inert default schedule"
assert_contains "$backup_on_demand_cronjob" "suspend: true" \
  "on-demand CronJob must remain suspended"
assert_contains "$backup_on_demand_cronjob" "concurrencyPolicy: Forbid" \
  "on-demand CronJob should reject controller-level overlap"
assert_contains "$backup_on_demand_cronjob" 'args: ["backup"]' \
  "on-demand CronJob should invoke the one-shot backup command"
assert_contains "$backup_on_demand_cronjob" "restartPolicy: Never" \
  "on-demand Job pods must not restart"
assert_contains "$backup_on_demand_cronjob" "backoffLimit: 0" \
  "on-demand Jobs must not retry overlap rejection"
assert_contains "$backup_on_demand_cronjob" "activeDeadlineSeconds: 21600" \
  "on-demand Jobs should default to a six-hour deadline"
assert_not_contains "$backup_on_demand_cronjob" "ttlSecondsAfterFinished" \
  "on-demand Jobs should remain inspectable until manually deleted"
assert_contains "$backup_on_demand_cronjob" "claimName: test-hriv-backup-source-images" \
  "on-demand Jobs should mount the same source-images PVC as the Deployment"
assert_contains "$backup_on_demand_cronjob" "claimName: test-hriv-backup-backups" \
  "on-demand Jobs should mount the shared lock and state PVC"
assert_contains "$backup_on_demand_cronjob" "mountPath: /tmp" \
  "on-demand Jobs should retain the writable tmp mount"
assert_contains "$backup_on_demand_cronjob" "emptyDir:" \
  "on-demand Jobs should use the same tmp emptyDir"
assert_contains "$backup_on_demand_cronjob" "ephemeral-storage:" \
  "on-demand Jobs should use the same resource requests and limits"
assert_contains "$backup_on_demand_cronjob" "app.kubernetes.io/name: hriv-backup-on-demand" \
  "on-demand Job pods should not match the backup Deployment selector"
assert_contains "$backup_on_demand_cronjob" "automountServiceAccountToken: false" \
  "on-demand Jobs should use the Deployment automount setting"
assert_contains "$backup_on_demand_cronjob" "runAsUser: 10001" \
  "on-demand Jobs should use the Deployment pod security context"
assert_contains "$backup_on_demand_cronjob" "readOnlyRootFilesystem: true" \
  "on-demand Jobs should use the Deployment container security context"
assert_contains "$backup_on_demand_cronjob" "name: DATABASE_URL" \
  "on-demand Jobs should use the production PostgreSQL Secret reference"
assert_contains "$backup_on_demand_cronjob" 'value: "0 10 * * *"' \
  "on-demand Jobs should inherit the unchanged internal scheduler environment"
assert_contains "$backup_deployment" 'args: ["cron"]' \
  "long-running backup Deployment should remain the internal cron scheduler"
assert_contains "$backup_deployment" 'value: "0 10 * * *"' \
  "long-running backup Deployment should retain the 10:00 UTC schedule"

backup_disabled_on_demand_manifest="$(helm template test charts/backup \
  --set onDemandBackup.enabled=false)"
assert_not_contains "$backup_disabled_on_demand_manifest" "test-hriv-backup-on-demand" \
  "disabled on-demand backup should omit the CronJob"

if backup_missing_shared_pvc_output="$(helm template test charts/backup \
  --set persistence.backups.enabled=false 2>&1)"; then
  fail "expected enabled on-demand backup without the shared backup PVC to be rejected"
fi
assert_contains "$backup_missing_shared_pvc_output" "onDemandBackup.enabled=true requires persistence.backups.enabled=true" \
  "backup chart should explain the shared lock and state PVC requirement"

assert_not_contains "$backup_on_demand_cronjob" "AZURE_STORAGE_CONNECTION_STRING" \
  "local-PVC-only on-demand Jobs should not reference an Azure Secret"
assert_contains "$backup_existing_secret_on_demand" "name: hriv-backup-azure-existing" \
  "Azure on-demand Jobs should reference the explicitly selected external Secret"
assert_contains "$backup_existing_secret_on_demand" "key: AZURE_STORAGE_CONNECTION_STRING" \
  "Azure on-demand Jobs should use the production Secret key"
assert_contains "$backup_vault_on_demand" "name: azure-storage-credentials" \
  "Vault-backed on-demand Jobs should reference the externally managed target Secret"
assert_not_contains "$backup_on_demand_cronjob$backup_existing_secret_on_demand$backup_vault_on_demand" \
  "azureConnectionString" \
  "on-demand Job templates must never contain a credential value"

backup_on_demand_scheduling_manifest="$(helm template test charts/backup \
  --set image.repository=registry.example/hriv-backup \
  --set image.tag=issue-1241 \
  --set postgresSecretName=production-postgres \
  --set tmp.sizeLimit=2Gi \
  --set resources.requests.cpu=250m \
  --set nodeSelector.disktype=longhorn \
  --set tolerations[0].key=storage \
  --set tolerations[0].operator=Equal \
  --set tolerations[0].value=backup \
  --set tolerations[0].effect=NoSchedule \
  --set-json 'affinity={"nodeAffinity":{"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":1,"preference":{"matchExpressions":[{"key":"storage","operator":"In","values":["longhorn"]}]}}]},"podAntiAffinity":{"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":2,"podAffinityTerm":{"labelSelector":{"matchLabels":{"avoid":"busy"}},"topologyKey":"topology.kubernetes.io/zone"}}]},"podAffinity":{"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":3,"podAffinityTerm":{"labelSelector":{"matchLabels":{"prefer":"source"}},"topologyKey":"kubernetes.io/hostname"}}],"requiredDuringSchedulingIgnoredDuringExecution":[{"labelSelector":{"matchLabels":{"custom-required":"true"}},"topologyKey":"topology.kubernetes.io/zone"}]}}')"
backup_scheduling_deployment="$(extract_yaml_doc \
  "$backup_on_demand_scheduling_manifest" "Deployment" "test-hriv-backup")"
backup_scheduling_on_demand="$(extract_yaml_doc \
  "$backup_on_demand_scheduling_manifest" "CronJob" "test-hriv-backup-on-demand")"
for workload in "$backup_scheduling_deployment" "$backup_scheduling_on_demand"; do
  assert_contains "$workload" 'image: "registry.example/hriv-backup:issue-1241"' \
    "Deployment and on-demand Job should use the configured production image"
  assert_contains "$workload" "name: production-postgres" \
    "Deployment and on-demand Job should use the configured PostgreSQL Secret"
  assert_contains "$workload" "sizeLimit: 2Gi" \
    "Deployment and on-demand Job should use the configured tmp emptyDir"
  assert_contains "$workload" "cpu: 250m" \
    "Deployment and on-demand Job should use the configured resources"
  assert_contains "$workload" "disktype: longhorn" \
    "Deployment and on-demand Job should use the configured node selector"
  assert_contains "$workload" "key: storage" \
    "Deployment and on-demand Job should use the configured tolerations"
done
assert_occurrences "$backup_scheduling_deployment" "podAffinity:" 1 \
  "Deployment affinity should render one merged podAffinity key"
assert_occurrences "$backup_scheduling_deployment" "requiredDuringSchedulingIgnoredDuringExecution:" 1 \
  "Deployment affinity should render one merged required pod-affinity list"
assert_contains "$backup_scheduling_deployment" "custom-required: \"true\"" \
  "Deployment affinity should preserve required custom pod affinity"
assert_occurrences "$backup_scheduling_on_demand" "podAffinity:" 1 \
  "on-demand affinity should render one merged podAffinity key"
assert_occurrences "$backup_scheduling_on_demand" "requiredDuringSchedulingIgnoredDuringExecution:" 1 \
  "on-demand affinity should render one merged required pod-affinity list"
assert_contains "$backup_scheduling_on_demand" "nodeAffinity:" \
  "on-demand affinity should preserve custom node affinity"
assert_contains "$backup_scheduling_on_demand" "podAntiAffinity:" \
  "on-demand affinity should preserve custom pod anti-affinity"
assert_contains "$backup_scheduling_on_demand" "prefer: source" \
  "on-demand affinity should preserve preferred pod affinity"
assert_contains "$backup_scheduling_on_demand" "custom-required: \"true\"" \
  "on-demand affinity should preserve required custom pod affinity"
assert_contains "$backup_scheduling_on_demand" "app.kubernetes.io/name: hriv-backup" \
  "on-demand affinity should select the backup Deployment app name"
assert_contains "$backup_scheduling_on_demand" "app.kubernetes.io/instance: test" \
  "on-demand affinity should select the backup Deployment release instance"
assert_contains "$backup_scheduling_on_demand" "topologyKey: kubernetes.io/hostname" \
  "on-demand affinity should require the Deployment node for the RWO backup PVC"

backup_shared_source_on_demand="$(extract_yaml_doc \
  "$(helm template test charts/backup \
    --set persistence.sourceImages.existingClaim=hriv-backend-source-images)" \
  "CronJob" "test-hriv-backup-on-demand")"
assert_not_contains "$backup_shared_source_on_demand" "app.kubernetes.io/name: hriv-backend" \
  "on-demand affinity should inherit source-PVC colocation through the Deployment rather than adding a redundant required term"
assert_contains "$backup_shared_source_on_demand" "app.kubernetes.io/instance: test" \
  "on-demand affinity should require the backup Deployment instance"

assert_not_contains "$backup_default_manifest" "kind: Secret" \
  "backup chart must not render a Secret for a default standalone install"
assert_not_contains "$backup_vault_manifest" "kind: Secret" \
  "backup chart must not render a Secret when Vault integration is enabled"
assert_not_contains "$backup_existing_secret_manifest" "kind: Secret" \
  "backup chart must not render a Secret when an explicit pre-existing Azure Secret is selected"
assert_contains "$backup_existing_secret_deployment" "name: hriv-backup-azure-existing" \
  "backup deployment should reference an explicitly selected pre-existing Azure Secret"
assert_contains "$backup_existing_secret_deployment" "key: AZURE_STORAGE_CONNECTION_STRING" \
  "backup deployment should read the connection string from the required Secret key"
assert_contains "$backup_vault_deployment" "name: azure-storage-credentials" \
  "Vault-enabled Azure mode should reference the externally managed target Secret"
assert_not_contains "$backup_deployment" "AZURE_STORAGE_CONNECTION_STRING" \
  "local-PVC-only mode should not require or reference an Azure Secret"
assert_not_contains "$backup_default_manifest$backup_vault_manifest$backup_existing_secret_manifest" \
  "azureConnectionString" \
  "backup chart output must never contain the former placeholder Azure credential"
backup_secret_template="$(cat charts/backup/templates/secrets.yaml)"
assert_contains "$backup_secret_template" 'lookup "v1" "Secret"' \
  "backup chart should detect a legacy Helm-owned Secret during a live upgrade"
assert_contains "$backup_secret_template" 'meta.helm.sh/release-name' \
  "backup chart should preserve only a Secret owned by the same Helm release"
assert_contains "$backup_secret_template" 'helm.sh/resource-policy: keep' \
  "backup chart should protect a retained legacy Secret from later pruning"
assert_not_contains "$backup_secret_template" "azureConnectionString" \
  "backup Secret migration template must not embed the former placeholder"

for vault_enabled in false true; do
  if backup_missing_azure_secret_output="$(helm template test charts/backup \
    --set vault.enabled="$vault_enabled" \
    --set env.AZURE_STORAGE_CONTAINER=hrivbackup \
    --set-string azureSecretName= 2>&1)"; then
    fail "expected empty azureSecretName to be rejected when vault.enabled=$vault_enabled"
  fi
  assert_contains "$backup_missing_azure_secret_output" "this chart does not create Azure credentials" \
    "backup chart should explain its credential ownership when azureSecretName is empty and vault.enabled=$vault_enabled"
  assert_contains "$backup_missing_azure_secret_output" "pre-existing Secret (or Vault Secrets Operator target)" \
    "backup chart should tell operators how to provide Azure credentials when vault.enabled=$vault_enabled"
done

backup_local_only_manifest="$(helm template test charts/backup \
  --set-string azureSecretName=)"
backup_local_only_deployment="$(extract_yaml_doc \
  "$backup_local_only_manifest" "Deployment" "test-hriv-backup")"
assert_not_contains "$backup_local_only_manifest" "kind: Secret" \
  "local-PVC-only mode should render without a credential Secret"
assert_not_contains "$backup_local_only_deployment" "AZURE_STORAGE_CONNECTION_STRING" \
  "local-PVC-only mode should render without an Azure credential reference"

assert_contains "$backup_deployment" "automountServiceAccountToken: false" \
  "backup pod should not automount a service account token"
assert_contains "$backup_deployment" "runAsNonRoot: true" \
  "backup pod should require a non-root UID"
assert_contains "$backup_deployment" "runAsUser: 10001" \
  "backup pod should default to UID 10001"
assert_contains "$backup_deployment" "runAsGroup: 10001" \
  "backup pod should default to GID 10001"
assert_contains "$backup_deployment" "fsGroup: 10001" \
  "backup pod should use fsGroup 10001 for writable PVC ownership"
assert_contains "$backup_deployment" "fsGroupChangePolicy: OnRootMismatch" \
  "backup pod should avoid unnecessary recursive PVC ownership changes"
assert_contains "$backup_deployment" "type: RuntimeDefault" \
  "backup pod should use the runtime-default seccomp profile"
assert_contains "$backup_deployment" "allowPrivilegeEscalation: false" \
  "backup container should disallow privilege escalation"
assert_contains "$backup_deployment" "readOnlyRootFilesystem: true" \
  "backup container should use a read-only root filesystem"
assert_contains "$backup_deployment" "drop:" \
  "backup container should render a dropped-capabilities list"
assert_contains "$backup_deployment" "- ALL" \
  "backup container should drop all Linux capabilities"
assert_contains "$backup_deployment" "name: HOME" \
  "backup container should set HOME to its deterministic writable path"
assert_contains "$backup_deployment" "name: TMPDIR" \
  "backup container should set TMPDIR to its deterministic writable path"
assert_contains "$backup_deployment" "name: PYTHONDONTWRITEBYTECODE" \
  "backup container should disable Python bytecode writes on the root filesystem"
assert_contains "$backup_deployment" "mountPath: /tmp" \
  "backup container should mount a writable /tmp"
assert_contains "$backup_deployment" "emptyDir:" \
  "backup pod should back /tmp with an emptyDir"
assert_contains "$backup_deployment" "sizeLimit: 1Gi" \
  "backup pod should bound the /tmp emptyDir to 1Gi"

backup_security_override_deployment="$(extract_yaml_doc \
  "$(helm template test charts/backup \
    --set podSecurityContext.runAsUser=20002 \
    --set podSecurityContext.runAsGroup=20003 \
    --set podSecurityContext.fsGroup=20004 \
    --set podSecurityContext.fsGroupChangePolicy=Always \
    --set podSecurityContext.seccompProfile.type=Unconfined \
    --set containerSecurityContext.readOnlyRootFilesystem=false \
    --set containerSecurityContext.allowPrivilegeEscalation=true)" \
  "Deployment" "test-hriv-backup")"
assert_contains "$backup_security_override_deployment" "runAsUser: 20002" \
  "backup deployment should render a platform-required UID override"
assert_contains "$backup_security_override_deployment" "runAsGroup: 20003" \
  "backup deployment should render a platform-required GID override"
assert_contains "$backup_security_override_deployment" "fsGroup: 20004" \
  "backup deployment should render a platform-required fsGroup override"
assert_contains "$backup_security_override_deployment" "fsGroupChangePolicy: Always" \
  "backup deployment should render an fsGroup policy override"
assert_contains "$backup_security_override_deployment" "type: Unconfined" \
  "backup deployment should render a seccomp profile override"
assert_contains "$backup_security_override_deployment" "readOnlyRootFilesystem: false" \
  "backup deployment should render a root-filesystem override"
assert_contains "$backup_security_override_deployment" "allowPrivilegeEscalation: true" \
  "backup deployment should render a privilege-escalation override"

assert_contains "$backup_deployment" "ephemeral-storage:" \
  "backup deployment should set explicit ephemeral-storage requests and limits so an archive staging fallback to pod-local /tmp fails as a limit error"
assert_not_contains "$backup_deployment" "BACKUP_STAGING_DIR" \
  "backup deployment should omit BACKUP_STAGING_DIR so the service keeps its <backups volume>/.staging default"
assert_contains "$backup_deployment" 'value: "0 10 * * *"' \
  "backup deployment should schedule heavy work at the non-peak 10:00 UTC window"
assert_contains "$backup_deployment" "name: BACKUP_INVENTORY_TIMEOUT_SECONDS" \
  "backup deployment should render the bounded inventory timeout"
assert_contains "$backup_deployment" 'value: "120"' \
  "backup deployment should default the bounded inventory timeout to 120 seconds"

backup_inventory_timeout_deployment="$(extract_yaml_doc \
  "$(helm template test charts/backup --set env.BACKUP_INVENTORY_TIMEOUT_SECONDS=45)" \
  "Deployment" "test-hriv-backup")"
assert_contains "$backup_inventory_timeout_deployment" 'value: "45"' \
  "backup deployment should render an explicit inventory timeout override"

backup_rwx_deployment="$(extract_yaml_doc \
  "$(helm template test charts/backup \
    --set persistence.sourceImages.existingClaim=hriv-backend-source-images \
    --set colocateWithSourcePod=false)" \
  "Deployment" "test-hriv-backup")"
assert_not_contains "$backup_rwx_deployment" "podAffinity:" \
  "backup deployment should allow heavy RWX reads to schedule away from backend pods"

backup_staging_deployment="$(extract_yaml_doc \
  "$(helm template test charts/backup --set env.BACKUP_STAGING_DIR=/mnt/staging)" \
  "Deployment" "test-hriv-backup")"
assert_contains "$backup_staging_deployment" 'value: "/mnt/staging"' \
  "backup deployment should render an explicit env.BACKUP_STAGING_DIR override"

backup_restore_target_deployment="$(extract_yaml_doc \
  "$(helm template test charts/backup --set restoreTarget.existingClaim=hriv-restore-source-images)" \
  "Deployment" "test-hriv-backup")"
assert_contains "$backup_restore_target_deployment" "claimName: hriv-restore-source-images" \
  "backup deployment should mount an explicitly selected restore target claim"
assert_contains "$backup_restore_target_deployment" "mountPath: /restore-target" \
  "backup deployment should mount the restore target at its configured path"

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
backend_worker_logging_auto_instrumentation="$(grep -F -A1 'name: OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED' <<<"$backend_worker_deployment")"
assert_contains "$backend_worker_logging_auto_instrumentation" 'value: "true"' \
  "backend worker deployment should bridge stdlib logs to OTLP when OpenTelemetry is enabled"
assert_contains "$backend_worker_deployment" 'name: WORKER_IMAGE_TAG' \
  "backend worker deployment should surface the worker image tag for build-info metrics"

backend_mode_default_manifest="$(helm template test charts/backend)"
backend_mode_default_deployment="$(extract_yaml_doc "$backend_mode_default_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_mode_default_deployment" 'name: TASK_EXECUTION_MODE' \
  "backend deployment should always render TASK_EXECUTION_MODE"
assert_contains "$backend_mode_default_deployment" 'value: "local"' \
  "backend deployment should default TASK_EXECUTION_MODE to local"
assert_contains "$backend_mode_default_deployment" 'name: REBUILD_PARALLEL_ENABLED' \
  "backend deployment should render the durable rebuild feature flag"
backend_default_rebuild_enabled="$(grep -F -A1 'name: REBUILD_PARALLEL_ENABLED' <<<"$backend_mode_default_deployment")"
assert_contains "$backend_default_rebuild_enabled" 'value: "false"' \
  "backend deployment should default durable parallel rebuilding to disabled"
assert_contains "$backend_mode_default_deployment" 'name: WORKER_MAX_JOBS' \
  "backend deployment should render WORKER_MAX_JOBS for the in-process fallback concurrency"
assert_not_contains "$backend_mode_default_deployment" 'name: WORKER_TOTAL_SLOTS' \
  "backend deployment should omit WORKER_TOTAL_SLOTS when redis.worker.totalSlots is unset"
assert_not_contains "$backend_mode_default_deployment" 'name: FEEDBACK_EMAIL_SMTP_SECURITY' \
  "backend deployment should omit FEEDBACK_EMAIL_SMTP_SECURITY when feedback.email.smtpSecurity is unset"
assert_not_contains "$backend_mode_default_deployment" 'name: FEEDBACK_EMAIL_TO' \
  "backend deployment should omit FEEDBACK_EMAIL_TO when no email secret or chart value is set"
assert_not_contains "$backend_mode_default_deployment" 'name: FEEDBACK_EMAIL_FROM' \
  "backend deployment should omit FEEDBACK_EMAIL_FROM when no email secret or chart value is set"

backend_feedback_security_manifest="$(helm template test charts/backend \
  --set feedback.provider=email \
  --set feedback.email.existingSecret=hriv-feedback-smtp-relay \
  --set feedback.email.smtpSecurity=none)"
backend_feedback_security_deployment="$(extract_yaml_doc "$backend_feedback_security_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_feedback_security_deployment" 'name: FEEDBACK_EMAIL_SMTP_SECURITY' \
  "backend deployment should render FEEDBACK_EMAIL_SMTP_SECURITY when feedback.email.smtpSecurity is set"
assert_contains "$backend_feedback_security_deployment" 'value: "none"' \
  "backend deployment should pass the configured SMTP security mode"

backend_feedback_secret_to_from_manifest="$(helm template test charts/backend \
  --set feedback.provider=email \
  --set feedback.email.existingSecret=hriv-feedback-smtp-relay)"
backend_feedback_secret_to_from_deployment="$(extract_yaml_doc "$backend_feedback_secret_to_from_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_feedback_secret_to_from_deployment" 'name: FEEDBACK_EMAIL_TO' \
  "backend deployment should render FEEDBACK_EMAIL_TO when an existingSecret is set"
assert_contains "$backend_feedback_secret_to_from_deployment" 'key: to' \
  "backend deployment should source FEEDBACK_EMAIL_TO from the existingSecret"
assert_contains "$backend_feedback_secret_to_from_deployment" 'name: FEEDBACK_EMAIL_FROM' \
  "backend deployment should render FEEDBACK_EMAIL_FROM when an existingSecret is set"
assert_contains "$backend_feedback_secret_to_from_deployment" 'key: from' \
  "backend deployment should source FEEDBACK_EMAIL_FROM from the existingSecret"
assert_contains "$backend_feedback_secret_to_from_deployment" 'optional: true' \
  "backend deployment should mark optional secret to/from keys as optional"

backend_feedback_values_to_from_manifest="$(helm template test charts/backend \
  --set feedback.provider=email \
  --set feedback.email.existingSecret=hriv-feedback-smtp-relay \
  --set feedback.email.to=override@example.com \
  --set feedback.email.from=sender@example.com)"
backend_feedback_values_to_from_deployment="$(extract_yaml_doc "$backend_feedback_values_to_from_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_feedback_values_to_from_deployment" 'value: "override@example.com"' \
  "backend deployment should use chart value for FEEDBACK_EMAIL_TO"
assert_contains "$backend_feedback_values_to_from_deployment" 'value: "sender@example.com"' \
  "backend deployment should use chart value for FEEDBACK_EMAIL_FROM"
assert_not_contains "$backend_feedback_values_to_from_deployment" 'key: to' \
  "backend deployment should not use secretKeyRef for FEEDBACK_EMAIL_TO when chart value is set"
assert_not_contains "$backend_feedback_values_to_from_deployment" 'key: from' \
  "backend deployment should not use secretKeyRef for FEEDBACK_EMAIL_FROM when chart value is set"

backend_required_manifest="$(helm template test charts/backend \
  --set tasks.executionMode=required \
  --set tasks.rebuild.parallelEnabled=true \
  --set tasks.rebuild.parallelism=3 \
  --set tasks.rebuild.pumpCadenceSeconds=120 \
  --set redis.enabled=true \
  --set redis.worker.enabled=true \
  --set redis.worker.totalSlots=8)"

backend_required_api="$(extract_yaml_doc "$backend_required_manifest" "Deployment" "test-hriv-backend")"
assert_contains "$backend_required_api" 'value: "required"' \
  "backend deployment should render TASK_EXECUTION_MODE=required"
assert_contains "$backend_required_api" 'name: REBUILD_PARALLEL_ENABLED' \
  "backend deployment should render the durable rebuild feature flag"
backend_required_rebuild_enabled="$(grep -F -A1 'name: REBUILD_PARALLEL_ENABLED' <<<"$backend_required_api")"
assert_contains "$backend_required_rebuild_enabled" 'value: "true"' \
  "backend deployment should permit durable rebuilding in required mode"
assert_contains "$backend_required_api" 'name: REBUILD_PARALLELISM' \
  "backend deployment should render the durable rebuild execution window"
backend_required_rebuild_parallelism="$(grep -F -A1 'name: REBUILD_PARALLELISM' <<<"$backend_required_api")"
assert_contains "$backend_required_rebuild_parallelism" 'value: "3"' \
  "backend deployment should render the configured rebuild parallelism"
assert_contains "$backend_required_api" 'name: REBUILD_PUMP_CADENCE_SECONDS' \
  "backend deployment should render the rebuild pump cadence"
backend_required_rebuild_cadence="$(grep -F -A1 'name: REBUILD_PUMP_CADENCE_SECONDS' <<<"$backend_required_api")"
assert_contains "$backend_required_rebuild_cadence" 'value: "120"' \
  "backend deployment should render the configured pump cadence"
assert_not_contains "$backend_required_api" 'name: WORKER_TOTAL_SLOTS' \
  "backend deployment should not render deprecated WORKER_TOTAL_SLOTS"

backend_required_worker="$(extract_yaml_doc "$backend_required_manifest" "Deployment" "test-hriv-backend-worker")"
assert_contains "$backend_required_worker" 'name: TASK_EXECUTION_MODE' \
  "worker deployment should render TASK_EXECUTION_MODE"
assert_contains "$backend_required_worker" 'value: "required"' \
  "worker deployment should render TASK_EXECUTION_MODE=required"
assert_contains "$backend_required_worker" 'name: REBUILD_PARALLEL_ENABLED' \
  "worker deployment should render the durable rebuild feature flag"
assert_contains "$backend_required_worker" 'name: REBUILD_CHILD_TIMEOUT_SECONDS' \
  "worker deployment should render the durable rebuild child timeout"
assert_contains "$backend_required_worker" 'name: REBUILD_LEASE_SECONDS' \
  "worker deployment should render the durable rebuild lease"
assert_contains "$backend_required_worker" 'name: REBUILD_HEARTBEAT_SECONDS' \
  "worker deployment should render the durable rebuild heartbeat cadence"
assert_contains "$backend_required_worker" 'name: WORKER_MAX_JOBS' \
  "worker deployment should render WORKER_MAX_JOBS"
assert_not_contains "$backend_required_worker" 'name: WORKER_TOTAL_SLOTS' \
  "worker deployment should not render deprecated WORKER_TOTAL_SLOTS"
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

if backend_rebuild_local_output="$(helm template test charts/backend \
  --set tasks.rebuild.parallelEnabled=true 2>&1)"; then
  fail "expected durable rebuilding in local execution mode to be rejected"
fi
assert_contains "$backend_rebuild_local_output" "requires tasks.executionMode=required" \
  "backend chart should require durable rebuilding to use the dedicated worker"

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
assert_contains "$frontend_default_manifest" "location = /api/health/ready {" \
  "frontend nginx should intercept the backend readiness probe endpoint"
frontend_health_ready_location="$(grep -F -A2 "location = /api/health/ready {" <<<"$frontend_default_manifest")"
assert_contains "$frontend_health_ready_location" "return 404;" \
  "frontend nginx should block the backend readiness probe endpoint"
assert_contains "$frontend_default_manifest" "location = /api/health/storage {" \
  "frontend nginx should intercept the backend storage probe endpoint"
frontend_health_storage_location="$(grep -F -A2 "location = /api/health/storage {" <<<"$frontend_default_manifest")"
assert_contains "$frontend_health_storage_location" "return 404;" \
  "frontend nginx should block the backend storage probe endpoint"

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
