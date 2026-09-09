# Isolated restore-validation contract

## Status and purpose

This document is the normative design contract for issue
[#1249](https://github.com/bcit-tlu/hriv/issues/1249), a design slice of
[#1229](https://github.com/bcit-tlu/hriv/issues/1229). It defines how a future
`hriv-restore-validation` component must prove that a published HRIV recovery set can restore
without touching production. The recovery-set publication and consistency rules remain
normative in [the recovery-set contract](recovery-set-contract.md).

This is a design only. It does not claim that the controller, chart, Flux resources, Vault
wiring, schedule, metrics, or alerts exist. In particular, merging this document does **not**
clear `HRIVRestoreTestFailed`; that alert may clear only after a deployed implementation has
completed every validation and cleanup gate described here.

The keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** state implementation requirements.

## Baseline decisions and non-goals

The following decisions from #1229 and flux-fleet
[#241](https://github.com/bcit-tlu/flux-fleet/issues/241) are fixed baselines, not open design
questions:

- Restore validation is a separate release component named `hriv-restore-validation` in a
  dedicated `hriv-restore-validation` namespace.
- The hardened `hriv-backup` Deployment MUST NOT gain a Kubernetes API token, Kubernetes
  client, or RBAC permissions.
- Azure archive access uses a read-only container-scoped SAS. Validation never receives Azure
  write credentials.
- The production database source profile is the versioned, Flux-owned profile from
  flux-fleet #241: CNPG cluster `pg-core`, database `app`, owner `app`, the approved server
  identity, and the Barman Cloud plugin `ObjectStore`. Recovery targets the exact manifest LSN
  and WAL-fence timeline. The manifest's `database_name` is the HRIV connection database and is
  not the source-profile authority.
- Every run uses a fresh CNPG Cluster and fresh PVCs. It restores all physical databases and
  MUST NOT execute `db.sql`.
- Synthetic authentication is local to the restored database and uses a validation-only
  credential. Production OIDC, callbacks, credentials, routes, and Services are out of scope.
- One representative synthetic image is rebuilt serially, then the existing synthetic
  monitoring image validates login, browsing, DZI metadata, and a representative tile.
- The controller validates and reports. It MUST NOT repair production or validation data by
  inventing rows, removing mismatches, or rewriting a recovery set.

Longhorn snapshots, clones, and APIs are not prerequisites. Validation MUST NOT receive a
Longhorn `ClusterRole` or infer available capacity by querying Longhorn custom resources.

## Trust boundary and component architecture

```text
Flux/Vault static resources
  scheduled CronJob ---------+
  suspended on-demand -------+--> orchestrator Job/Pod [API token; retained evidence]
  source profile/policy -----+          |
  child templates/images ----+          |
  synthetic target config ---+          |
  fixed ConfigMap + Lease <--+          |
  read-only SAS ------------------------+--> no-permission restore children --> approved Azure egress
  Barman read Secret/ObjectStore -------+--> fresh CNPG Cluster/PVCs --------> approved Azure egress
  synthetic credential -----------------+--> credential-init/app/synthetic children
                                       |
                                       +--> fresh source/tile PVCs
  terminal-Job reaper -------> removes old orchestrator Jobs after evidence window

fixed ConfigMap --read-only volume--> status exporter [no API token] --> Prometheus

All shown runtime resources are in namespace hriv-restore-validation. Production hriv and
postgres namespaces have no edge to the validation namespace.
```

Flux MUST create static namespace infrastructure. The orchestrator creates only run-scoped
resources in its own namespace. Among run workloads, only the orchestrator mounts a Kubernetes API
token; Flux-owned reaper Jobs use separate, narrower namespace service accounts for their fixed
cleanup functions. Backup restore, `psql`, credential-init, application, tile-rebuild, and
synthetic Jobs or Pods use a `no-permission` service account with
`automountServiceAccountToken: false`. The status exporter also disables token automount and reads
the fixed state ConfigMap through a read-only ConfigMap volume, not through the Kubernetes API.

The production `hriv` and `postgres` namespaces are outside the authorization and network
boundary. There is no production mount, route, Service alias, `ExternalName`, credential,
worker, database connection, source-image claim, or tile claim in a validation run.

### Static and run-scoped resources

Flux, with Vault Secrets Operator where required, MUST own these static resources:

- namespace, ResourceQuota, LimitRange, service accounts, namespace-scoped Roles, and RoleBindings;
- default-deny and explicit-allow NetworkPolicies;
- read-only Azure source SAS Secret;
- Barman read credential and the deployed CNPG-I Barman Cloud plugin `ObjectStore` CRD
  configuration;
- synthetic credential Secret containing the email that identifies the recovered production
  synthetic row plus a validation-only plaintext password and matching precomputed password hash;
- versioned source-profile ConfigMap and operator-reviewed source-state-policy ConfigMap;
- mounted read-only, versioned child-template ConfigMap with fixed Pod/workload specifications and
  a digest-pinned image allowlist;
- versioned synthetic-target ConfigMap containing only the internal validation `BASE_URL`, fixed
  category path, and representative recovered image name;
- fixed durable-state ConfigMap and overlap Lease identities, initialized without runtime fields
  and preserved as described below;
- scheduled CronJob, suspended on-demand CronJob, failed-child cleanup/reaper CronJob,
  terminal-orchestrator-Job reaper CronJob, and status exporter Deployment and Service; and
- the approved admission policy and egress enforcement resources described below.

The orchestrator MUST NOT remove or reconfigure those static resources. The only runtime-field
exceptions are compare-and-set updates to `data.state.json` in the fixed state ConfigMap and the
coordination fields of the fixed Lease; neither object may be deleted. The orchestrator mounts the
child-template and synthetic-target ConfigMaps read-only and accepts no Pod/workload specification,
image, command, volume, Secret name, `BASE_URL`, category path, or image name from recovery
metadata.

A run record separately tracks (a) the orchestrator Job and its Pod as retained lifecycle evidence
and (b) every bound **child** Job/Pod, Deployment, Service, result ConfigMap, PVC, and CNPG Cluster
it creates from those fixed templates. The orchestrator Job/Pod are never children and are
excluded from the success-path cleanup absence gate. The static reaper, not the running orchestrator, removes a
terminal orchestrator Job and its Pod only after the configured evidence/history window.

## Least privilege

Only namespace-scoped Roles are allowed. A `ClusterRole`, cluster-scoped binding, wildcard API
group, wildcard resource, wildcard verb, impersonation, token creation, Secret read, and
production namespace access are forbidden. These Roles can neither get nor write any resource in
the production `hriv` or `postgres` namespace.

| Principal                           | Allowed surface                                                                                                                                                                                                                                                                                                                                             | Forbidden surface                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestrator service account        | In its namespace: `get` the named source-profile/source-state-policy ConfigMaps; `get/update/patch` the named state ConfigMap and Lease by CAS; patch its named Job/Pod; create/get/list/watch/patch/delete labelled child Jobs/Pods, Deployments, Services, result ConfigMaps, PVCs, and CNPG Clusters; observe Events and status for only those run kinds | Secret API reads; arbitrary ConfigMaps; nodes; namespaces; RBAC mutation; service-account tokens; Longhorn APIs; any object in `hriv` or `postgres`; cluster-scoped objects |
| No-permission child service account | No Kubernetes API permissions; fixed-template Secret, ConfigMap, and PVC references may be mounted by kubelet                                                                                                                                                                                                                                               | Kubernetes API token or client; resource discovery; production mounts or credentials                                                                                        |
| CNPG operator                       | Existing operator permissions needed to reconcile the validation-namespace Cluster and its PVCs                                                                                                                                                                                                                                                             | Validation does not grant or widen operator access; no production Cluster mutation is requested                                                                             |
| Failed-child reaper service account | `get/list/delete` only expired, state-bound child Jobs/Pods, Deployments, Services, result ConfigMaps, PVCs, and CNPG Clusters by exact name/UID plus `get/update/patch` on the named state ConfigMap using CAS                                                                                                                                             | Creating workloads; Secrets; current orchestrator Job/Pod deletion; static, unbound, foreign, nonexpired, or cross-namespace resources                                      |
| Terminal-Job reaper service account | List/get/delete only terminal orchestrator Jobs/owned Pods past the evidence window using fixed component labels                                                                                                                                                                                                                                            | State mutation; child/static/foreign resources; nonterminal Jobs; cross-namespace resources                                                                                 |
| Status exporter service account     | No API verbs; read-only mounted projection of the fixed state ConfigMap                                                                                                                                                                                                                                                                                     | API token, Secret mounts, state writes, or run-resource operations                                                                                                          |
| Human operator                      | Existing audited GitOps and approved on-demand Job-creation path                                                                                                                                                                                                                                                                                            | Direct use of validation credentials against production or bypass of the shared entrypoint                                                                                  |

The final Roles MUST enumerate concrete API groups, resources, verbs, and, where Kubernetes
supports it, static `resourceNames` for the state ConfigMap, Lease, and named source-profile/
source-state-policy ConfigMap `get` rules. Helm tests and an
acceptance check with `kubectl auth can-i` MUST prove denied access to Secrets, cluster-scoped
resources, and the production namespaces. The test must not depend only on reviewing rendered
YAML.

Kubernetes RBAC cannot constrain dynamic create/list/delete verbs by object label, and
`resourceNames` cannot safely enumerate run-scoped names before creation. The Role's permissions for
those concrete child kinds are therefore namespace-wide even though the controller contract is
label/UID-bound. The validating admission policy MUST enforce allowed create/update/delete
operations from `request.object`/`request.oldObject`, reject static or foreign targets, and require
the exact run/component labels and fixed templates. Controller code independently checks the bound
name/UID before every mutation. Namespace isolation, admission enforcement, and those runtime checks
are all required; RBAC wording alone MUST NOT be treated as label-level authorization.

Denying Secret `get` is not by itself a Secret boundary: a principal that can create a Pod can
indirectly cause kubelet to mount any namespace Secret into that Pod. Therefore the orchestrator
MUST instantiate only the Flux-controlled child-template ConfigMap's fixed volume/Secret
references and digest-pinned image allowlist. That ConfigMap and the separate synthetic-target
ConfigMap are mounted read-only and versioned. The orchestrator MUST NOT render Pod specs, image
names, commands, volumes, environment variables, service accounts, Secret names, internal
`BASE_URL`, category path, or representative image name from recovery metadata. A Flux-owned
validating admission policy (or equivalent platform admission control)
MUST reject nonconforming children, and tests MUST attempt arbitrary namespace-Secret mounts and
template/image substitutions and prove rejection.

## Credentials and read surfaces

Credential material MUST be delivered as static Flux/Vault resources in the validation
namespace and MUST NOT appear in the state ConfigMap, labels, annotations, logs, events,
metrics, Job arguments, or generated resource names.

| Input                          | Capability                                                                                                     | Consumer                                                                           | Constraint                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Azure source SAS               | List/read only within the configured backup container and prefix                                               | Selection and filesystem-restore child                                             | No create, update, or remove capability; expiry must cover maximum run time                                                        |
| Barman object-store credential | Read the existing CNPG recovery source                                                                         | CNPG operator/recovery Pods                                                        | Referenced by validation-only `ObjectStore`; no archive write destination                                                          |
| Synthetic credential           | Recovered production synthetic-row email plus validation-only plaintext password and matching precomputed hash | Credential-init receives all fields; synthetic child receives only email/plaintext | Email selects the recovered row; password/hash are never a production password or OIDC credential; app child does not receive them |
| Restored database app identity | Connect to the fresh CNPG Cluster                                                                              | `psql` and isolated application children                                           | Validation-local Secret generated/reconciled for the restored Cluster; never inferred as proof of source fidelity                  |

Selection may read Azure archive metadata, sidecars, `BACKUP_STATE.json`, and
`LAST_SUCCESS.json`. CNPG recovery may read its Barman source. Those are the complete explicit
production-data read surfaces. There is no production write surface: the implementation MUST
NOT update production backup state, Azure objects, databases, PVCs, Services, or recovery-set
retention metadata.

### GitOps and runtime state ownership

Flux and the Helm release own the fixed state ConfigMap and Lease metadata and lifecycle, while
runtime controllers own only `data.state.json` and Lease coordination fields. On initial creation,
the chart MUST render the ConfigMap with **no `data`** and the Lease with an **empty `spec`**. Chart
templates MUST NEVER render mutable ConfigMap `data.state.json` or Lease `holderIdentity`,
`acquireTime`, `renewTime`, or `leaseDurationSeconds`, whether empty, defaulted, copied, or otherwise.
There is no render-time state snapshot and no Helm `lookup` of either live object.

Those mutable fields are absent from both the original release manifest and every desired upgrade
manifest, so Helm's three-way upgrade merge preserves fields subsequently added by runtime
controllers. Both objects MUST carry `helm.sh/resource-policy: keep` and the corresponding approved
Flux retention/prune protection so uninstall, replacement, or pruning cannot delete durable state or
coordination accidentally. State-schema initialization and migration remain explicit runtime
compare-and-set operations; Helm never writes or migrates `state.json`.

Render, regression, and live tests MUST prove the install manifests omit every runtime field, then
reconcile and upgrade the Helm release during an active run and after a completed run. The active
case proves holder/acquire/renew/duration fields and state sequence survive; the completed case
proves attempt history and last complete success survive while an empty Lease remains empty. Tests
MUST also prove keep/prune policy and fail if a future chart adds any mutable field. This split
ownership is limited to these two named resources; it does not permit runtime mutation of source
profiles, source-state policy, credentials, quota, RBAC, NetworkPolicies, schedules, synthetic
targets, or child templates.

## Network isolation

The namespace starts with default-deny ingress and egress. Standard Kubernetes NetworkPolicy
cannot constrain Azure by FQDN. Deployment is blocked until the platform approves and tests either
CNI-enforced FQDN policy or a dedicated allowlisting egress proxy/service-tag mechanism for the
exact storage accounts. A broad `0.0.0.0/0` TCP 443 rule is forbidden. CNPG recovery Pods and every
Azure-reading child MUST use that approved mechanism; this design does not pretend an IP-only
NetworkPolicy solves the requirement.

Explicit policies and the approved egress mechanism MUST allow only:

- UDP/TCP 53 to CoreDNS Pods selected by namespace and pod labels in the platform DNS namespace;
- HTTPS to only the approved Azure storage destinations through the approved mechanism;
- communication among validation workloads selected by both validation component and run labels;
- ingress from CNPG operator namespace/pod selectors to the validation Cluster's documented
  instance-manager/operator paths, and validation clients to the recovered Cluster Service;
- orchestrator and reaper TCP access only to the configured Kubernetes API Service ClusterIP and
  secure port (normally 443), never an arbitrary external API address;
- Prometheus ingress to the exporter only from the configured monitoring namespace and Prometheus
  pod selectors;
- CNPG operator control paths required by the deployed version, with no policy widening; and
- OTLP egress to the approved collector Service only when enabled.

There is no allow rule for production HRIV frontends/backends, production PostgreSQL, production
Redis, ingress controllers, public routes, broad namespace-to-namespace traffic, or general
internet access. Application, credential-init, tile, and synthetic children connect only to the
validation DB/Redis/Services/PVCs and cannot reach internet or production routes. Application
validation uses internal validation-only Services. Policies MUST be tested by proving every
expected DNS, API, Prometheus, CNPG-operator, database, and approved-Azure path works and that
representative production and public endpoints cannot be reached.

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

Orchestrator CronJobs MUST NOT set `ttlSecondsAfterFinished`. Their successful/failed Job-history
limits MUST be configured above both the namespace's maximum Job object quota and the maximum
number of Jobs that can be created during the evidence window plus bounded reaper outage/repair
window. Therefore CronJob history GC cannot reach its threshold; render and acceptance tests MUST
prove that invariant. The terminal-Job reaper is the sole deletion path for terminal orchestrator
Jobs, and history settings MUST NOT substitute for time-based reaping. Scheduled, on-demand, failed-child-reaper, and
terminal-Job-reaper Job templates all use `restartPolicy: Never` and `backoffLimit: 0` and MUST NOT
set a finished-Job TTL.

### Lease protocol

Before source selection, every path performs a nonblocking attempt to acquire the single fixed
Lease. An overlap rejection MUST compare-and-set only `latest_trigger` and a bounded rejected-trigger
summary in `attempt_history` with failure code `OVERLAP_ACTIVE`, then terminate without provisioning
or retrying behind the holder. That CAS MUST preserve `active_run`, the full `latest_run` ownership,
stages, resources, and heartbeat, and `last_complete_success`; an overlap is a rejected trigger, not
an owning validation run.

The Lease holder identity is the orchestrator Job UID plus its DNS-safe run ID. Normal renewal
continues until terminal state has been persisted. On every normal terminal path, including
`SUCCEEDED` and `FAILED_RETAIN`, the holder MUST then compare-and-set the Lease to clear
`holderIdentity` (and its acquisition/renewal fields as the Lease schema permits), so the next run
can start immediately rather than waiting for expiry. If a holder failed to clear but its durable
attempt is already terminal, a contender MAY immediately compare-and-set acquisition of the
still-held Lease without waiting for expiry and without writing `INTERRUPTED_STALE_HOLDER`; this is
terminal-holder recovery, not stale takeover.

A contender MUST NOT take a merely expired Lease whose durable holder remains within a valid
nonterminal run. Stale takeover applies only to a holder whose
durable attempt is still nonterminal, whose Lease is expired, and whose run has exceeded maximum
runtime, and only when:

1. the holder Job is confirmed absent or terminal in the validation namespace;
2. the contender records a bounded interrupted outcome for the old attempt with
   `INTERRUPTED_STALE_HOLDER`; and
3. compare-and-set on the Lease succeeds.

A rejected trigger is durable trigger history, not an accepted validation run, validation failure,
or replacement for the active/latest owning run. All scheduled, on-demand, and reaper Jobs MUST use
`backoffLimit: 0`: Kubernetes retries no failed Pod. The orchestrator itself owns bounded,
deadline-aware observation retries with exponential backoff and jitter; it never delegates
semantic or observation retry policy to Job Pod recreation.

## Run identity and ownership

A run ID MUST combine a UTC timestamp and cryptographically random suffix, be lowercase and
DNS-label safe, and remain independent of archive or recovery-set IDs. For example, its shape
may be `rv-20260115t100000z-a1b2c3d4`; the random portion, not an archive identity, prevents
collisions. Each invocation also derives a bounded stable `trigger_id` from its UTC trigger time and
Job UID before Lease acquisition. That key exists only for trigger summary/history merge and never
appears in metric labels. A rejected trigger does not make its candidate run ID an owning run.

The CronJob template MUST place the fixed component ownership label on the orchestrator Job/Pod;
after generating its run ID, the orchestrator MUST patch its own Job and Pod with the run label and
bounded expiry/evidence annotations. Every child resource MUST carry all of:

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

`SELECT` MUST choose the newest **fully published** production recovery set according to the
recovery-set contract, never the newest blob by modification time. Before accepting a set, the
orchestrator or read-only selection child MUST verify:

- archive publication metadata says `published`, not candidate, unknown, committed-only,
  rejected, failed, or cancelled;
- the archive and immutable manifest sidecar both exist and identify each other;
- `BACKUP_STATE.json` and `LAST_SUCCESS.json` are readable and coherent with the published
  archive, sidecar, run identity, component outcomes, and completion timestamp;
- manifest/schema/archive versions are supported and production mode is declared;
- expected components are present, `db.sql` and generated tiles are absent, and no incomplete
  staging or upload artifact is selected;
- archive size, source-image counts and bytes, per-file sizes, and SHA-256 checksums are valid
  and internally coherent;
- missing/orphan/excluded lists, counts, digests, and acceptance state obey the source-state
  policy below;
- CNPG provider, source cluster, WAL fence metadata, versions, and checksums are supported; and
- `database_recovery.target_lsn` and a 24-hex-character `wal_fence_file` are present and
  syntactically valid.

Flux MUST provide a versioned static source-profile ConfigMap for flux-fleet #241. Its immutable
profile ID/version binds expected source cluster/provider, application database `app`, owner
`app`, server/system identity, and the deployed Barman Cloud plugin `ObjectStore` name/version.
The controller MUST use that profile—not manifest `database_name`, which identifies the HRIV
connection database—to configure and validate `app`/`app`, and MUST cross-check manifest
cluster/provider/WAL metadata against it. `ObjectStore` is the actual CRD provided by the deployed
CNPG-I Barman Cloud plugin, not a generic substitute. This requires no backup-manifest schema
change.

The exact `database_recovery.target_lsn`, not `target_time`, becomes the CNPG
`recoveryTarget.targetLSN`. The controller MUST derive the timeline from exactly the first eight
hex characters of `database_recovery.wal_fence_file` (for example, `00000007` means timeline 7),
bind that parsed value, and explicitly set CNPG `recoveryTarget.targetTimeline` to its decimal
string together with `targetLSN`. It MUST reject missing, unsupported, malformed, zero, or
inconsistent fence/timeline evidence with `WAL_FENCE_UNSUPPORTED` or `TIMELINE_MISMATCH`; it MUST
NOT request `latest`. `target_time` remains audit evidence only.

Before any provisioning, the controller MUST append a run record that binds the selected
recovery-set identity, archive/sidecar versions and checksums, exact target LSN and derived
timeline, declared bytes, source-profile ID/version/database/owner/server/`ObjectStore`, and
source-state-policy version/digest. Those binding fields become immutable for that attempt. A
restarted controller resumes the same binding or fails; it never silently advances to a newer set.

### Source-state drift policy

Current recovery-set semantics are unchanged: missing rows remain reported, skipped, and
preserved; orphan files remain excluded and are never restored, created as rows, or deleted.
`manifest.validation.accepted` is necessary publication evidence, not proof of zero drift and not
sufficient for restore-validation success. No backup-code or manifest-schema change is required.

The Flux-owned, versioned `source-state-policy` ConfigMap defaults to allowing exactly zero
missing and zero orphan entries. A nonzero set can pass consistency only when its canonical,
bounded IDs/paths, separate counts, and list digest exactly match one operator-reviewed Git policy
entry for the current #1240 condition. Unknown or newly observed entries, truncation, duplicate or
unsafe paths, count/digest disagreement, or any policy mismatch fails
`SOURCE_STATE_UNAPPROVED`/`SOURCE_STATE_DRIFT`. Policy values never cause a skipped file to be
restored. Every `excluded_incomplete_artifacts` entry must independently match this normative, versioned
allowlist; an approved missing/orphan set does not approve arbitrary exclusions:

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
requests/limits, `persistentvolumeclaims`, and explicit Job, Pod, Service, ConfigMap, and Secret
object counts. Every container has requests and limits, and every temporary PVC has an explicit
storage request.

During `PREFLIGHT`, the controller uses only its own namespace API to calculate:

- active runs and failed runs retained for diagnosis;
- bound child objects and declared PVC requests for each run;
- the new source PVC requirement derived from manifest bytes plus configured headroom;
- configured CNPG database storage, tile scratch, and temporary-workspace requests; and
- remaining namespace quota and configured maximum retained-run count.

The preflight fails before provisioning when declared namespace quota cannot fit, quota status is
unavailable, or retained-run bounds are already reached. It reports `CAPACITY_INSUFFICIENT`,
`QUOTA_UNAVAILABLE`, or `RETAINED_RUN_LIMIT` and leaves the selected binding inspectable. This
proves only declared namespace quota and LimitRange compliance—not node, volume, or storage-system
physical capacity. It does not query nodes, StorageClasses, Longhorn resources, or production
PVCs and does not guess unreported physical capacity. A later unschedulable Pod, unbound PVC, or
storage/CNPG provision failure is terminal `PROVISION_FAILED`, with bounded events retained as
evidence.

## State machine

```text
SELECT -> PREFLIGHT -> PROVISION -> WAIT_CNPG -> VALIDATE_DB -> INIT_SYNTHETIC_CREDENTIAL
  -> RESTORE_FILES -> VALIDATE_CONSISTENCY -> START_APP -> REBUILD_TILE -> VALIDATE_APP
  -> CLEANUP -> SUCCEEDED -> RELEASE_LEASE -> ORCHESTRATOR_EXIT

Any stage through VALIDATE_APP --terminal failure--> FAILED_RETAIN -> RELEASE_LEASE -> EXIT
CLEANUP --incomplete cleanup-------------> FAILED_RETAIN -> RELEASE_LEASE -> EXIT
FAILED_RETAIN --expiry/approved request--> REAP_FAILED_CHILDREN -> FAILED_RETAIN(cleaned)
terminal orchestrator Job --evidence window-------> STATIC_JOB_REAPER

Success-path `CLEANUP` reaches `SUCCEEDED` only after every bound child run resource is confirmed
absent. The orchestrator Job and Pod remain as evidence, are not part of that gate, and cannot be
absent before their own successful exit. After persisting `SUCCEEDED`, the orchestrator clears the
Lease by CAS and exits; the static reaper later removes its terminal Job/Pod.
```

The stages are ordered gates:

| Stage                       | Required result                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SELECT`                    | Verify and immutably bind the latest fully published set and exact LSN.                                                                                                                                   |
| `PREFLIGHT`                 | Prove declared namespace quota plus run/retention bounds without claiming physical capacity.                                                                                                              |
| `PROVISION`                 | Create fresh labelled PVCs, CNPG Cluster, and validation-only support objects.                                                                                                                            |
| `WAIT_CNPG`                 | Observe CNPG recovery to the exact target LSN and readiness within deadline.                                                                                                                              |
| `VALIDATE_DB`               | Validate source system identity, all database/owner/static-role inventory, schema migration version, representative row counts and metadata, exact synthetic row, and WAL/fence boundary before mutation. |
| `INIT_SYNTHETIC_CREDENTIAL` | Run the one-shot credential-init Job and record its one-row post-fidelity password-hash mutation.                                                                                                         |
| `RESTORE_FILES`             | Use read-only stateless filesystem restore into the fresh source PVC; never execute SQL or update backup state.                                                                                           |
| `VALIDATE_CONSISTENCY`      | Verify archive/per-file checksums, counts, paths, DB rows versus files, and exact source-state policy.                                                                                                    |
| `START_APP`                 | Start isolated backend/frontend/Redis support against only restored targets with application migrations, production OIDC, routes, callbacks, and workers disabled.                                        |
| `REBUILD_TILE`              | Run the one-shot validation CLI Job to rebuild exactly one selected recovered image serially into a fresh tile PVC and consume its machine result.                                                        |
| `VALIDATE_APP`              | Use the existing synthetic image to prove local login, category/image browsing, metadata, DZI, dimensions/content evidence, and a representative tile.                                                    |
| `CLEANUP`                   | Remove all and only bound child run resources, then list/get to confirm those children are absent; exclude the orchestrator Job/Pod.                                                                      |
| `SUCCEEDED`                 | Persist only after every prior gate and child cleanup confirmation succeeds; then clear the Lease and exit.                                                                                               |
| `FAILED_RETAIN`             | Persist failure, stop mutation, set bounded expiry, clear the Lease, and leave labelled child targets for diagnosis until reaping.                                                                        |

Each stage has a configured deadline bounded by the maximum runtime. Retryable observations use
bounded exponential backoff with jitter. Semantic validation failures, unsupported inputs,
overlap, authorization denial, and capacity failures are not retried within an attempt.

### Sequence

```text
Trigger       Orchestrator       State/Lease       Kubernetes/CNPG/children        Static reaper
   |                |                  |                         |                       |
   |--------------->| acquire Lease CAS; state CAS sets active_run/latest_run/trigger ->|
   | overlap trigger|-- reject; CAS latest_trigger/history only -->|                    |
   |                | select/bind ---->|--- read-only source --->|                       |
   |                | persist binding->|                         |                       |
   |                | preflight/create ------------------------->|                       |
   |                |                  |        CNPG recovery/read-only Azure           |
   |                |<-----------------|------- recovered Cluster status/machine result |
   |                | DB fidelity; then credential-init/files/app/tile/viewer -------->|
   |                |<-----------------|------- machine-readable bounded outcomes       |
   |                | delete all bound children ---------------->|                      |
   |                | confirm child absence -------------------->|                      |
   |                | persist terminal latest_run/conditional last success ------------>|
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
scheduled/on-demand invocations, including an overlap rejection. `attempt_history` retains bounded
summaries for accepted runs and rejected triggers, while `last_complete_success` remains separate.
Detailed inventories and free text remain in structured logs or run evidence; durable state stores
bounded codes and summaries. It contains no credentials, SAS URLs, connection strings, tokens, or
Secret values. When non-null, `active_run` contains only `run_id`, `job_name`, `job_uid`, `state`,
`stage`, `sequence`, `started_at`, and `heartbeat_at`; the full bindings, stages, resources, and
cleanup remain solely in matching `latest_run`.

A representative `state.json` value is:

```json
{
  "schema_version": 2,
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
      "source_state_policy_version": 1,
      "source_state_policy_sha256": "<digest>",
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
        "api_version": "v1",
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
    "outcome": "failed",
    "failure_stage": "VALIDATE_APP",
    "failure_code": "VIEWER_TILE_INVALID",
    "cleanup": {
      "outcome": "retained",
      "requested_at": null,
      "completed_at": null,
      "remaining_resource_count": 4,
      "failure_code": null
    }
  },
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
      "outcome": "failed",
      "failure_stage": "VALIDATE_APP",
      "failure_code": "VIEWER_TILE_INVALID",
      "cleanup_outcome": "retained",
      "remaining_resource_count": 4,
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
  `last_complete_success`, or any holder-owned sequence, stage, resource, cleanup, or heartbeat.
- after successful Lease CAS and before provisioning, one ConfigMap CAS sets `active_run` to the
  new holder summary, sets the full `latest_run` to that accepted run, records the accepted
  `latest_trigger`, and upserts its accepted-run history summary.
- `latest_run.sequence` increases on every accepted holder transition; stale writers cannot move it
  backward. Holder heartbeats/stage transitions update the full `latest_run` and the matching
  `active_run` summary in one CAS. `active_run.run_id`/Job UID must match the Lease holder.
- `latest_run.selected_source` binding fields cannot change after `SELECT` succeeds. Its stage
  start/completion timestamps and durations are UTC and internally consistent; interruption may
  leave a stage started but not completed until reconciliation closes it.
- a terminal accepted run first persists terminal `latest_run` and its completed history summary,
  conditionally advances `last_complete_success` only after clean `CLEANUP`, and leaves the matching
  `active_run` in place. It then releases the Lease and CAS-clears `active_run` only if it still
  names that run/Job UID; it MUST NOT clear a concurrently installed successor.
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
`active_run` summary, one `latest_trigger` summary, at most 10 total `attempt_history` summaries
across accepted runs and rejected triggers, 64 bound child resources in the full run, and 32 stage
records. Every string and enum has a schema maximum; arbitrary free text is rejected. Before
crossing a count bound, the holder fails closed with `STATE_SIZE_EXCEEDED` and creates no
untrackable child.

On byte pressure the CAS merge first unions concurrent identity-keyed history updates, then removes
only the oldest canonical history entries while preserving summaries referenced by `active_run`,
`latest_run`, `latest_trigger`, the newest completed accepted run, and `last_complete_success`. It
may then truncate only explicitly truncatable diagnostic summaries with a `truncated: true` marker.
It MUST NOT truncate the three pointers/summaries, immutable source bindings, holder sequence/stage/
heartbeat, child name/UID ownership, outcomes, or last-success evidence. Holder writes MUST reserve
enough of the 512 KiB envelope for one maximum-size `latest_trigger` and rejected-trigger history
summary, so an overlap can always perform its required bounded merge after trimming the oldest
eligible history entry. If a holder transition would consume that reserve, the owning run is closed
as `STATE_SIZE_EXCEEDED` using a bounded minimal terminal record before accepting more child state;
an overlap never closes or truncates the owning run to make room.

## Idempotent reconciliation and interruption

Every side effect is preceded by reading durable state and followed by a compare-and-set update.
On restart, the Lease holder requires `active_run` to identify itself and reconstructs progress from
`latest_run`'s immutable binding, sequence, bound child-resource name/UID list, separate
orchestrator evidence, and observed namespace objects. The sole exception is idempotent recovery of
an interruption between successful Lease CAS and the initial state CAS: the same Job UID may install
its initial accepted pointers only when no different `active_run`/`latest_run` owner exists. Other
Lease/pointer disagreement fails closed or uses only the explicit terminal/stale-holder protocol;
the reconciler never adopts `latest_trigger` as run ownership. Create operations use deterministic run-scoped names and treat
an existing exact-owned object as the prior result. An object with the same name but different UID
or ownership causes `OWNERSHIP_CONFLICT`.

On every ConfigMap conflict, all writers re-read and perform a field-aware merge: trigger writers
upsert only `latest_trigger`/rejected history, while the holder updates only its matching
`active_run`/`latest_run` and accepted history plus conditional success. Neither writer serializes
an earlier whole-document snapshot over the other writer's identity-keyed history additions.

Reconciliation repeats safe observations and cleanup, but never repeats source selection for a
bound run, changes target LSN, applies `db.sql`, reruns a completed non-idempotent child, or
adopts an unlabelled object. A child writes machine-readable output to a bounded run-owned
result object or termination record before the orchestrator advances the stage. Missing output
is not inferred as success from Pod exit alone.

After an orchestrator interruption, the current or stale-takeover reconciler updates the accepted
`latest_run`/history with `INTERRUPTED`, determines whether the current stage is safely resumable,
and either resumes it or transitions to `FAILED_RETAIN`. It preserves any newer `latest_trigger`
and rejected-trigger history. Timeouts transition deterministically, release the Lease, and
conditionally clear the matching `active_run` so no run remains permanently active.

## Validation details

### Database fidelity

The bound `pg-core` source profile explicitly requests source database `app`, owner `app`, server
identity, and `ObjectStore`, restores all physical databases, and targets the exact bound LSN and
explicit derived timeline. The controller MUST NOT use manifest `database_name` or a
default-generated application Secret as evidence that source database/owner recovery was correct.

Database checks compare the expected system identifier and timeline/recovery evidence, complete
database inventory, owner and static-role inventory, schema migration version, representative
row counts and key invariants, source-image rows, selected synthetic user/category/image metadata,
and the recovery WAL-fence boundary. Unexpected bootstrap-created databases or roles, wrong
ownership, a target beyond/short of the requested boundary or on another timeline, or inventory
drift fails closed.

The recovered production synthetic user row MUST exist and pass all DB-fidelity checks before any
credential change. The entire recovered database MUST contain exactly one row whose
`metadata.synthetic` is true, and that row's bounded identity MUST match the configured invariant;
zero, multiple, or wrong-identity rows fail. Validation
MUST NOT invent or upsert a user. The Secret's email is the identity selector for this recovered
production synthetic row; it is not a newly invented identity. The Secret's plaintext password and
hash are validation-only values and MUST NOT be copied from any production password or OIDC
credential.

The precomputed hash MUST exactly match the backend's current bcrypt contract: bcrypt modular-crypt
algorithm/prefix `$2b$`, cost 12 (`$2b$12$`), and a valid 60-character encoding accepted by the
versioned backend image's `bcrypt.checkpw`. Before mutation, credential-init MUST run that same
check and prove the Secret's plaintext password matches the supplied hash; a wrong algorithm,
prefix, cost, length, or plaintext/hash mismatch fails `CREDENTIAL_INIT_FAILED` without updating the
row.

Only then may a one-shot, no-token, validation-only credential-init Job mount the Vault-provided
email, plaintext password, and precomputed password hash and update only that exact row's
`password_hash` in the isolated database. It performs no migration, identity/role/metadata update,
or production connection. The before-row identity,
non-password fidelity result, affected-row count of exactly one, and controlled post-fidelity
mutation outcome are recorded as bounded evidence without credential/hash values. The application
never receives production credentials, and the synthetic child receives only the validation
email/plaintext password—not the hash and never a reused production credential.

### Filesystem and consistency

The restore child uses the stateless, read-only source-filesystem path from #1250 and writes only
to the supplied fresh target. It verifies exact recovery-set identity, safe member paths,
archive and manifest versions, all selected file sizes/checksums, and final counts. It cannot
update production or validation backup publication state.

Consistency preserves the recovery-set outcomes and then applies the bound source-state policy:

- a database row with a missing source file remains skipped and preserved; no row is removed and
  no file or tile is synthesized for it. Zero is accepted by default; a nonzero exact #1240 policy
  match may pass restore validation without changing this recovery outcome;
- a source file without a database row remains an excluded orphan; it is never restored, created
  as a row, or deleted. Zero is accepted by default; a nonzero exact #1240 policy match may pass;
- any unapproved/new/mismatched missing or orphan evidence, checksum, identity, count,
  mutation/disappearance, or version mismatch fails closed; and
- incomplete uploads and staging artifacts are excluded only when every item matches the
  normative allowlist and cannot contribute to success.

Manifest acceptance alone never establishes these gates and the validator does not require a
backup-code or manifest-schema change.

### Application and viewer

Application migrations are disabled. The isolated application uses only the recovered CNPG
Service, restored source PVC, fresh tile PVC, validation Redis, and local synthetic credential.
No worker that could process production work is started. There is no ingress or production
route.

Exactly one configured representative synthetic image is rebuilt serially by a one-shot,
validation-only Job based on the versioned backend image and a new validation CLI. The CLI invokes
the existing serial tile-rebuild primitive directly for exactly the selected recovered source
row/file and image ID; it MUST NOT enqueue ARQ work or start/connect to a production worker. The
Job connects only to the validation DB, validation Redis if the primitive strictly requires it,
and the run's source/tile PVCs. Its deterministic output path and operation are idempotent for the
bound run/image, and it emits a bounded machine result identifying success/failure and validated
output checksums/counts before the stage can advance.

The existing synthetic-monitoring image then validates local login with the validation plaintext
credential. Its internal `BASE_URL`, fixed category path, and representative recovered image name
come only from the mounted Flux-owned synthetic-target ConfigMap; its email/password come only from
the credential Secret. None of those values is accepted from recovery metadata. It validates
representative category and image browsing, metadata and dimensions/content evidence, DZI
availability, and one representative tile. The recovered production synthetic row and its
pre-existing source image in the restored recovery set are required; tests do not upload a
replacement, invent a row, run migrations, or weaken the source-selection contract.

## Cleanup and failed-target retention

A validation cannot report success while temporary **child** resources still exist. On the
success path, the controller persists cleanup intent, removes every bound child resource, and then
confirms child absence by name/UID and ownership queries before persisting `SUCCEEDED` and updating
last complete success. It then clears `holderIdentity` by Lease CAS and exits. Its own Job and Pod
are lifecycle evidence, not children; they remain through completion and are excluded from the
success absence gate.

Failed child targets enter `FAILED_RETAIN` for 24 hours by default. The window is configurable but
bounded, as are retained-run count and quota use. The Flux-owned cleanup/reaper path follows the
same ownership and compare-and-set rules, reconciles child expiration after controller restarts,
and records cleanup on the existing failed attempt without ever converting it to success; cleanup
failure remains failed/alerting. Separately, the static terminal-Job reaper
removes only terminal orchestrator Jobs (and their owned Pods) after the configured evidence and
attempt-history window, using exact component labels and terminal status; it cannot remove active
Jobs or child targets. An approved early-cleanup workflow may request the same guarded child
reconciliation; during manual acceptance testing, child removal remains a deliberate, explicit
operator step until automated exact-label and UID guards have been proven.

Cleanup MUST NOT remove:

- the validation namespace, static Secrets, source-profile/source-state-policy/child-template/
  synthetic-target ConfigMaps, `ObjectStore`, state ConfigMap, Lease, CronJobs (including the
  terminal-Job reaper), exporter,
  admission/egress controls, RBAC, quota, limits, or NetworkPolicies;
- the current orchestrator Job/Pod or any nonterminal orchestrator Job;
- any object without both exact ownership labels and its bound name/UID;
- production resources, production PVCs, or objects in another namespace; or
- any recovery archive, the production backup state, or the last known-good recovery set.

Partial cleanup records each remaining object and `CLEANUP_INCOMPLETE`; it never rewrites the
validation as success. Reconciliation retries bounded cleanup safely and continues alerting
until absence is confirmed.

## Telemetry, metrics, and alerts

Ephemeral Jobs SHOULD emit structured logs, events, traces, and OTLP metrics and explicitly
flush before exit. That telemetry is supporting evidence only: delivery cannot be guaranteed
when a Pod fails or is evicted.

A small status exporter Deployment mounts the fixed ConfigMap read-only and exposes Prometheus
metrics derived from durable state. It MUST retain the last valid sample if a projection update
is temporarily malformed and expose its own parse/read health. Bounded labels are limited to
controlled enums such as `stage`, `outcome`, `failure_code`, and `trigger`. Archive names,
recovery-set IDs, run IDs, resource names, LSNs, and free-text errors MUST NOT be metric labels.

The exporter MUST expose exactly this restore-validation metric surface (all are Prometheus
gauges; timestamps/durations/ages are seconds):

| Metric                                                     | Labels (complete allowlist)          | Value                                                                                         |
| ---------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `hriv_restore_validation_last_success_timestamp_seconds`   | none                                 | `last_complete_success`, or `0`                                                               |
| `hriv_restore_validation_last_success_age_seconds`         | none                                 | Exporter time minus last complete success, or `+Inf`                                          |
| `hriv_restore_validation_latest_trigger_timestamp_seconds` | `event` (`started`,`completed`)      | `latest_trigger` timestamp, including rejected overlap, or `0`                                |
| `hriv_restore_validation_latest_trigger_info`              | `trigger`, `outcome`, `failure_code` | Exactly one `latest_trigger` sample with value `1`; rejected/`OVERLAP_ACTIVE` exposes overlap |
| `hriv_restore_validation_latest_run_timestamp_seconds`     | `event` (`started`,`completed`)      | Newest accepted `latest_run` timestamp, or `0`                                                |
| `hriv_restore_validation_latest_run_info`                  | `trigger`, `outcome`                 | Exactly one newest accepted-run sample with value `1`                                         |
| `hriv_restore_validation_latest_run_duration_seconds`      | none                                 | Completed or elapsed duration of `latest_run`                                                 |
| `hriv_restore_validation_active`                           | none                                 | `1` only when `active_run` identifies the current nonterminal Lease holder                    |
| `hriv_restore_validation_stage_info`                       | `stage`, `outcome`                   | Bounded stages from accepted `latest_run`, never `latest_trigger`                             |
| `hriv_restore_validation_heartbeat_timestamp_seconds`      | `stage`                              | Matching `active_run`/`latest_run` holder heartbeat; no active holder yields `0`              |
| `hriv_restore_validation_heartbeat_age_seconds`            | `stage`                              | Exporter time minus that active-holder heartbeat; no active holder yields `+Inf`              |
| `hriv_restore_validation_stage_duration_seconds`           | `stage`, `outcome`                   | Completed/elapsed stage duration from accepted `latest_run`                                   |
| `hriv_restore_validation_failure_info`                     | `stage`, `failure_code`              | `1` for the newest completed accepted-run failure; rejected triggers never contribute         |
| `hriv_restore_validation_cleanup_remaining_resources`      | none                                 | Remaining child count from the newest completed accepted-run summary                          |
| `hriv_restore_validation_cleanup_info`                     | `outcome`, `failure_code`            | Exactly one newest completed accepted-run cleanup sample with value `1`                       |
| `hriv_restore_validation_exporter_parse_success`           | none                                 | `1` only when latest projected state parsed and validated                                     |
| `hriv_restore_validation_state_projection_age_seconds`     | none                                 | Exporter time minus projected state's `updated_at`, or `+Inf`                                 |

Allowed label values come only from versioned enums: `event={started,completed}`;
`trigger={scheduled,on_demand}`;
`outcome={accepted,rejected,pending,running,succeeded,failed,interrupted,retained,not_started,none}`;
`stage` is one of the at most 32 state-machine stages named in this contract; and `failure_code` is
one of the versioned taxonomy codes below plus `none`/`INTERNAL_ERROR`. `latest_trigger_info` uses
only `accepted|rejected` and `none|OVERLAP_ACTIVE`; empty/non-applicable run or cleanup failure uses
`none`. No other labels are permitted; specifically archive/recovery-set/run/trigger IDs,
Job/resource names, LSNs, paths, emails, and free text never appear in labels. The exporter selects
the newest completed accepted-run history summary using the canonical state ordering for failure
and cleanup metrics; active, heartbeat, and stuck inputs come only from the matching
`active_run`/`latest_run`. It never interprets `latest_trigger` as an owning run. The exporter polls the projected file (rather than assuming
an inotify event), retains the last valid state on malformed input, sets parse success to `0`, and
detects a stale/kubelet-stalled projection using projection age even while its own process and
scrape endpoint remain healthy.

Success telemetry advances only after all database, filesystem, consistency, application,
viewer, and resource-cleanup gates succeed. It MUST NOT write production backup state,
production databases, Azure markers, or production PVCs.

Alert rules MUST distinguish:

| Alert condition    | Required signal                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Validation failed  | Newest completed **accepted run** failed, including selection, capacity, restore, validation, interruption, or cleanup failure |
| Trigger rejected   | `latest_trigger` is `rejected`/`OVERLAP_ACTIVE`; informational or separately routed and never a validation failure             |
| Validation overdue | No complete success for more than 14 days                                                                                      |
| Validation stuck   | Matching `active_run` holder heartbeat/stage exceeds its stage or maximum-runtime threshold                                    |
| Cleanup failed     | Applicable accepted-run child resources remain or cleanup outcome is failed/incomplete                                         |
| Metrics missing    | Exporter scrape missing or durable-state read/parse health invalid for the configured window                                   |

A rejected overlap never suppresses active/stuck monitoring and never replaces the accepted-run
failure source. A newer accepted-run failure remains visible even when an older complete success is
fresh. No alert is silenced merely because a Job emitted OTLP or reached `Complete`.

## Failure taxonomy and deterministic handling

| Failure class              | Example codes                                                                                                                                    | Deterministic handling                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Trigger/overlap            | `OVERLAP_ACTIVE`                                                                                                                                 | Update only `latest_trigger` plus rejected history; preserve owning run, success, failure, stuck, and cleanup state |
| Source selection/policy    | `NO_PUBLISHED_SET`, `STATE_MARKER_MISMATCH`, `UNSUPPORTED_FORMAT`, `SOURCE_CHECKSUM_INVALID`, `SOURCE_STATE_UNAPPROVED`, `SOURCE_STATE_DRIFT`    | Provision nothing; manifest acceptance is insufficient; preserve prior success                                      |
| Capacity/preflight         | `CAPACITY_INSUFFICIENT`, `RETAINED_RUN_LIMIT`, `QUOTA_UNAVAILABLE`                                                                               | Proves quota only; provision nothing; preserve prior success                                                        |
| Provisioning/authorization | `PROVISION_FAILED`, `RBAC_DENIED`, `OWNERSHIP_CONFLICT`, `EGRESS_POLICY_UNAVAILABLE`                                                             | Includes physical scheduling/storage provision failure; stop creating children and retain exact evidence            |
| CNPG recovery              | `CNPG_TIMEOUT`, `CNPG_RECOVERY_FAILED`, `TARGET_LSN_MISMATCH`, `DB_PROFILE_MISMATCH`, `WAL_FENCE_UNSUPPORTED`, `TIMELINE_MISMATCH`               | Do not restore files/start app; never fall back to latest timeline                                                  |
| Database/credential        | `DB_INVENTORY_MISMATCH`, `ROLE_INVENTORY_MISMATCH`, `SCHEMA_MISMATCH`, `ROW_INVARIANT_FAILED`, `SYNTHETIC_ROW_INVALID`, `CREDENTIAL_INIT_FAILED` | Fail closed; never invent a row; only the controlled one-row hash mutation is allowed after fidelity                |
| Filesystem restore         | `ARCHIVE_READ_FAILED`, `FILESYSTEM_TIMEOUT`, `PATH_INVALID`, `FILE_CHECKSUM_MISMATCH`                                                            | Stop before app; preserve bounded diagnostic target                                                                 |
| DB/file consistency        | `SOURCE_STATE_UNAPPROVED`, `SOURCE_STATE_DRIFT`, `COUNT_MISMATCH`, `FILE_MUTATED`, `EXCLUDED_ARTIFACT_UNAPPROVED`                                | Preserve missing rows/orphans; exact reviewed exception only; no row/file changes                                   |
| Application/tile/viewer    | `APP_START_FAILED`, `TILE_REBUILD_FAILED`, `AUTH_FAILED`, `BROWSE_FAILED`, `DZI_INVALID`, `VIEWER_TILE_INVALID`                                  | Stop validation; retain isolated resources until expiry                                                             |
| State/timeout/interruption | `STATE_SIZE_EXCEEDED`, `STAGE_TIMEOUT`, `MAX_RUNTIME_EXCEEDED`, `INTERRUPTED`, `INTERRUPTED_STALE_HOLDER`                                        | Reject untrackable state; close through CAS; resume only idempotent work                                            |
| Cleanup/reaping            | `CLEANUP_INCOMPLETE`, `CLEANUP_AUTHORIZATION_FAILED`, `REAPER_FAILED`                                                                            | Child leaks block success; terminal-Job reaper failure alerts without claiming the active Job should be absent      |

Failure codes form a versioned bounded enum. `OVERLAP_ACTIVE` is a trigger-rejection code only and
MUST NOT become an accepted-run failure. Unknown internal exceptions map to `INTERNAL_ERROR`, with
detail in structured evidence rather than metric labels or state fields.

## Threat model

| Threat                                                | Control and required evidence                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Compromised backup container gains cluster control    | Backup Deployment has no API token/client/RBAC; orchestration is a separate component and namespace                             |
| Orchestrator changes production                       | Namespace Role only, no production credentials/mounts, network deny, explicit negative authorization and connectivity tests     |
| Child workload abuses Kubernetes API                  | No-permission service account, token automount disabled, no Kubernetes client requirement                                       |
| Pod-create permission mounts arbitrary Secrets        | Flux-controlled fixed templates, digest-pinned allowlisted images, admission enforcement, and negative mount tests              |
| Recovery metadata injects workload/target behavior    | Metadata cannot control templates, images, commands, volumes, Secrets, service accounts, synthetic `BASE_URL`/path/image        |
| Synthetic Secret selects or installs wrong credential | Email must match the sole recovered synthetic row; `$2b$12$` bcrypt shape and backend `checkpw` prove validation plaintext/hash |
| Validation corrupts recovery sources                  | Read-only SAS and Barman credentials; no Azure write credential; no write to backup markers or retention                        |
| Wrong, drifting, or incomplete set is accepted        | Fully published selection plus exact source-state policy and exclusions allowlist; acceptance alone is insufficient             |
| Wrong database profile/timeline is restored           | Versioned static profile; manifest cross-check; first-eight-hex timeline binding; explicit targetLSN/targetTimeline             |
| Resource spoofing causes unintended cleanup           | Exact managed-by/run labels plus bound name and UID; child/evidence separation; static/production exclusions                    |
| Unbounded failed runs exhaust cluster                 | Explicit quota bounds, 24-hour default expiry, retained-count bound, child reaper; physical failure stays `PROVISION_FAILED`    |
| Network misconfiguration reaches production/internet  | Default deny, approved Azure FQDN/proxy enforcement, concrete DNS/API/operator/scrape selectors, negative connectivity tests    |
| High-cardinality telemetry/state overloads            | Exact metric allowlist; IDs/names/LSNs/free text excluded; 512 KiB and count bounds fail closed                                 |
| Restart repeats or skips unsafe work                  | CAS state sequence, immutable binding, deterministic names, machine-readable child outcomes, idempotent reconciliation          |
| Concurrent overlap erases owning-run state            | Separate trigger/run pointers, identity-keyed history union, field-aware CAS merge, holder-only stages/resources/heartbeat      |
| GitOps reconciliation resets state or an active lock  | Helm always omits runtime fields; three-way merge preserves controller additions; keep/prune policy and active/completed tests  |
| CronJob GC deletes lifecycle evidence early           | No finished-Job TTL; history threshold exceeds Job quota/window; terminal-Job reaper is the sole deletion path                  |
| Job lifecycle is mistaken for child leakage           | Child absence gates success; own Job/Pod remain evidence until exit and static terminal-Job reaping                             |
| Secret leaks through evidence                         | Secrets and password hashes excluded from state, metadata, args, logs, events, and metrics; scans and redaction tests           |

## Test matrix for #1229

| #1229 requirement               | Test level and evidence                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same scheduled/on-demand path   | Helm tests compare image, entrypoint, policy, Lease/state references, security, resources, `restartPolicy: Never`, `backoffLimit: 0`, absent TTL, non-triggering history limits, and suspended on-demand template; acceptance runs both paths                                                                                                      |
| Latest set/source-state binding | Fake-Azure tests cover publication/coherence/checksums plus zero-drift default, exact reviewed #1240 IDs/paths/counts/digest, new/mismatched drift, manifest accepted-but-unapproved, and exclusions allowlist                                                                                                                                     |
| Source profile/timeline         | ConfigMap schema tests bind profile ID/version, `app`/`app`/server/`ObjectStore`; reject manifest-profile conflict and malformed/missing/inconsistent fence; derive `00000007` as 7 and render explicit targetLSN/targetTimeline                                                                                                                   |
| Static templates and targets    | Mount versioned child templates/image digests and synthetic `BASE_URL`/category path/image name read-only; mutate recovery metadata with workload/target values and prove it cannot alter rendered children or journey targets                                                                                                                     |
| Fresh CNPG and PVC targets      | Fake-Kubernetes reconciliation and Helm tests prove deterministic run-labelled resources; physical binding/scheduling failures map to `PROVISION_FAILED`; acceptance observes new UIDs every run                                                                                                                                                   |
| No production writes/isolation  | RBAC tests allow named source-profile/policy gets and exact run-kind verbs, deny Secret/arbitrary ConfigMap gets, inspect no-token children, reject arbitrary Secret mounts/template/image/target injection, and test exact network paths                                                                                                          |
| CNPG/database fidelity          | Production-shaped recovery verifies bound profile, exact LSN/timeline, all DBs, system identity, roles, schema, counts, fence, exact one synthetic row, and no `db.sql`                                                                                                                                                                            |
| Synthetic credential mutation   | Require recovered row fidelity/email match; reject zero/multiple rows and non-`$2b$12$`/invalid/mismatched hashes; assert one hash-only update, no migration/production connection, and Secret-vs-target-ConfigMap field isolation                                                                                                                 |
| Filesystem and consistency      | Failure injection covers partial reads, interruption, path/checksum/count/version errors, allowed/unapproved missing/orphan policy, excluded-artifact allowlist, and mutation/disappearance                                                                                                                                                        |
| Application, tile, and viewer   | Acceptance proves migrations/OIDC/workers/ARQ disabled, one-shot idempotent CLI invokes existing serial primitive for one recovered image on validation-only targets, emits machine output, then login/browse/DZI/tile succeeds                                                                                                                    |
| Overlap and interruption        | CAS races assert overlap changes only `latest_trigger`/rejected history; holder stages/resources/heartbeat and success survive; holder completion unions rather than erases overlap; accepted acquisition installs `active_run`/`latest_run`; post-Lease initial-state recovery is same-UID only; terminal ordering conditionally clears only self |
| Quota and retention             | Tests cover explicit `requests.storage` and PVC/object quota counts, declared sizing/headroom, quota unavailable, physical-capacity non-claims, expiry, and bounded reaping without Longhorn access                                                                                                                                                |
| Durable state and telemetry     | Schema/property tests cover separate nullable `active_run`, full `latest_run`, every-trigger `latest_trigger`, mixed identity-keyed history ordering/trim, 512 KiB/count bounds, exact trigger-vs-run metrics without IDs, and prior Helm omission/upgrade guarantees                                                                              |
| Cleanup gates success           | Cover every concrete child kind and changed UID/labels; own Job/Pod remain until exit; no TTL/history GC can preempt evidence; terminal reaper waits the window and cannot remove active/static/foreign objects                                                                                                                                    |
| Alert behavior                  | Rule tests prove validation-failed follows newest completed accepted run, trigger-rejected exposes overlap separately, active/stuck survives concurrent rejection, plus overdue, cleanup, metrics-missing, and clean recovery                                                                                                                      |
| Production rollout              | Run latest first, inspect evidence and guarded cleanup, then run stable with the same production-shaped criteria; keep target removal explicitly manual until ownership guards pass acceptance                                                                                                                                                     |

Unit tests use fake Kubernetes and fake Azure clients without live credentials. Helm tests include
lint, render/schema validation, omitted ConfigMap/Lease runtime fields, keep/prune policy,
quota/limits, concrete RBAC, token automount, child-template/target mounts and image digests, security
contexts, NetworkPolicies, both orchestration CronJobs, both reaper CronJobs, and exporter resources. Failure injection covers every stage,
API conflict, process interruption, deadline, malformed child output, unavailable telemetry, and
cleanup partial failure.

Production-shaped acceptance starts in `latest`, then proceeds to `stable` only after latest
passes. It records source profile/policy binding, exact LSN/timeline, restored inventories, application/viewer evidence,
negative isolation checks, separated active/run/trigger state under a live overlap race, exact
metrics/alerts, and confirmed cleanup. Acceptance
MUST use approved non-production validation targets and must not weaken production controls.

## Delivery phases and unresolved prerequisites

The child issues define implementation boundaries; later phases MUST preserve this contract:

| Phase                         | Issue                                                 | Boundary                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-only restore primitive   | [#1250](https://github.com/bcit-tlu/hriv/issues/1250) | Container-scoped read-only SAS selection and stateless source-filesystem restore with machine-readable output, preserved missing/orphan semantics, and no backup-state writes                                                                                                               |
| Core orchestration            | [#1251](https://github.com/bcit-tlu/hriv/issues/1251) | Controller/chart; runtime-only CAS state/Lease fields omitted by Helm; separate active/latest-run/latest-trigger state and overlap-safe history merge; terminal-holder acquisition; concrete RBAC/run kinds; child/evidence ownership; fixed templates/digests; exact LSN/timeline recovery |
| Application/viewer validation | [#1252](https://github.com/bcit-tlu/hriv/issues/1252) | Recovered synthetic email/row fidelity then `$2b$12$`-compatible one-row credential-init; Flux target config; isolated app/Redis; one-shot serial tile CLI; login/browse/DZI/tile; no ARQ/production routes                                                                                 |
| Operations and rollout        | [#1253](https://github.com/bcit-tlu/hriv/issues/1253) | UTC schedule/on-demand/reapers with Never/zero retry, no TTL and non-triggering history GC; exact metrics/alerts; cleanup/evidence retention; approved egress/policies; quota; Flux/Vault wiring; rollout/runbook                                                                           |

Unresolved deployment blockers include the exact flux-fleet resource paths/ownership and
versioned #241 source profile; an operator-reviewed #1240 source-state policy or repaired zero
state; Vault policies/VSO destinations for read-only Azure and the email plus matching validation
`$2b$12$` credential fields; CNPG-I Barman Cloud plugin read-credential/`ObjectStore` wiring;
approved and tested Azure FQDN/proxy or service-tag egress enforcement; concrete
API/DNS/Prometheus/CNPG policy selectors; versioned child-template/image allowlist and synthetic
target values; admission control for fixed child templates; quota and non-triggering CronJob
history-limit values; stage/max-runtime/evidence windows; representative synthetic invariants; and
Prometheus/alert routing. In particular, no deployment
may substitute broad TCP 443 egress or claim physical capacity from namespace quota. These are
configuration work for #1250–#1253; they do not reopen the baseline choices of read-only SAS,
dedicated component/namespace, `app`/`app`, exact LSN and fence-derived timeline, local synthetic
auth, or one serial tile rebuild.

Until every phase is deployed and a full clean run updates durable last-success state,
`HRIVRestoreTestFailed` remains valid and actionable.
