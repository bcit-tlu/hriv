# hriv-restore-validation

This chart provides only the core issue #1251 restore-validation infrastructure. It does not create the namespace or any Secret. It installs fixed ResourceQuota and LimitRange guardrails for Jobs, PVCs, storage, compute, and CNPG targets. Defaults lint and render safely but are non-runnable: invocation and the Barman ObjectStore are disabled, image digests point to `example.invalid`, and default-deny ingress/egress is active.

## Enabling a reviewed invocation

This #1251 chart cannot enable `invocation.enabled`: it deliberately renders only namespace-wide default-deny and fails enabled rendering even when reviewed digests, profile facts, namespace, and `objectStore.enabled=true` are supplied. #1253 must first add fixed, reviewed Azure, Kubernetes API, DNS, and CNPG egress resources; an arbitrary values-driven generic egress escape, including `0.0.0.0/0` or `::/0`, is not acceptable.

The chart creates immutable ConfigMaps containing strict `config.json`, `profile.json`, `policy.json`, and aggregate `templates.yaml`. The source-policy digest is supplied with the reviewed canonical backup evidence and is recomputed by the Python parser before any API client or side effect; Helm validates its shape but does not independently hash JSON with different escaping rules. Their `-v1` names are payload identities, not mutable aliases: any reviewed payload change must bump the resource name and every mounted reference together; Helm must never update data under an existing immutable name. The optional one-shot Job definition invokes `run`, supplies Job name/UID and Pod UID through downward-API fieldRefs, and mounts all documents read-only, but remains render-blocked until #1253. #1253 owns schedules, reapers, exporter, telemetry/alerts, fixed approved egress resources, admission enforcement, version-rollout sequencing, and Flux rollout.

## Credentials

Externally provision these validation-local, read-only Secrets:

- `hriv-restore-validation-azure-read`, key `azureReadSasUrl`, containing the backup child's fixed `AZURE_READ_SAS_URL` for the reviewed container/prefix.
- `hriv-restore-validation-barman-read`, keys `storage_account_name` and `storage_sas_token`. The ObjectStore maps these to `storageAccount` and `storageSasToken`. Account keys, connection strings, and write credentials are forbidden.

Database/consistency children mount the fresh CNPG-generated `rv-<suffix>-pg-superuser` Secret. The controller never reads any Secret API.

## Fixed children

All child Jobs use `hriv-restore-validation-no-permission`, token automount false, `backoffLimit: 0`, `restartPolicy: Never`, no TTL, restricted security contexts, and digest images from the exact profile/template allowlist. Recovery uses external cluster `pg-core-source`, ObjectStore `hriv-restore-validation-pg-core`, Barman `serverName: pg-core`, and exact `recoveryTarget.targetLSN` plus decimal-string `recoveryTarget.targetTLI`, derived from the first eight hexadecimal characters of `wal_fence_file`. CNPG observation requires `Ready=True`, phase `Cluster in healthy state`, and `readyInstances == instances == 1`; the database child then proves recovery completion, the bound timeline and target LSN, and a positive singleton fence row observed at the target. Fence generation is dynamic recovered evidence and is never a static profile value.

The source PVC defaults to 40Gi and explicitly uses the Longhorn storage class. Recovered CNPG storage also uses Longhorn and schedules only on `bcit.ca/longhorn-storage=true` nodes. The backup restore mounts its PVC at `/restore` and targets `/restore/data`, with exact snapshot, recovery-set ID and manifest digest arguments. Success cleanup uses exact UID preconditions and waits for foreground deletion absence.

## Core-only success

After database, source and consistency gates and confirmed cleanup, state records `core_succeeded` but does not advance `last_complete_success`. #1252 owns application, credential-init, Redis, tile and viewer validation.

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
