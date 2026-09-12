# hriv-restore-validation

This chart provides the #1251 core controller and simplified #1253 operational scheduling/egress resources. It does not create the namespace or any Secret. It installs fixed ResourceQuota and LimitRange guardrails for Jobs, PVCs, storage, compute, and CNPG targets. Defaults lint and render safely but are non-runnable: `operational.enabled` and the Barman ObjectStore are disabled, workload image digests point to `example.invalid`, and namespace-wide default-deny is active.

## Enabling reviewed operations

Operational mode renders the weekly `hriv-restore-validation-weekly` CronJob (`0 11 * * 0`, UTC, suspended by default for latest-first acceptance), suspended `hriv-restore-validation-on-demand` and `hriv-restore-validation-cleanup` CronJobs, and the fixed Envoy CONNECT proxy/network policies. It requires namespace `hriv-restore-validation`, `maxRetainedRuns: 1`, the ObjectStore, reviewed digest-pinned workload images, one to four literal Azure Blob authorities ending in `:443`, and the exact reviewed Envoy v1.39.1 digest. Only the proxy receives broad TCP/443 egress; its virtual host has no wildcard domain or route. Selection/source-restore and CNPG receive `HTTPS_PROXY`; controller, database-validation, and consistency do not.

The chart creates immutable ConfigMaps containing strict `config.json`, `profile.json`, digest-only `policy.json`, and aggregate `templates.yaml`. Policy has exactly `policy_version`, `source_state_sha256`, `missing_count`, and `orphan_count`; chart values expose only `sha256`, `missingCount`, and `orphanCount`, never the reviewed path lists. Selection strictly canonicalizes the complete backup-emitted source state, recomputes its digest/counts, and persists that full bounded state as immutable run evidence before comparing it to the mounted policy. The canonical digest-only policy document also has its own computed identity digest, bound into run evidence. The current controller/profile/policy/template identities are atomically named `-v5`; they are payload identities, not mutable aliases. An upgrade creates the four `-v5` ConfigMaps and moves every fixed mount/reference together, never patches prior-generation data, and leaves unreferenced objects for operator-managed cleanup within the 32-ConfigMap quota. The fixed state ConfigMap and Lease names do not change. Environment overlays—not this chart default—must retain digest `958b1dc2dca298c56fd96dd80b6c694144905e22c00c4b3ca9d2c59c3b666083` with counts 39/3 until separately reviewed; safe defaults remain the empty-state digest and zero counts.

Weekly and on-demand runs share one parameterized fixed Job template with no retry, `restartPolicy: Never`, a six-hour deadline, deterministic CronJob ownership/naming, and bounded native Job history. Weekly retains CronJob history 2 and has no TTL. Standalone Jobs created from the suspended on-demand and cleanup CronJobs set native `ttlSecondsAfterFinished: 604800` (seven days); this is Kubernetes evidence cleanup, not an application reaper. Preserve or download Job/Pod logs and final JSON before that deadline, or explicitly delete reviewed Jobs sooner. Cleanup has no run-ID argument and reads only the sole retained state record. The 32-Job quota and runtime preflight count all namespace Jobs, including retained evidence, conservatively before reserving child Jobs. Requests are bounded at 6Gi and limits at 8Gi to align with the shared namespace guardrail. The 320Gi storage quota permits one active or one retained environment; the PVC LimitRange maximum is 200Gi so the reviewed stable `sourcePvcSize: 160Gi` covers 128,986,771,498 source bytes plus controller margin. Latest remains 40Gi.

## Credentials

Externally provision these validation-local, read-only Secrets:

- `hriv-restore-validation-azure-read`, key `azureReadSasUrl`, containing the backup child's fixed `AZURE_READ_SAS_URL` for the reviewed container/prefix.
- `hriv-restore-validation-barman-read`, keys `storage_account_name` and `storage_sas_token`. The ObjectStore maps these to `storageAccount` and `storageSasToken`. Account keys, connection strings, and write credentials are forbidden.

Database/consistency children mount the fresh CNPG-generated `rv-<suffix>-pg-superuser` Secret. The controller never reads any Secret API.

## Fixed children

All child Jobs use `hriv-restore-validation-no-permission`, token automount false, `backoffLimit: 0`, `restartPolicy: Never`, no TTL, restricted security contexts, and digest images from the exact profile/template allowlist. Recovery uses external cluster `pg-core-source`, ObjectStore `hriv-restore-validation-pg-core`, Barman `serverName: pg-core`, and exact `recoveryTarget.targetLSN` plus decimal-string `recoveryTarget.targetTLI`, derived from the first eight hexadecimal characters of `wal_fence_file`. CNPG observation requires `Ready=True`, phase `Cluster in healthy state`, and `readyInstances == instances == 1`; the database child then proves recovery completion, the bound timeline and target LSN, and a positive singleton fence row observed at the target. Fence generation is dynamic recovered evidence and is never a static profile value.

The source PVC defaults to 40Gi (latest); the reviewed stable value is 160Gi and the per-PVC cap is 200Gi. It explicitly uses the Longhorn storage class. Recovered CNPG storage also uses Longhorn and schedules only on `bcit.ca/longhorn-storage=true` nodes. The backup restore mounts its PVC at `/restore` and targets `/restore/data`, with exact snapshot, recovery-set ID and manifest digest arguments. Success cleanup uses exact UID preconditions and waits for foreground deletion absence.

## Core-only success

A preserved terminal `1251` success remains readable during upgrade but is not promoted into `last_complete_success`; the next accepted run replaces it. After database, source and consistency gates and confirmed child absence/cleanup, the Job atomically records strict `last_complete_success` evidence (`run_id`, `completed_at`, `recovery_set_id`, `source_files_sha256`, and succeeded zero-remaining cleanup), emits bounded final operator JSON, and exits successfully. Failure paths never advance that evidence. Consistency internally verifies every canonical absent-row identity/status/path/reason and zero restored orphans, but emits only the missing count/digest, zero unexpected-orphan count, source file digest, counts/bytes, and policy digest. This simplified contract excludes #1252, application/credential-init, Redis, tile/viewer validation, exporters, dashboards, custom metrics, and autonomous reapers.

Operational mode also renders exactly one kube-state-metrics-only `PrometheusRule` alert, `HRIVCoreRestoreValidationUnhealthy`, with `for: 15m`. It compares retained Job start times per weekly/on-demand/cleanup trigger family, so a failure remains unhealthy only until a newer Job of that same family succeeds; it also covers weekly success older than eight days and a never-successful weekly CronJob only after its creation is older than eight days. Weekly Job exit zero means full core plus cleanup; on-demand success cannot clear either a weekly Job failure or the weekly kube-state-metrics freshness timestamp. See the linked flux-fleet restore-validation observability runbook before cleanup or retriggering.

## Validation

```bash
helm lint charts/restore-validation
helm template test charts/restore-validation | kubeconform -strict -summary \
  -schema-location default -ignore-missing-schemas
helm lint charts/restore-validation -n hriv-restore-validation -f reviewed-values.yaml
helm template test charts/restore-validation -n hriv-restore-validation \
  -f reviewed-values.yaml | kubeconform -strict -summary \
  -schema-location default -ignore-missing-schemas
```
