## Scheduling, invocation, and overlap

The default schedule MUST be Sunday at 10:00 UTC, a fixed non-peak weekly window seven days
apart that avoids DST ambiguity. An approved deployment override MUST remain fixed in UTC and
no more than 13 days apart. The interval is tighter than the 14-day alert threshold so normal
scheduling jitter does not immediately make the last success overdue.

Flux MUST also define a suspended on-demand CronJob that acts only as a server-side Job
template. Scheduled and on-demand templates MUST call the identical image and entrypoint with
the same security, resources, state ConfigMap, Lease, and validation policy. Trigger metadata
may distinguish `scheduled` from `on_demand` in durable state, but it MUST NOT select a weaker
path. Creating an on-demand Job returns durable Job/run identity promptly; an operator session
is not the run lifetime.

### Job evidence, quota, and native history-GC guard

The default ResourceQuota hard limit is `count/jobs.batch: 32`. Terminal orchestrator Job evidence
is retained for 24 hours, reaper-Job evidence is retained for one hour, and the terminal-Job reaper
runs every hour and removes prior terminal reaper Jobs only after that shorter class-specific window. Scheduled, suspended
on-demand, failed-child-reaper, and terminal-Job-reaper CronJobs each set both
`successfulJobsHistoryLimit: 33` and `failedJobsHistoryLimit: 33`. Because each per-status history
limit is strictly greater than the namespace's total Job quota, native CronJob history GC cannot
reach either threshold under any success/failure distribution. No orchestrator or reaper Job sets
`ttlSecondsAfterFinished`; all use `restartPolicy: Never` and `backoffLimit: 0`.

Helm/config validation MUST reject a deployment unless every successful and failed history limit is
strictly greater than the configured hard `count/jobs.batch`, the terminal orchestrator evidence
window is at least 24 hours unless an explicitly approved bounded policy says otherwise,
reaper-Job evidence is at least one complete terminal-reaper interval, the terminal reaper interval
is at most one hour, and every Job TTL is absent. The quota and preflight also enforce

```text
current_run_job_max
+ (configured_retained_run_max * retained_run_job_max)
+ terminal_evidence_job_max
+ concurrent_reaper_and_static_job_max
<= hard count/jobs.batch
```

Each term is a bounded maximum derived from the fixed child/orchestrator/reaper templates, including
one current orchestrator, all child Jobs, at most two retained-run Job inventories, all terminal
orchestrator Jobs that can accumulate from scheduled plus the bounded approved on-demand creation
budget during the orchestrator evidence window, prior terminal reaper Jobs retained for their
one-hour evidence window, and concurrently running/static reaper Jobs. The on-demand
creation path MUST enforce the same evidence-window budget. Rendering or admission fails when the formula does not fit; runtime preflight rechecks
current usage and the reserved envelope before creating a Job.

The `33` history settings are a non-triggering safety guard, not retention. The terminal-Job reaper
is the sole Job deletion path and may delete any covered Job only after its class-specific evidence
window (24 hours for orchestrators, one hour for reaper Jobs by default).
Overrides may jointly adjust quota, history limits, evidence window, reaper interval, and template
maxima, but schema validation and render tests MUST re-evaluate all inequalities and time bounds as
one configuration; no field may be overridden independently.

### Lease protocol

Before source selection, every path performs a nonblocking attempt to acquire the single fixed
Lease. An overlap rejection MUST compare-and-set only `latest_trigger` and a bounded rejected-trigger
summary in `attempt_history` with failure code `OVERLAP_ACTIVE`, then terminate without provisioning
or retrying behind the holder. That CAS MUST preserve `active_run`, the full `latest_run` ownership,
stages, resources, and heartbeat, and `last_complete_success`; an overlap is a rejected trigger, not
an owning validation run.

The Lease ownership tuple is unambiguous and bounded: `holderIdentity` is the versioned encoding
`v1|<job-uid>|<run-id>|<acquired-rfc3339>|<renewed-rfc3339>`. Its timestamps MUST exactly equal Lease
`acquireTime` and `renewTime`, and every renewal CAS updates both the encoded renewal timestamp and
`renewTime`; `leaseDurationSeconds` encodes expiry. Normal renewal continues until terminal state
has been persisted. On every normal terminal path, including
`SUCCEEDED` and `FAILED_RETAIN`, the holder MUST then compare-and-set the Lease to clear
`holderIdentity` (and its acquisition/renewal fields as the Lease schema permits), so the next run
can start immediately rather than waiting for expiry. If a holder failed to clear but its durable
attempt is already terminal, a contender MAY immediately compare-and-set acquisition of the
still-held Lease without waiting for expiry and without writing `INTERRUPTED_STALE_HOLDER`, but only
when the still-held Job UID equals the terminal run's recorded orchestrator `job_uid` and after
confirming a failed/retained run has its exact `retained_runs` transfer (or a clean success has
no children). A different holder UID on a terminal run's Lease is a cleanup Job: a run contender
MUST reject `OVERLAP_ACTIVE` without clearing it, leaving replacement to the guarded cleanup
takeover path. This is terminal-holder recovery, not stale takeover.

A contender MUST NOT take a merely expired Lease whose durable holder remains within a valid
nonterminal run. Stale takeover applies only to a holder whose
durable attempt is still nonterminal, whose Lease is expired, and whose run has exceeded maximum
runtime, and only when:

1. the holder Job is confirmed absent or terminal in the validation namespace;
2. the contender records `INTERRUPTED_STALE_HOLDER` as the old accepted run's bounded failure code
   and transitions it through retained ownership transfer to
   `state=FAILED_RETAIN,outcome=retained`;
3. any old child ownership is atomically transferred to an exact `retained_runs` record before the
   old `latest_run` can be replaced; and
4. compare-and-set on the Lease succeeds.

#### Post-Lease/pre-state initialization recovery

Before owning state exists, writes are limited to resourceVersion-CAS coordination: Lease fields,
bounded trigger/history disposition, and the initial owning pointers. No source selection, self
Job/Pod run-label patch, child/result creation, provisioning, or other run side effect is allowed
until one ConfigMap CAS has installed matching `active_run` and `latest_run`. If the Lease exists
without matching owning state, the same live Job UID encoded in `holderIdentity` MAY repair that
initial CAS idempotently, using the encoded run ID, only when no other active/latest owner exists and
an exact all-kind run-label query confirms zero children.

A later contender may recover an abandoned initialization only after Lease expiry **plus** a
bounded initialization grace (default 60 seconds, configurable no higher than 300 seconds). It MUST
parse one unambiguous Job UID/run ID ownership tuple, list/get the holder Job and verify by the
encoded UID that it is absent or terminal, and query every allowed child kind using the exact run label. That query MUST
return no child Job/Pod, Deployment, Service, result ConfigMap, PVC, or CNPG Cluster; the holder's
own Job/Pod evidence is explicitly excluded. A live holder Job, an unexpired Lease, an elapsed time
within grace, any child, malformed identity, UID/name disagreement, or ambiguous query result fails
closed: the contender records/reports `OVERLAP_ACTIVE` where state permits and MUST NOT clear or
take the Lease.

After all guards pass, the contender compare-and-sets the Lease by `resourceVersion` to replace the
orphan holder with a bounded recovery-only holder that encodes the contender Job UID/run ID and the
abandoned tuple; it is not an accepted run and permits no run side effects. This prevents another
contender from entering between Lease recovery and evidence persistence. It then field-aware-CAS
upserts a bounded `rejected_trigger` history summary for the abandoned trigger, deriving its stable
trigger key from the encoded Job UID and run ID timestamp, with outcome `rejected` and
`LEASE_STATE_INITIALIZATION_LOST`; `latest_trigger` changes only if normal trigger ordering selects
that summary, and `active_run`, `latest_run`, `retained_runs`, and `last_complete_success` remain
byte-for-byte ownership-equivalent. Only after that record succeeds may the same contender use a
normal resourceVersion CAS to convert the recovery holder into its regular Lease acquisition and
run the initial-state protocol for its own trigger. A crash while recovery-only is held is governed
by the same expiry, grace, UID, and zero-child rules. This abandoned
initialization never becomes an accepted `latest_run` and never receives stale-holder
`INTERRUPTED_STALE_HOLDER`.

A rejected trigger is durable trigger history, not an accepted validation run, validation failure,
or replacement for the active/latest owning run. All scheduled, on-demand, and reaper Jobs MUST use
`backoffLimit: 0`: Kubernetes retries no failed Pod. The orchestrator itself owns bounded,
deadline-aware observation retries with exponential backoff and jitter; it never delegates
semantic or observation retry policy to Job Pod recreation.

## Run identity and ownership

A run ID MUST combine a UTC timestamp and cryptographically random suffix, be lowercase and
DNS-label safe, and remain independent of archive or recovery-set IDs. For example, its shape
may be `rv-20260115t100000z-a1b2c3d4`; the random portion, not an archive identity, prevents
collisions. Each invocation also derives a bounded stable `trigger_id` from its candidate run ID's
UTC timestamp and Job UID before Lease acquisition. That key exists only for trigger summary/history merge and never
appears in metric labels. A rejected trigger does not make its candidate run ID an owning run.

The CronJob template MUST place the fixed component ownership label on the orchestrator Job/Pod.
Only after Lease acquisition and the matching initial owning-state CAS may the orchestrator patch
its own Job and Pod with the run label and bounded expiry/evidence annotations. Every child resource MUST carry all of:

```yaml
metadata:
  labels:
    app.kubernetes.io/managed-by: hriv-restore-validation
    hriv.bcit.ca/restore-validation-run-id: <run-id>
  annotations:
    hriv.bcit.ca/source-recovery-set: <recovery-set-id>
    hriv.bcit.ca/created-at: <UTC RFC3339 timestamp>
    hriv.bcit.ca/expires-at: <UTC RFC3339 timestamp>
```

The source annotation may contain the bounded recovery-set identity for audit, but resource
names and metric labels MUST NOT use archive IDs or recovery-set IDs. Cleanup requires an exact
match on both ownership labels and the bound resource name/UID. A label alone is insufficient.

## Source selection and immutable binding

The #1250 `validation-list` discovery primitive uses only the read SAS and returns at most 1000
exact archive candidates whose metadata explicitly says `published`, sorted by snapshot chronology
newest first. Candidate, unknown, and legacy metadata are omitted; malformed published entries or
an excessive candidate set fail closed. Listing performs no sidecar download and grants no
selection authority. The orchestrator MUST still bind through `validation-select` and its complete
coherence checks.

`SELECT` MUST choose the newest **fully published** production recovery set according to the
recovery-set contract, never the newest blob by modification time. Before accepting a set, the
orchestrator or read-only selection child MUST verify:

- archive publication metadata says `published`, not candidate, unknown, committed-only,
  rejected, failed, or cancelled;
- the archive and immutable manifest sidecar both exist and identify each other;
- `BACKUP_STATE.json` and `LAST_SUCCESS.json` are readable and coherent with the published
  archive, sidecar, marker run identity, and each component's `last_success_*` timestamps,
  duration, size, and archive key. State's top-level and current-attempt run/snapshot/outcome fields
  may describe a newer pending or failed attempt and MUST NOT be treated as the marker run. Because
  state has no `last_success_run_id`, the immutable marker run ID/snapshot and top-level
  `created_at` equal to canonical manifest `capture_started_at` bind the manifest. Each marker type's
  independently recorded `created_at` equals only that component's `last_success_started_at`—the
  database and filesystem starts need not equal each other or top-level marker creation—while marker
  component identity plus last-success timestamps/sizes/archive keys bind state;
- manifest/schema/archive versions are supported and production mode is declared;
- expected components are present, `db.sql` and generated tiles are absent, and no incomplete
  staging or upload artifact is selected;
- archive size, source-image counts and bytes, per-file sizes, and SHA-256 checksums are valid
  and internally coherent;
- missing/orphan lists and validator-derived canonical counts/digest, separately allowlisted
  exclusions, and acceptance state obey the source-state policy below;
- CNPG provider, source cluster, WAL fence metadata, versions, and checksums are supported; and
- `database_recovery.target_lsn`, a 24-hex-character `wal_fence_file`, and a
  supported power-of-two `wal_segment_size_bytes` are present, syntactically
  valid, and mutually consistent.

Selection also binds lowercase `source_files_sha256`, computed over canonical JSON for the exact sorted manifest source-file mapping `{path:{size,sha256}}`. Stateless restore returns the same compact binding, and consistency validation streams every restored regular file, rebuilds the mapping with `data/source_images/...` paths, and must return an exact digest match. Counts and byte totals remain independent checks. The full high-volume inventory is never copied into public machine output or durable controller state.

Flux MUST provide a versioned static source-profile ConfigMap for flux-fleet #241. Its immutable
profile ID/version binds expected source cluster/provider, application database `app`, owner
`app`, server/system identity, and the deployed Barman Cloud plugin `ObjectStore` name/version.
The controller MUST use that profile—not manifest `database_name`, which identifies the inventoried
HRIV connection database `hriv`—to configure and validate `app`/`app`, and MUST cross-check manifest
cluster/provider/WAL metadata against it. `ObjectStore` is the actual CRD provided by the deployed
CNPG-I Barman Cloud plugin, not a generic substitute. The #1251 fixed selection/restore child MUST
set `CNPG_CLUSTER_NAME` from that bound Flux source profile (`pg-core` currently); relying on an
unbound runtime value is forbidden, even though the primitive default remains `pg-core`. Strict
selection rejects a manifest whose `database_recovery.cluster` differs from the configured profile
with `CNPG_METADATA_INVALID`. This requires no backup-manifest schema change.

The exact `database_recovery.target_lsn`, not `target_time`, becomes the CNPG
`recoveryTarget.targetLSN`. The controller MUST derive the timeline from exactly the first eight
hex characters of `database_recovery.wal_fence_file` (for example, `00000007` means timeline 7),
bind that parsed value, and explicitly set CNPG `recoveryTarget.targetTLI` to its decimal
string together with `targetLSN`. It MUST reject missing, unsupported, malformed, zero, or
inconsistent fence/timeline evidence with `WAL_FENCE_UNSUPPORTED` or `TIMELINE_MISMATCH`; it MUST
NOT request `latest`. Selection MUST recompute the fence WAL filename using the
manifest's bound `wal_segment_size_bytes`, not a fixed 16-MiB assumption.
`target_time` remains audit evidence only.

For the deployed CNPG v1 CRD, `WAIT_CNPG` requires all of `Ready=True`,
`status.phase: Cluster in healthy state`, and `readyInstances == instances == 1`; the Ready
condition alone is not sufficient. The subsequent read-only database child remains the final proof
that recovery completed and promoted to a new, unused timeline after reaching the exact target LSN.
It MUST read the promoted timeline's local history, require its immediate `timeline_parent` to be
`target_tli`, and require `timeline_switchpoint` to be at or beyond `target_lsn`; the promoted
number may exceed `target_timeline + 1` when an archived descendant already exists. It reports the
promoted `timeline`, `timeline_parent`, `timeline_switchpoint`, and bound `target_tli`. Selection also
binds canonical UTC `capture_started_at`, uppercase `wal_fence_file`, and canonical UTC
`wal_fence_committed_at`/`wal_fence_archived_at`. The database child MUST observe exactly one fence row at the target, require that row's dynamic
generation to be positive, and require its timezone-aware `fenced_at` to fall inclusively between
the bound capture start and fence-commit timestamps. When the bound committed timestamp has zero fractional precision, comparison uses the database timestamp at whole-second precision so a database microsecond cannot falsely exceed a whole-second backup boundary; when the bound timestamp is fractional, comparison is exact. Output always preserves the original canonical database `fenced_at` precision. The exact LSN and fence-derived decimal TLI
bind the recovery boundary; the positive singleton fence row is target-observed evidence, not an
`expectedFenceGeneration` profile field or any other static profile constant.

Before any provisioning, the controller MUST append a run record that binds the selected
recovery-set identity, archive/sidecar versions and checksums, exact target LSN and derived
timeline, declared bytes, source-profile ID/version/database/owner/server/`ObjectStore`, and
validator-derived source-state digest plus source-state-policy version/recomputed digest. Those
binding fields become immutable for that attempt. A
restarted controller resumes the same binding or fails; it never silently advances to a newer set.

### Source-state drift policy

Current recovery-set semantics are unchanged: missing rows remain reported, skipped, and
preserved; orphan files remain excluded and are never restored, created as rows, or deleted.
`manifest.validation.accepted` is necessary publication evidence, not proof of zero drift and not
sufficient for restore-validation success. No backup-code or manifest-schema change is required.

### Canonical source-state document and digest

The validator derives a canonical source-state document from the existing format-2
`validation.missing_sources` and `validation.orphan_sources` lists; this requires no manifest field
or backup-code change. Before canonicalization, each list is limited to 256 entries, `row_id` to 19
ASCII digits, and every other string to 512 UTF-8 bytes. Overflow, truncation, a non-string field,
an unknown or missing key, invalid UTF-8, or a duplicate fails `SOURCE_STATE_DIGEST_INVALID`.

Each missing entry has exactly `row_id`, `status`, `stored_path`, and `reason`. `row_id` MUST match
`[1-9][0-9]{0,18}` and is retained as that canonical base-10 string; `reason` is one of
`missing_source|unsafe_or_out_of_root|duplicate_source_reference`. Each orphan entry has exactly
`path`, `reason=no_database_row`, and `policy=quarantined_by_policy`. Strings are Unicode NFC. Path normalization rejects NUL, backslash,
`.`/`..` traversal, and paths outside the source root; it accepts a rootless relative path or
strips exactly `/data/source_images/`, `data/source_images/`, or `source_images/`, then emits
`data/source_images/<relative-posix-path>`. Duplicate missing `row_id` or normalized orphan `path`
is invalid. Missing entries sort by numeric `row_id`, then lexical `status`, `stored_path`, and
`reason`; orphan entries sort lexically by `path`, `reason`, then `policy`.

The canonical object has exactly this shape:

```json
{
  "missing_sources": [
    {
      "reason": "missing_source",
      "row_id": "42",
      "status": "ready",
      "stored_path": "data/source_images/42.tif"
    }
  ],
  "orphan_sources": [
    {
      "path": "data/source_images/orphan.tif",
      "policy": "quarantined_by_policy",
      "reason": "no_database_row"
    }
  ]
}
```

Serialization is UTF-8 JSON with recursively sorted object keys, separators exactly `,` and `:`,
`ensure_ascii=false`, and no trailing newline. Its digest is SHA-256 encoded as 64 lowercase hex
characters. Missing and orphan counts are derived only from the canonical list lengths, never
trusted from another manifest field.

The Flux-owned, versioned `source-state-policy` ConfigMap is digest-only. It has exactly
`policy_version=1`, `source_state_sha256` (64 lowercase hex), `missing_count` (0..256), and
`orphan_count` (0..256); chart values expose only `sha256`, `missingCount`, and `orphanCount`.
The safe chart default is the empty-state digest with zero counts. The currently reviewed
deployment evidence is digest `958b1dc2dca298c56fd96dd80b6c694144905e22c00c4b3ca9d2c59c3b666083`
with counts 39/3. Full path lists MUST NOT be copied into chart or Flux policy values.

Selection still applies all bounds, key/type/path validation, sorting, serialization, and hashing
to the complete backup-emitted state. It persists that canonical state as immutable run evidence,
requires its digest and independently derived list lengths to equal the mounted policy, and binds
the computed digest of the exact policy document as reviewed policy identity. Passing a digest
comparison is necessary but not sufficient: counts and the complete canonical selected evidence
must also agree. A valid but unknown, new, or mismatched state fails closed. Policy values never
cause a skipped file to be restored.

`excluded_incomplete_artifacts` is not part of this source-state document or digest. Every excluded
entry must independently match this normative, versioned allowlist; an approved missing/orphan set
does not approve arbitrary exclusions:

- reason `incomplete_or_non_authoritative` only beneath `data/source_images/` for a symlink, the
  maintenance marker, a path segment exactly in the backup contract's
  `admin|scratch|maintenance|staging|incomplete` set (with an optional leading dot), or a filename
  ending `.part|.partial|.tmp|.uploading`; and
- reason `non_authoritative_production_data` only for a direct `data/<child>` outside
  `data/source_images`, covering generated tiles and the other recovery-contract exclusions.

Paths are normalized safe archive paths before matching. Unknown reason codes, path traversal,
overbroad/glob-only policy entries, or exclusions outside these forms fail
`EXCLUDED_ARTIFACT_UNAPPROVED`.

Until #1240 has either an exact reviewed policy entry deployed or the source state is repaired to
zero missing/orphan entries, a complete restore-validation success cannot be claimed.

## Capacity and quota preflight

Flux MUST apply a ResourceQuota and LimitRange that bound aggregate PVC
`requests.storage`, ephemeral-storage requests/limits, CPU requests/limits, memory
requests/limits, `persistentvolumeclaims`, Jobs (default hard `count/jobs.batch: 32`), and explicit
Pod, Service, ConfigMap, and Secret object counts. Every container has requests and limits, and every temporary PVC has an explicit
storage request.

`retained_runs` has a configured maximum of 2 and deployment configuration MUST NOT raise it above 2. `ADMISSION_PREFLIGHT` reads the retained count and namespace quota for one declared run plus its
failure-transfer envelope; the initial accepted-run state CAS rechecks that retained count is still
below the maximum before installing ownership. If the retained bound is full, capacity is insufficient, or quota
status is unavailable, the trigger is rejected with `RETAINED_RUN_LIMIT`, `CAPACITY_INSUFFICIENT`,
or `QUOTA_UNAVAILABLE`; the Lease is released, and no `active_run`/`latest_run` or child is created.
This guarantees an accepted active run always has one available retained ownership slot if it later
fails.

The accepted run's full `PREFLIGHT` then uses only its own namespace API and durable state to
calculate:

- the exact `retained_runs` count, aggregate remaining children, retained Job count, and declared
  PVC requests in each retained ownership record;
- active-run declared objects/requests and remaining Job slots against the validated fixed-template
  quota formula;
- the new source PVC requirement derived from manifest bytes plus configured headroom;
- configured CNPG database storage, tile scratch, and temporary-workspace requests; and
- remaining namespace quota and configured retained-run maximum.

The preflight fails before provisioning when declared namespace quota cannot fit, quota status is
unavailable, or the retained reservation is no longer valid. It reports `CAPACITY_INSUFFICIENT`,
`QUOTA_UNAVAILABLE`, or `RETAINED_RUN_LIMIT` and leaves the accepted binding inspectable. Any
transition to `FAILED_RETAIN`, including an empty pre-provision failure, consumes the reserved slot
and transfers an exact record whose child list may be empty. This
proves only declared namespace quota and LimitRange compliance—not node, volume, or storage-system
physical capacity. It does not query nodes, StorageClasses, Longhorn resources, or production
PVCs and does not guess unreported physical capacity. A later unschedulable Pod, unbound PVC, or
storage/CNPG provision failure is terminal `PROVISION_FAILED`, with bounded events retained as
evidence.

## State machine

```text
ACQUIRE_LEASE -> ADMISSION_PREFLIGHT -> INIT_OWNING_STATE -> SELECT -> PREFLIGHT -> PROVISION -> WAIT_CNPG
  -> VALIDATE_DB -> INIT_SYNTHETIC_CREDENTIAL -> RESTORE_FILES -> VALIDATE_CONSISTENCY
  -> START_APP -> REBUILD_TILE -> VALIDATE_APP -> CLEANUP -> SUCCEEDED
  -> RELEASE_LEASE -> CLEAR_ACTIVE -> ORCHESTRATOR_EXIT

Any stage through VALIDATE_APP --terminal failure--> TRANSFER_RETAINED -> FAILED_RETAIN
  -> RELEASE_LEASE -> CLEAR_ACTIVE -> EXIT
CLEANUP --incomplete--> TRANSFER_RETAINED -> FAILED_RETAIN -> RELEASE_LEASE -> CLEAR_ACTIVE -> EXIT
retained_runs expiry/approved request --> REAP_FAILED_CHILDREN --> remove retained entry when empty
terminal orchestrator Job --evidence window-------> STATIC_JOB_REAPER

Success-path `CLEANUP` reaches `SUCCEEDED` only after every bound child run resource is confirmed
absent. The orchestrator Job and Pod remain as evidence, are not part of that gate, and cannot be
absent before their own successful exit. After persisting `SUCCEEDED`, the orchestrator clears the
Lease by CAS, conditionally clears its matching `active_run`, and exits; the static reaper later
removes its terminal Job/Pod.
```

The stages are ordered gates:

| Stage                       | Required result                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACQUIRE_LEASE`             | Acquire by CAS or perform only guarded terminal/stale/abandoned-initialization recovery.                                                                                                                  |
| `ADMISSION_PREFLIGHT`       | Before accepted state, prove retained count is below 2 and quota reserves one run plus its failure-transfer slot; reject and release otherwise.                                                           |
| `INIT_OWNING_STATE`         | Install matching `active_run`/`latest_run` before every non-coordination side effect.                                                                                                                     |
| `SELECT`                    | Verify and immutably bind the latest fully published set and exact LSN.                                                                                                                                   |
| `PREFLIGHT`                 | Prove declared namespace quota plus run/retention bounds without claiming physical capacity.                                                                                                              |
| `PROVISION`                 | Create fresh labelled PVCs, CNPG Cluster, and validation-only support objects.                                                                                                                            |
| `WAIT_CNPG`                 | Observe CNPG recovery to the exact target LSN and readiness within deadline.                                                                                                                              |
| `VALIDATE_DB`               | Validate source system identity, all database/owner/static-role inventory, schema migration version, representative row counts and metadata, exact synthetic row, and WAL/fence boundary before mutation. |
| `INIT_SYNTHETIC_CREDENTIAL` | Run the one-shot credential-init Job and record its one-row post-fidelity password-hash mutation.                                                                                                         |
| `RESTORE_FILES`             | Use read-only stateless filesystem restore into the fresh source PVC; never execute SQL or update backup state.                                                                                           |
| `VALIDATE_CONSISTENCY`      | Verify archive/per-file checksums, counts, paths, DB rows versus files, and exact source-state policy.                                                                                                    |

Database inventory includes only `pg_database.datallowconn` databases, matching the source-profile
contract. Source consistency preserves and checks every recovered `source_images` row regardless of
active/inactive status; status remains canonical missing-source evidence and is never a row filter.
| `START_APP` | Start isolated backend/frontend/Redis support against only restored targets with application migrations, production OIDC, routes, callbacks, and workers disabled. |
| `REBUILD_TILE` | Run the one-shot validation CLI Job to rebuild exactly one selected recovered image serially into a fresh tile PVC and consume its machine result. |
| `VALIDATE_APP` | Use the existing synthetic image to prove local login, category/image browsing, metadata, DZI, dimensions/content evidence, and a representative tile. |
| `CLEANUP` | Remove all and only bound child run resources, then list/get to confirm those children are absent; exclude the orchestrator Job/Pod. |
| `SUCCEEDED` | Persist only after every prior gate and child cleanup confirmation succeeds; then clear the Lease and exit. |
| `TRANSFER_RETAINED` | Atomically upsert the exact full child ownership record in `retained_runs` before replacing `latest_run` or releasing the Lease. |
| `FAILED_RETAIN` | Persist failure, stop mutation, set bounded expiry, and leave only state-bound child targets for diagnosis until exact-record reaping. |

Each stage has a configured deadline bounded by the maximum runtime. Retryable observations use
bounded exponential backoff with jitter. Semantic validation failures, unsupported inputs,
overlap, authorization denial, and capacity failures are not retried within an attempt.

Deadline and storage sizing are chart values so overlays scale with the source set they select.
`childJobs.sourceRestoreDeadlineSeconds` and `childJobs.consistencyDeadlineSeconds` set the child
Job `activeDeadlineSeconds`; the consistency deadline MUST cover rehashing the largest source set
the profile can select, not merely the currently observed one. `controller.maxRuntimeSeconds`
bounds the whole accepted run and is also the orchestrator Job's own active deadline, and
`controller.stageTimeoutSeconds` bounds stage observation; an overlay restoring a larger source
set (for example 160Gi rather than 40Gi) MUST raise all three together.
`sourceProfile.sourceStorageClass` selects the source PVC and CNPG Cluster storage class. Both
source-touching child Jobs carry the storage-node selector (`bcit.ca/longhorn-storage: "true"`)
and `fsGroupChangePolicy: OnRootMismatch` so mount-time ownership checks do not re-walk the
restored tree. The controller additionally pins the consistency Pod to the node that ran the
source-restore Pod (`spec.nodeName`, runtime scheduling placement excluded from template
identity), so replica-local reads are used whenever the configured storage class provides data
locality.

### Sequence

```text
Trigger       Orchestrator       State/Lease       Kubernetes/CNPG/children        Static reaper
   |                |                  |                         |                       |
   |--------------->| acquire Lease CAS; retention/quota admission preflight             |
   |                | state CAS sets active_run/latest_run/latest_trigger --------------->|
   |                | [no run side effects before that state CAS]                        |
   | orphan recovery| expiry+grace; absent/terminal UID; zero children; CAS recovery holder>|
   |                | record initialization-lost history; acquire/init normally -------->|
   | overlap trigger|-- reject; CAS latest_trigger/history only -->|                     |
   |                | select/bind ---->|--- read-only source --->|                       |
   |                | persist binding->|                         |                       |
   |                | preflight/create ------------------------->|                       |
   |                |                  |        CNPG recovery/read-only Azure           |
   |                |<-----------------|------- recovered Cluster status/machine result |
   |                | DB fidelity; then credential-init/files/app/tile/viewer -------->|
   |                |<-----------------|------- machine-readable bounded outcomes       |
   |                | delete all bound children ---------------->|                      |
   |                | confirm child absence -------------------->|                      |
   | failure path   | CAS latest_run + full retained_runs transfer ->|                  |
   | success path   | persist terminal latest_run/conditional last success ------------>|
   |                | clear holder CAS -->|                       |                      |
   |                | CAS active_run=null if still self -------->|                      |
   |                | exit; Job becomes terminal ----------------|                      |
   |                |                  |-- projection --> exporter |                    |
   | failed retained children -- expiry/state CAS ---------------->| failed-child reaper |
   |                |                  |                         |<-- evidence window ----|
   |                |                  |                         | remove terminal Job/Pod|
```

## Durable state contract

Kubernetes Job status, logs, Pod events, and CNPG conditions are supporting evidence, not the
source of truth. A fixed, schema-versioned ConfigMap in the validation namespace is
authoritative. Writers MUST use `resourceVersion` compare-and-set: read, merge by attempt/run
identity, update with the observed version, and re-read/re-merge on conflict.

The document separates three views that MUST NOT alias: `active_run` is a bounded pointer/summary
for the current Lease holder and is `null` when none; `latest_run` is the full record for the newest
accepted owning validation run; and `latest_trigger` is a bounded summary of the newest among all
scheduled/on-demand invocations, including an overlap rejection. `retained_runs` is the sole full
cleanup-ownership index for failed accepted runs; `attempt_history` retains only bounded reporting
summaries for accepted runs and rejected triggers, while `last_complete_success` remains separate.
Detailed inventories and free text remain in structured logs or run evidence; durable state stores
bounded codes and summaries. It contains no credentials, SAS URLs, connection strings, tokens, or
Secret values. When non-null, `active_run` contains only `run_id`, `job_name`, `job_uid`, `state`,
`current_stage`, `sequence`, `started_at`, and `heartbeat_at`; the full bindings, stages, resources,
and cleanup remain solely in matching `latest_run`.

Accepted owning-run fields have one exact mapping. `latest_run.state` is either one owning
nonterminal stage name from the state table—`SELECT`, `PREFLIGHT`, `PROVISION`, `WAIT_CNPG`,
`VALIDATE_DB`, `INIT_SYNTHETIC_CREDENTIAL`, `RESTORE_FILES`, `VALIDATE_CONSISTENCY`, `START_APP`,
`REBUILD_TILE`, `VALIDATE_APP`, `CLEANUP`, or `TRANSFER_RETAINED`—or terminal `SUCCEEDED` or
`FAILED_RETAIN`. `ACQUIRE_LEASE`, `ADMISSION_PREFLIGHT`, and `INIT_OWNING_STATE` are pre-owning
coordination steps and are never `latest_run.state`; post-terminal Lease release/active-pointer
clearing are sequencing operations, not new run states. A matching `active_run.state` always equals `latest_run.state`. While nonterminal,
`latest_run.current_stage` and `active_run.current_stage` both equal that state. A terminal
`latest_run` has
`current_stage: null`; a still-present matching `active_run` during terminal persistence/Lease
release also has `current_stage: null`. The `latest_run.stages` map remains per-stage historical
timing/outcome evidence, with completed entries immutable, while terminal `failure_stage` separately identifies the stage
that caused `FAILED_RETAIN`.

`latest_run.outcome` and accepted-run history outcomes are strict projections of `state`:
`running` for every nonterminal state, `succeeded` for `SUCCEEDED`, and `retained` for
`FAILED_RETAIN`. Accepted owning runs never persist run outcome `failed`, `interrupted`, or
`pending`. Interruption and timeout values are bounded `failure_code` evidence that transition the
run through retention transfer to terminal `FAILED_RETAIN`; they are not terminal states/outcomes.

A representative `state.json` value is:

```json
{
  "schema_version": 3,
  "generation": 44,
  "updated_at": "2026-01-15T13:12:00Z",
  "active_run": null,
  "latest_trigger": {
    "trigger_id": "trigger-20260115t113000z-55667788",
    "trigger": "on_demand",
    "outcome": "rejected",
    "failure_code": "OVERLAP_ACTIVE",
    "started_at": "2026-01-15T11:30:00Z",
    "completed_at": "2026-01-15T11:30:01Z"
  },
  "latest_run": {
    "run_id": "rv-20260115t100000z-a1b2c3d4",
    "trigger": "scheduled",
    "job_name": "hriv-restore-validation-20260115t100000z-a1b2c3d4",
    "job_uid": "00000000-0000-0000-0000-000000000000",
    "state": "FAILED_RETAIN",
    "current_stage": null,
    "sequence": 19,
    "started_at": "2026-01-15T10:00:00Z",
    "completed_at": "2026-01-15T12:41:00Z",
    "heartbeat_at": "2026-01-15T12:41:00Z",
    "expires_at": "2026-01-16T12:41:00Z",
    "selected_source": {
      "recovery_set_id": "<bounded recovery-set identity>",
      "archive_version": 2,
      "manifest_sha256": "<digest>",
      "target_lsn": "0/00000000",
      "target_timeline": 7,
      "source_file_count": 120,
      "source_total_bytes": 123456789,
      "source_profile_id": "production-pg-core",
      "source_profile_version": 1,
      "source_state_sha256": "<validator-derived digest>",
      "source_state_policy_version": 1,
      "source_state_policy_sha256": "<recomputed policy digest>",
      "database": "app",
      "owner": "app",
      "server_identity": "<bounded expected identity>",
      "object_store": "<flux-owned ObjectStore name>"
    },
    "orchestrator_evidence": {
      "job_name": "hriv-restore-validation-20260115t100000z-a1b2c3d4",
      "job_uid": "00000000-0000-0000-0000-000000000000",
      "pod_uid": "00000000-0000-0000-0000-000000000099"
    },
    "child_resources": [
      {
        "apiVersion": "v1",
        "kind": "PersistentVolumeClaim",
        "name": "rv-a1b2c3d4-source",
        "uid": "00000000-0000-0000-0000-000000000001"
      }
    ],
    "stages": {
      "SELECT": {
        "outcome": "succeeded",
        "started_at": "2026-01-15T10:00:01Z",
        "completed_at": "2026-01-15T10:00:08Z",
        "duration_seconds": 7
      },
      "VALIDATE_APP": {
        "outcome": "failed",
        "started_at": "2026-01-15T12:35:00Z",
        "completed_at": "2026-01-15T12:41:00Z",
        "duration_seconds": 360,
        "failure_code": "VIEWER_TILE_INVALID"
      }
    },
    "outcome": "retained",
    "failure_stage": "VALIDATE_APP",
    "failure_code": "VIEWER_TILE_INVALID",
    "cleanup": {
      "outcome": "retained",
      "requested_at": null,
      "completed_at": null,
      "remaining_resource_count": 1,
      "failure_code": null
    }
  },
  "retained_runs": [
    {
      "run_id": "rv-20260115t100000z-a1b2c3d4",
      "outcome": "retained",
      "failure_stage": "VALIDATE_APP",
      "failure_code": "VIEWER_TILE_INVALID",
      "expires_at": "2026-01-16T12:41:00Z",
      "cleanup": {
        "outcome": "retained",
        "requested_at": null,
        "completed_at": null,
        "remaining_resource_count": 1,
        "failure_code": null
      },
      "child_resources": [
        {
          "apiVersion": "v1",
          "kind": "PersistentVolumeClaim",
          "name": "rv-a1b2c3d4-source",
          "uid": "00000000-0000-0000-0000-000000000001"
        }
      ]
    }
  ],
  "last_complete_success": {
    "run_id": "rv-20260108t100000z-11223344",
    "recovery_set_id": "<bounded recovery-set identity>",
    "target_lsn": "0/00000000",
    "started_at": "2026-01-08T10:00:00Z",
    "validation_completed_at": "2026-01-08T12:30:00Z",
    "cleanup_completed_at": "2026-01-08T12:36:00Z",
    "duration_seconds": 9360
  },
  "attempt_history": [
    {
      "entry_kind": "accepted_run",
      "run_id": "rv-20260115t100000z-a1b2c3d4",
      "trigger": "scheduled",
      "state": "FAILED_RETAIN",
      "outcome": "retained",
      "failure_stage": "VALIDATE_APP",
      "failure_code": "VIEWER_TILE_INVALID",
      "cleanup_outcome": "retained",
      "remaining_resource_count": 1,
      "started_at": "2026-01-15T10:00:00Z",
      "completed_at": "2026-01-15T12:41:00Z"
    },
    {
      "entry_kind": "rejected_trigger",
      "trigger_id": "trigger-20260115t113000z-55667788",
      "trigger": "on_demand",
      "outcome": "rejected",
      "failure_code": "OVERLAP_ACTIVE",
      "started_at": "2026-01-15T11:30:00Z",
      "completed_at": "2026-01-15T11:30:01Z"
    }
  ]
}
```

This example intentionally shows a completed accepted run with `active_run: null` while the later
started overlap remains `latest_trigger`; completing the holder updated its history entry without
erasing the concurrent rejection.

Required invariants are:

- `latest_trigger` advances by deterministic `(started_at, trigger_id)` ordering for every
  scheduled/on-demand trigger. An accepted trigger has outcome `accepted`; an overlap has outcome
  `rejected` and `OVERLAP_ACTIVE`. Its `completed_at` is the acquisition/rejection decision time,
  never the accepted run's completion time.
- an overlap CAS changes only `latest_trigger`, its identity-keyed rejected-trigger history summary,
  `generation`, and `updated_at`. It MUST NOT replace or alter `active_run`, `latest_run`,
  `retained_runs`, `last_complete_success`, or any holder-owned sequence, stage, resource, cleanup,
  or heartbeat. Other pre-accept trigger rejections have the same field-isolation rule and only a
  bounded trigger failure code differs.
- after successful Lease CAS and before provisioning, one ConfigMap CAS sets `active_run` to the
  new holder summary with `state=current_stage=SELECT`, sets the full accepted `latest_run` with
  `state=current_stage=SELECT,outcome=running`, records the accepted `latest_trigger`, and upserts
  its accepted-run history summary with `outcome=running`.
- `latest_run.sequence` increases on every accepted holder transition; stale writers cannot move it
  backward. Every nonterminal holder heartbeat/stage CAS sets `latest_run.state`,
  `latest_run.current_stage`, `active_run.state`, and `active_run.current_stage` to the same exact stage name
  and sets run/history `outcome=running`. `active_run.run_id`/Job UID must match the Lease holder.
- `latest_run.selected_source` binding fields cannot change after `SELECT` succeeds. Its historical
  `stages` start/completion timestamps and durations are UTC and internally consistent;
  interruption may leave a stage started but not completed until reconciliation closes it.
  `failure_stage` is null while nonterminal/succeeded and is required separately for
  `FAILED_RETAIN`; it never replaces `current_stage` or a `stages` entry.
- a terminal accepted run first persists `state=SUCCEEDED,outcome=succeeded` or
  `state=FAILED_RETAIN,outcome=retained`, sets the same terminal `state` plus
  `current_stage: null` in any matching `active_run`, and sets `latest_run.current_stage: null`, and updates its completed accepted-run history summary to the same projected
  outcome. It conditionally advances `last_complete_success` only after clean `CLEANUP` and leaves
  the matching active pointer in place through Lease release. A `FAILED_RETAIN` transition MUST in
  that same CAS upsert/transfer a full
  `retained_runs` record containing terminal code/stage, expiry, cleanup status, and every exact
  child API version/kind/name/UID before Lease release. Only after that transfer may a later accepted
  run replace `latest_run`.
- `retained_runs` is identity-merged by `run_id`, never exceeds the configured maximum of 2, and may
  temporarily duplicate the current terminal `latest_run`; duplicate identity does not count twice
  or create a second ownership record. `attempt_history` is never cleanup authority.
- after the terminal state/retention transfer, the holder releases the Lease and CAS-clears
  `active_run` only if it still names that run/Job UID; it MUST NOT clear a concurrently installed
  successor.
- `attempt_history` upserts by stable identity (`run_id` for `accepted_run`, `trigger_id` for
  `rejected_trigger`) and retains both kinds. Its canonical newest-first order is descending
  `(coalesce(completed_at, started_at), started_at, entry_kind, identity)` with UTC timestamps and lexical
  tie-breaks. Every CAS re-reads and unions identities before trimming, so a holder completion
  cannot erase a concurrently written overlap rejection.
- the latest accepted completed run is selected only from `accepted_run` history summaries; rejected
  triggers never become validation failure, cleanup, stuck, or last-success sources.
- `last_complete_success` advances only after `CLEANUP` records success and confirms every bound
  child absent; rejected triggers and accepted-run failure never erase it.
- child-resource entries are appended immediately after create responses and include API version,
  kind, name, and UID; cleanup outcomes and remaining counts remain visible. Orchestrator Job/Pod
  identity is evidence in a separate field and is never inserted into `child_resources`.
- unknown schema versions fail closed and do not replace known last-success state.

The serialized `state.json` value MUST be at most 512 KiB, with one full `latest_run`, at most one
`active_run` summary, one `latest_trigger` summary, at most 10 total `attempt_history` summaries,
and at most 2 `retained_runs`. The full latest run and each retained record have at most 64 exact
child resources; the latest/retained duplicate is counted in byte sizing even though identity merge
deduplicates ownership. A full run has at most 32 stage records. Every string and enum has a schema maximum; arbitrary free text is rejected. Before
crossing a count bound, the holder fails closed with `STATE_SIZE_EXCEEDED` and creates no
untrackable child.

On byte pressure the CAS merge first unions concurrent identity-keyed history updates, then removes
only the oldest canonical history entries while preserving `active_run`, full `latest_run`, every
`retained_runs` ownership record, `latest_trigger`, the newest completed accepted summary, and
`last_complete_success`. It
may then truncate only explicitly truncatable diagnostic summaries with a `truncated: true` marker.
It MUST NOT truncate the three pointers/summaries, immutable source bindings, holder
state/current_stage/sequence/heartbeat, retained ownership, child name/UID ownership, outcomes, or last-success evidence.
Holder writes MUST reserve enough of the 512 KiB envelope for both one maximum-size
`latest_trigger`/rejected-trigger history summary and transfer of the active run's maximum 64-child
retained record. Thus overlap and `FAILED_RETAIN` transfer can complete after trimming oldest
eligible reporting history. If a holder transition would consume that reserve, the owning run is closed
as `STATE_SIZE_EXCEEDED` using a bounded minimal terminal record before accepting more child state;
an overlap never closes or truncates the owning run to make room.

## Idempotent reconciliation and interruption

Every side effect is preceded by reading durable state and followed by a compare-and-set update.
On restart, the Lease holder requires `active_run` to identify itself and reconstructs progress from
`latest_run`'s immutable binding, sequence, bound child-resource name/UID list, separate
orchestrator evidence, and observed namespace objects. The sole exception is idempotent recovery of
an interruption between successful Lease CAS and the initial state CAS: the same Job UID may install
its initial accepted pointers only when no different nonterminal `active_run`/`latest_run` owner exists. Other
Lease/pointer disagreement fails closed or uses only the explicit terminal/stale-holder protocol;
the reconciler never adopts `latest_trigger` as run ownership. Create operations use deterministic run-scoped names and treat
an existing exact-owned object as the prior result. An object with the same name but different UID
or ownership causes `OWNERSHIP_CONFLICT`.

On every ConfigMap conflict, all writers re-read and perform a field-aware merge: trigger writers
upsert only `latest_trigger`/rejected history, while the holder updates only its matching
`active_run`/`latest_run`, accepted history, conditional success, and its identity-keyed retained
transfer. The failed-child reaper updates only identity-matched `retained_runs` cleanup records and
may mirror their cleanup summary into a same-ID terminal `latest_run`; it never sources ownership
from `latest_run`. No writer serializes
an earlier whole-document snapshot over the other writer's identity-keyed history additions.

Reconciliation repeats safe observations and cleanup, but never repeats source selection for a
bound run, changes target LSN, applies `db.sql`, reruns a completed non-idempotent child, or
adopts an unlabelled object. A child writes machine-readable output to a bounded run-owned
result object or termination record before the orchestrator advances the stage. Missing output
is not inferred as success from Pod exit alone.

After an orchestrator process interruption, the same holder first determines whether the exact
nonterminal `current_stage` is safely resumable. A safe resume keeps that stage and
`outcome=running`; it does not persist `INTERRUPTED` as a run state or outcome. If resume is unsafe,
or for stale takeover/timeout, the reconciler closes the historical stage, stores
`INTERRUPTED`, `INTERRUPTED_STALE_HOLDER`, `STAGE_TIMEOUT`, or `MAX_RUNTIME_EXCEEDED` only as the
bounded `failure_code`, sets separate `failure_stage`, and transitions the accepted run/history to
`state=FAILED_RETAIN,outcome=retained,current_stage=null`. It preserves newer trigger history,
transfers full exact child ownership into `retained_runs`, releases the Lease, and conditionally
clears matching `active_run`.
