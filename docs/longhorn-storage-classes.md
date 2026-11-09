# Longhorn StorageClasses for HRIV volumes

HRIV's production storage splits authoritative uploads from derived tiles
across independent PVCs (see the
[volume layout](backup-and-disaster-recovery.md#volume-layout-kubernetes--longhorn)
in the DR runbook and the
[cutover procedure](../deploy/README.md#production-storage-split) in the
deploy notes). This page is the StorageClass-side companion: which Longhorn
class to bind each PVC to, why, and what the chart values look like.

> **bcit-tlu deployments:** Flux already manages
> `longhorn-source-images-rwx` and `longhorn-tiles-rwx` in
> `bcit-tlu/flux-fleet` (`infrastructure/longhorn/config/<env>/storageclass.yaml`)
> and `bcit-tlu/flux-fleet-v2`
> (`infrastructure/longhorn/config-tlu/storageclass.yaml`), and the HRIV
> overlays consume them through pre-provisioned PVCs. The backup PVC
> currently binds the chart-default `longhorn` class in the fleet overlays;
> `longhorn-backup-archives` is the recommended dedicated class for new
> deployments. The example manifests in
> [`deploy/longhorn-storageclasses.yaml`](../deploy/longhorn-storageclasses.yaml)
> mirror those definitions for clusters that do not already have them — do
> not apply them where Flux owns the same class names.

## Which class for which volume

| PVC (chart key)                    | Mount point   | Access mode                                       | Recommended class            |
| ---------------------------------- | ------------- | ------------------------------------------------- | ---------------------------- |
| backend `persistence.sourceImages` | `/data`       | `ReadWriteMany` when API/worker replicas > 1      | `longhorn-source-images-rwx` |
| backend `persistence.tiles`        | `/data/tiles` | `ReadWriteMany` when tiles are shared across pods | `longhorn-tiles-rwx`         |
| backup `persistence.backups`       | `/backups`    | `ReadWriteOnce` (single writer; Jobs colocate)    | `longhorn-backup-archives`   |
| database                           | _(CNPG pod)_  | CNPG-managed                                      | out of scope — see CNPG docs |

The backend chart mounts the source-images PVC at `/data` (not
`/data/source_images`) so `/data/.maintenance` and `/data/admin_tasks` keep
working; the tiles PVC mounts at `/data/tiles`. Runtime paths
(`SOURCE_IMAGES_DIR`, `TILES_DIR`) are unchanged, so existing `stored_path`
values and tile URLs survive the split.

### Access modes are a PVC decision, not a class decision

A Longhorn StorageClass does not declare access modes — the PVC does. The
same class can back an RWO volume (plain Longhorn block attach) or an RWX
volume (Longhorn share manager / NFS). Choose per deployment shape:

- **`ReadWriteOnce`** is fine for single-replica dev/staging where only one
  pod ever mounts the volume.
- **`ReadWriteMany`** is required in production: the API pods, the arq
  worker pods, and the backup pod all mount `/data`, and the tiles sidecar
  reads `/data/tiles` from inside the API pod. An RWO source-images or tiles
  volume cannot attach to more than one node, so multi-replica deployments
  _must_ use RWX.

The backup `/backups` PVC stays RWO: the backup Deployment is the only
long-lived writer, and on-demand Jobs are pinned to its node by required
hostname affinity (see
[the DR runbook](backup-and-disaster-recovery.md#concurrent-backup-runs)).

## Example manifests

[`deploy/longhorn-storageclasses.yaml`](../deploy/longhorn-storageclasses.yaml)
contains three ready-to-apply StorageClasses that mirror the bcit-tlu fleet
definitions:

- **`longhorn-source-images-rwx`** — 3 replicas, `Retain`, zone-spread,
  `dataLocality: disabled`. The irreplaceable originals; sized for
  durability over economy.
- **`longhorn-tiles-rwx`** — 2 replicas, `Retain`, and `best-effort`
  `dataLocality`. Derived DZI tiles; a recent Longhorn snapshot makes
  restore faster than `rebuild-tiles`, but long-term protection is
  deliberately thin because tiles are rebuildable.
- **`longhorn-backup-archives`** — 2 replicas, `Retain`, `best-effort`
  `dataLocality` with `replicaAutoBalance: disabled`. Holds backup state
  and, in local-PVC-only mode, the recovery archives themselves.

Review the file header before applying: `backupTargetName` must match a
configured Longhorn `BackupTarget`, `dataEngine: v2` needs node hugepages,
and `diskSelector` is omitted because bcit-tlu pins volumes to a dedicated
SAN-backed disk pool.

## Parameter reference

| Parameter                     | Values                              | HRIV guidance                                                                                            |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `reclaimPolicy`               | `Retain`, `Delete`                  | `Retain` for every HRIV data volume — a deleted PVC must never take user uploads or archives with it     |
| `volumeBindingMode`           | `WaitForFirstConsumer`, `Immediate` | `WaitForFirstConsumer` — bind after scheduling so replica/locality placement sees the real consumer node |
| `allowVolumeExpansion`        | `true`/`false`                      | `true` — Longhorn expands volumes online; media libraries only grow                                      |
| `dataEngine`                  | `v1`, `v2`                          | `v2` matches the fleet standard; requires node hugepages — use `v1` where they are not configured        |
| `dataLocality`                | `disabled`, `best-effort`           | `disabled` for RWX source images; `best-effort` for tile readers and the single backup pod               |
| `numberOfReplicas`            | `"1"`–`"3"`+                        | 3 for source images, 2 for tiles and backups; never 1 for authoritative data                             |
| `replicaAutoBalance`          | `best-effort`, `disabled`           | `best-effort` generally; `disabled` with `dataLocality` to keep the consumer-local replica in place      |
| `replicaZoneSoftAntiAffinity` | `enabled`, `disabled`               | `enabled` for the 3-replica source-images volume; `disabled` where locality should win over zone spread  |
| `staleReplicaTimeout`         | minutes                             | `"30"` matches the fleet default                                                                         |
| `disableRevisionCounter`      | `"true"`/`"false"`                  | `"true"` — avoids per-operation revision-counter writes                                                  |
| `fsType`                      | `ext4`, `xfs`, …                    | `ext4` — HRIV relies on POSIX ownership (UID/GID 10001)                                                  |
| `backupTargetName`            | target name                         | Set to your Longhorn backup target so volume snapshots can ship off-cluster; must match a `BackupTarget` |
| `diskSelector`                | disk label                          | Omit unless the cluster dedicates disks by label (bcit-tlu uses `san-block`)                             |

## Tradeoffs worth knowing

### RWX means NFS, not multi-attach block storage

Longhorn serves `ReadWriteMany` PVCs through its share manager (NFSv4.1),
not by multi-attaching the block device. Consequences:

- The data path gains a hop through the share-manager pod; expect lower
  throughput/latency than raw RWO block attach. HRIV tolerates this —
  tiles are small immutable files served by the nginx sidecar and cached
  by browsers (`Cache-Control: private, max-age=2592000`), and source
  images are written once and read in bulk.
- `fsGroup` is **not** applied to RWX volumes by Longhorn's
  `ReadWriteOnceWithFSType` CSI policy (unlike RWO volumes). Directory
  ownership/modes must come from the workload image and storage defaults —
  see the permission contract in
  [the DR runbook](backup-and-disaster-recovery.md#backup-chart-credentials-and-pod-security).
- The share manager is a single attachment point that can move between
  nodes; it is not a data-path SPOF for the replicas themselves.

### Replica count is the durability dial

Each replica is a full copy on a different node. Three replicas survive
two simultaneous node losses; two survive one. Writes fan out to every
replica, so replica count is also write amplification — which is why
derived tiles stay at 2 while authoritative source images stay at 3. A
`numberOfReplicas: "1"` class (e.g. a generic "large-files" class tuned for
another workload) is acceptable for scratch volumes and **not** for
source images: one node loss degrades the only copy of user uploads.

### `dataLocality` trades spread for read latency

`best-effort` biases one replica onto the node running the consuming pod,
which helps read-heavy single-consumer volumes (tiles via the sidecar,
the backup pod's archive streaming). `disabled` lets the scheduler spread
replicas purely by capacity/zone — the right choice for RWX source images,
whose readers (API, workers, backup) span nodes anyway. Pair
`best-effort` with `replicaAutoBalance: disabled` when the local replica
should stay put; Longhorn still repairs a lost replica onto surviving
nodes — auto-balance only governs voluntary movement.

### `Retain` vs `Delete`

`Retain` keeps the PV and Longhorn volume after PVC deletion, so an
accidental `kubectl delete pvc` (or Helm release removal) cannot destroy
data — at the cost of manual cleanup of orphaned volumes. `Delete` is
correct for genuinely ephemeral volumes (restore-validation drills,
scratch) and dangerous as a default for `/data`: the chart-default
`longhorn` class ships `reclaimPolicy: Delete` and `Immediate` binding,
which is fine for throwaway claims but a bad silent default for media
volumes.

### `WaitForFirstConsumer` vs `Immediate`

`Immediate` binds and provisions the volume at PVC creation, before the
pod is scheduled — the volume can land far from its consumer and
`dataLocality` has no consumer to aim at. `WaitForFirstConsumer` delays
provisioning until a pod is scheduled, so placement reflects reality.
All three example classes use it.

## Recommended chart values

When the chart creates the PVCs (no `existingClaim`), set the class
explicitly — an empty `storageClass` falls back to the cluster default,
which may be a single-replica `Delete`-reclaim class:

```yaml
# backend chart (HelmRelease values or -f values file)
persistence:
  enabled: true
  sourceImages:
    storageClass: longhorn-source-images-rwx
    accessModes:
      - ReadWriteMany
  tiles:
    storageClass: longhorn-tiles-rwx
    accessModes:
      - ReadWriteMany
```

```yaml
# backup chart
persistence:
  sourceImages:
    existingClaim: hriv-backend-source-images # shares the backend PVC; no class needed
  tiles:
    existingClaim: hriv-backend-tiles # development mode only; production excludes tiles
  backups:
    storageClass: longhorn-backup-archives
```

When PVCs are pre-provisioned (the bcit-tlu pattern), the class is chosen
at PVC creation instead — see
[`hriv-split-pvcs.yaml`](https://github.com/bcit-tlu/flux-fleet/blob/main/apps/overlays/latest/hriv/backend/hriv-split-pvcs.yaml)
in flux-fleet for the reference shape:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: hriv-backend-source-images
  namespace: hriv
spec:
  accessModes: [ReadWriteMany]
  storageClassName: longhorn-source-images-rwx
  resources:
    requests:
      storage: 200Gi
```

Then point the charts at the claims with `existingClaim` (backend
`persistence.sourceImages.existingClaim` / `persistence.tiles.existingClaim`;
backup `persistence.sourceImages.existingClaim` / `persistence.tiles.existingClaim`).

## Anti-patterns

- **Reusing a generic single-replica class for `/data`.** Classes tuned for
  other workloads (e.g. a `longhorn-large-files`-style class with
  `numberOfReplicas: "1"`) leave user uploads one node failure from loss.
  Source images need 3 replicas (2 minimum on small clusters).
- **Relying on the cluster default.** The Longhorn chart's default
  `longhorn` class uses `reclaimPolicy: Delete` + `Immediate` binding —
  acceptable for scratch, not for authoritative media.
- **RWO source-images/tiles in multi-replica deployments.** Pods on
  different nodes cannot share an RWO volume; the chart requires RWX when
  `redis.worker.enabled=true` or `replicaCount > 1`.
- **One class for everything.** Tiles churn constantly; giving them the
  source-images replica count triples write amplification for rebuildable
  data. Keep the classes separate so each volume's policy matches its role.
- **Expecting the StorageClass to handle retention.** The class controls
  provisioning shape only. Snapshot schedules, backup targets, and
  retention windows are Longhorn recurring-job / backup policy — see the
  [Recommended Longhorn policies](backup-and-disaster-recovery.md#recommended-longhorn-policies)
  table in the DR runbook.

## Related documentation

- [backup-and-disaster-recovery.md](backup-and-disaster-recovery.md) — data
  classification, snapshot/backup policy, restore order, DR runbook
- [deploy/README.md](../deploy/README.md) — Helm charts, storage split, PVC
  cutover procedure
- [longhorn-storageclasses.yaml](../deploy/longhorn-storageclasses.yaml) —
  ready-to-apply example manifests
- [charts/backend/README.md](../charts/backend/README.md) — backend
  persistence layout and values reference
- [backup/README.md](../backup/README.md) — backup service configuration and
  Longhorn protection policy
