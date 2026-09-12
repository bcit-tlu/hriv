# Isolated restore-validation contract

## Status and purpose

This document is the normative design contract for issue
[#1249](https://github.com/bcit-tlu/hriv/issues/1249), a design slice of
[#1229](https://github.com/bcit-tlu/hriv/issues/1229). It defines how a future
`hriv-restore-validation` component must prove that a published HRIV recovery set can restore
without touching production. The recovery-set publication and consistency rules remain
normative in [the recovery-set contract](recovery-set-contract.md).

The original sections retain the level-5 design and threat analysis for reference, but they are no
longer the deployment contract. The current proportionate scope is the
[weekly core recovery contract](#simplified-1253-operational-contract-supersedes-prior-level-5-sections)
at the end of this document. That section explicitly supersedes requirements for #1252,
application/viewer infrastructure, custom exporters, autonomous reapers, and multiple retained
runs. The #1250 read-only primitives and #1251 core recovery safety guarantees remain applicable.

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
  and WAL-fence timeline. The manifest's `database_name` is the inventoried HRIV application
  connection database (`hriv`), not the CNPG bootstrap database/owner or source-profile authority.
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
  synthetic row plus a validation-only plaintext password and matching hash generated by the
  digest-pinned backend image's password helper;
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

Issue #1251 supplies only the core chart/controller subset of this end-state list. Its chart renders
the default-deny NetworkPolicy but no generic configurable allow-egress policy, and it MUST reject
`invocation.enabled=true` even with reviewed images/profile and `objectStore.enabled=true`. Issue
#1253 owns the fixed, environment-reviewed Azure, Kubernetes API, DNS, and CNPG egress resources,
admission enforcement, schedules/reapers/exporter, Flux/Vault wiring, and rollout. Until those
resources are reviewed together, the #1251 chart is intentionally non-runnable; neither a Flux
manifest nor an arbitrary CIDR escape belongs to #1251.

The orchestrator MUST NOT remove or reconfigure those static resources. The only runtime-field
exceptions are compare-and-set updates to `data.state.json` in the fixed state ConfigMap and the
coordination fields of the fixed Lease; neither object may be deleted. The orchestrator mounts the
child-template and synthetic-target ConfigMaps read-only and accepts no Pod/workload specification,
image, command, volume, Secret name, `BASE_URL`, category path, or image name from recovery
metadata. A version suffix such as `-v1` identifies the immutable ConfigMap payload, not a mutable
alias. Any reviewed payload change MUST allocate a new versioned name and atomically update every
fixed mount/reference; Helm MUST NOT attempt to update data under an existing immutable name.
#1253 owns that GitOps version rollout and rollback sequencing.

A run record separately tracks (a) the orchestrator Job and its Pod as retained lifecycle evidence
and (b) every bound **child** Job/Pod, Deployment, Service, result ConfigMap, PVC, and CNPG Cluster
it creates from those fixed templates. The orchestrator Job/Pod are never children and are
excluded from the success-path cleanup absence gate. The static reaper, not the running orchestrator, removes a
terminal orchestrator Job and its Pod only after the configured evidence/history window.

Every directly controller-created child carries a deterministic template-identity annotation: SHA-256 over canonical fixed `apiVersion`, `kind`, name, required managed/run/role labels, and desired `spec`, excluding changing timestamps and server fields. This closes the crash gap between Kubernetes create and the state CAS. On create conflict, the gateway may recover only the exact deterministic name after reading it and matching API identity, all required labels, the template digest, and a safe server UID; it never compares API-defaulted mutable spec. Missing or drifted identity is `OWNERSHIP_CONFLICT`. The resumed controller persists the exact returned UID before observing or mutating the child.

At `PREFLIGHT`, capacity reserves the full success-path bound of ten core children: four Jobs, their four Pods, one source PVC, and one CNPG Cluster, accounting for the already-recorded selection Job/Pod. Unexpected ordinary stage exceptions map only to `INTERNAL_ERROR`; the controller atomically retains its exact current child references when state remains writable, then follows terminal Lease/active release. Exception messages, URLs, and credentials are never persisted or emitted. If that retention state CAS cannot be written, the exception is re-raised so stale-holder takeover remains possible.

## Least privilege

Only namespace-scoped Roles are allowed. A `ClusterRole`, cluster-scoped binding, wildcard API
group, wildcard resource, wildcard verb, impersonation, token creation, Secret read, and
production namespace access are forbidden. These Roles can neither get nor write any resource in
the production `hriv` or `postgres` namespace.

| Principal                           | Allowed surface                                                                                                                                                                                                                                                                                                                                                                            | Forbidden surface                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestrator service account        | In its namespace: `get` the named source-profile/source-state-policy ConfigMaps; `get/update/patch` the named state ConfigMap and Lease by CAS; patch its named Job/Pod; create/get/list/watch/patch/delete labelled child Jobs/Pods, Deployments, result ConfigMaps, PVCs, and CNPG Clusters; get/list/delete CNPG-generated Services; observe Events and status for only those run kinds | Secret API reads; arbitrary ConfigMaps; nodes; namespaces; RBAC mutation; service-account tokens; Longhorn APIs; any object in `hriv` or `postgres`; cluster-scoped objects |
| No-permission child service account | No Kubernetes API permissions; fixed-template Secret, ConfigMap, and PVC references may be mounted by kubelet                                                                                                                                                                                                                                                                              | Kubernetes API token or client; resource discovery; production mounts or credentials                                                                                        |
| CNPG operator                       | Existing operator permissions needed to reconcile the validation-namespace Cluster and its PVCs                                                                                                                                                                                                                                                                                            | Validation does not grant or widen operator access; no production Cluster mutation is requested                                                                             |
| Failed-child reaper service account | `get/list/delete` only expired, state-bound child Jobs/Pods, Deployments, Services, result ConfigMaps, PVCs, and CNPG Clusters by exact name/UID plus `get/update/patch` on the named state ConfigMap using CAS                                                                                                                                                                            | Creating workloads; Secrets; current orchestrator Job/Pod deletion; static, unbound, foreign, nonexpired, or cross-namespace resources                                      |
| Terminal-Job reaper service account | List/get/delete terminal orchestrator or reaper Jobs/owned Pods only after each class's configured evidence window using fixed component labels; never its current Job                                                                                                                                                                                                                     | State mutation; child/static/foreign resources; nonterminal Jobs; cross-namespace resources                                                                                 |
| Status exporter service account     | No API verbs; read-only mounted projection of the fixed state ConfigMap                                                                                                                                                                                                                                                                                                                    | API token, Secret mounts, state writes, or run-resource operations                                                                                                          |
| Human operator                      | Existing audited GitOps and approved on-demand Job-creation path                                                                                                                                                                                                                                                                                                                           | Direct use of validation credentials against production or bypass of the shared entrypoint                                                                                  |

The final Roles MUST enumerate concrete API groups, resources, verbs, and, where Kubernetes
supports it, static `resourceNames` for the state ConfigMap, Lease, and named source-profile/
source-state-policy ConfigMap `get` rules. Helm tests and an
acceptance check with `kubectl auth can-i` MUST prove denied access to Secrets, cluster-scoped
resources, and the production namespaces. The test must not depend only on reviewing rendered
YAML.

Kubernetes RBAC cannot constrain dynamic create/list/delete verbs by object label, and
`resourceNames` cannot safely enumerate run-scoped names before creation (including CNPG-generated
Service names). The Role's concrete `get/list/delete` Service permissions and permissions for other
dynamic child kinds are therefore namespace-wide even though the controller contract is
label/UID-bound. Runtime code MUST require the bound run label and recorded UID before observation
or deletion. The #1253 validating admission policy MUST enforce allowed create/update/delete
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

| Input                          | Capability                                                                                                                  | Consumer                                                                           | Constraint                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure source SAS               | List/read only within the configured backup container and prefix                                                            | Selection and filesystem-restore child                                             | No create, update, or remove capability; expiry must cover maximum run time                                                                                |
| Barman object-store credential | Read the existing CNPG recovery source                                                                                      | CNPG operator/recovery Pods                                                        | Referenced by validation-only `ObjectStore`; no archive write destination                                                                                  |
| Synthetic credential           | Recovered production synthetic-row email plus validation-only plaintext password and matching backend-helper-generated hash | Credential-init receives all fields; synthetic child receives only email/plaintext | Email selects the row; password/hash are never production/OIDC credentials; hash is bound to the digest-pinned backend version; app child receives neither |
| Restored database app identity | Connect to the fresh CNPG Cluster                                                                                           | `psql` and isolated application children                                           | Validation-local Secret generated/reconciled for the restored Cluster; never inferred as proof of source fidelity                                          |

The #1251 fixed child template MUST set `VALIDATION_MIN_SAS_VALIDITY_SECONDS` only when the
six-hour (`21600`) primitive default does not cover its reviewed maximum source-restore duration.
The override MUST be finite, positive, no greater than 86400 seconds, fixed independently of
recovery metadata, and paired with a SAS whose remaining lifetime at child startup meets the
configured minimum measured from the later of child startup and an optional SAS start. A
syntactically valid but shorter-lived SAS fails closed with `READ_SAS_EXPIRING`; a start up to five
minutes in the future remains allowed for clock skew, but does not count toward usable lifetime.
The primitive stores this setting as raw configuration and parses it only after machine logging is
isolated; malformed, nonfinite, nonpositive, or greater-than-86400 values produce exactly one
bounded `VALIDATION_CONFIG_INVALID` stdout document for every machine command. Unrelated backup and
operator commands do not parse or reject this validation-only setting.

The container read SAS allowlist requires `sv`, `se`, `sr`, `sp`, and `sig`; it permits only `st`,
`spr`, `sip`, `skoid`, `sktid`, `skt`, `ske`, `sks`, `skv`, `saoid`, `suoid`, `scid`, and `ses` in
addition. Unknown keys, account-SAS `ss`/`srt`, response overrides, stored-policy identifiers, blank
or oversized values, and a `spr` value other than exactly `https` fail
`READ_SAS_FIELDS_INVALID`. Failure output never includes a query field or value.

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
- `database_recovery.target_lsn` and a 24-hex-character `wal_fence_file` are present and
  syntactically valid.

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
NOT request `latest`. `target_time` remains audit evidence only.

For the deployed CNPG v1 CRD, `WAIT_CNPG` requires all of `Ready=True`,
`status.phase: Cluster in healthy state`, and `readyInstances == instances == 1`; the Ready
condition alone is not sufficient. The subsequent read-only database child remains the final proof
that recovery completed on the bound timeline and reached the exact target LSN. Selection also
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

The validation hash MUST be generated by calling `app.auth.hash_password` from the exact
digest-pinned backend image/version under test with the Secret's plaintext password. Before
mutation, credential-init runs that same version's `app.auth.verify_password` (the backend's
`bcrypt.checkpw` wrapper) and proves the supplied plaintext matches the supplied hash. The backend
helper—not this restore contract—owns hash algorithm, encoding, prefix, length, work factor, and
future upgrades. If that helper changes, operators MUST regenerate the Vault hash with the new
pinned image and update the version binding before validation may run. Current backend defaults may
be recorded as implementation evidence but are not normative here. Any generation/version binding
or plaintext/hash verification mismatch fails `CREDENTIAL_INIT_FAILED` without updating the row.
Neither plaintext nor hash may be logged, emitted as an event/metric, or persisted in result/state
evidence.

Only then may a one-shot, no-token, validation-only credential-init Job mount the Vault-provided
email, plaintext password, and precomputed password hash and update only that exact row's
`password_hash` in the isolated database. It performs no migration, identity/role/metadata update,
or production connection. The before-row identity,
non-password fidelity result, digest-pinned helper image/version, affected-row count of exactly one,
and controlled post-fidelity mutation outcome are recorded as bounded evidence without
credential/hash values. The application
never receives production credentials, and the synthetic child receives only the validation
email/plaintext password—not the hash and never a reused production credential.

### Filesystem and consistency

The restore child uses the stateless, read-only source-filesystem path from #1250 and writes only
to the supplied fresh target. It verifies exact recovery-set identity, safe member paths,
archive and manifest versions, all selected file sizes/checksums, and final counts. Before
extraction it opens the verified parent and target with directory file descriptors and no-follow
semantics where available, changes cwd to the pinned target inode, and performs temporary staging
and final relative promotion there. It restores cwd before checking that the original absolute
path still names the same directory device/inode. The pinned target must remain empty before work,
contain only the current temporary workspace before promotion, only that workspace plus promoted
`source_images` immediately afterward, and exactly `source_images` before success. Any concurrent
unrelated entry fails closed. A missing, renamed, replaced, or symlinked target fails
`TARGET_CHANGED`; writes and cleanup never follow the replacement path.

`fchdir` changes cwd process-wide. Therefore #1251 MUST run this stateless primitive only in an
isolated, single-command, single-thread restore child. It MUST NOT colocate or combine the primitive
with a scheduler, backup publication, operator command, or another concurrent restore in one
process. It cannot update production or validation backup publication state.

Consistency preserves the recovery-set outcomes and then applies the bound source-state policy:

- a database row with a missing source file remains skipped and preserved; no row is removed and
  no file or tile is synthesized for it. Zero is accepted by default; a nonzero exact #1240 policy
  match may pass restore validation without changing this recovery outcome;
- a source file without a database row remains an excluded orphan; it is never restored, created
  as a row, or deleted. Zero is accepted by default; a nonzero exact #1240 policy match may pass;
- the consistency child receives the selected run evidence, not static full policy lists. It
  recomputes canonical missing rows from recovered `row_id`/`status`/path identities versus restored
  files and reports every restored file absent from the DB as an unexpected orphan. It emits the
  full lowercase `source_files_sha256` and a canonical missing-list digest;
- `missing_source` is emitted only when absence is independently derivable. For selected
  `unsafe_or_out_of_root` or `duplicate_source_reference`, exact reasons are preserved only after
  exact row/status/canonical-path identity match; the validator never invents those reasons;
- the controller requires recomputed missing evidence to equal selected missing evidence and zero
  unexpected restored orphans. The selected orphan list remains immutable publication evidence
  that source restore excluded those files; and
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

Failed child targets enter `FAILED_RETAIN` for 24 hours by default. Before Lease release, the holder
atomically transfers the exact cleanup inventory into its `retained_runs[run_id]` record. The window
is configurable but bounded, retained count is at most 2, and preflight reserves quota/one retained
slot for the active run.

The Flux-owned failed-child reaper operates only from full `retained_runs` records, never
`attempt_history`, labels alone, or the possibly replaced `latest_run`. For each expired or approved
entry it verifies every API version/kind/name/UID and ownership label, deletes only exact matches,
and CAS-updates that entry's cleanup status and remaining count. It removes the retained entry only
after every listed child is confirmed absent; UID/label mismatch remains failed and alerting. A
record that duplicates terminal `latest_run` is merged by run ID and cleaned once; the same CAS may
mirror only cleanup outcome/count into matching `latest_run` evidence, without changing its failure
outcome or using it as ownership. Separately, the static terminal-Job reaper removes only
terminal orchestrator Jobs (and their owned Pods) after the configured evidence and attempt-history
window, using exact component labels and terminal status; it cannot remove active Jobs or child
targets. An approved early-cleanup workflow may request the same guarded child
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

Partial cleanup preserves each remaining exact object in its `retained_runs` record and writes
`CLEANUP_INCOMPLETE`; it never rewrites validation as success. Reconciliation retries bounded
cleanup safely and continues alerting until absence is confirmed and the retained entry is removed.

## Telemetry, metrics, and alerts

Ephemeral Jobs SHOULD emit structured logs, events, traces, and OTLP metrics and explicitly
flush before exit. That telemetry is supporting evidence only: delivery cannot be guaranteed
when a Pod fails or is evicted.

A small status exporter Deployment mounts the fixed ConfigMap read-only and polls `state.json` on a
configured `exporter_poll_interval_seconds` (default 30, bounded from 10 through 60). Each poll performs a
fresh open, complete read, JSON parse, and schema validation even when the projected file is
unchanged. After success, the exporter records its own current process time as the last successful
read; this local health timestamp is not written to durable state. On open, read, parse, or schema
failure, read/parse success becomes `0`, the local successful-read timestamp does not advance, and
the exporter retains all last valid business-state metrics. After any valid unchanged read,
read/parse success is `1` and read age returns near zero.

Bounded labels are limited to controlled enums such as `stage`, `outcome`, `failure_code`, and
`trigger`. Archive names, recovery-set IDs, run IDs, resource names, LSNs, and free-text errors MUST
NOT be metric labels.

The exporter MUST expose exactly this restore-validation metric surface (all are Prometheus
gauges; timestamps/durations/ages are seconds):

| Metric                                                                    | Labels (complete allowlist)          | Value                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `hriv_restore_validation_last_success_timestamp_seconds`                  | none                                 | `last_complete_success`, or `0`                                                                              |
| `hriv_restore_validation_last_success_age_seconds`                        | none                                 | Exporter time minus last complete success, or `+Inf`                                                         |
| `hriv_restore_validation_latest_trigger_timestamp_seconds`                | `event` (`started`,`completed`)      | `latest_trigger` timestamp, including rejected overlap, or `0`                                               |
| `hriv_restore_validation_latest_trigger_info`                             | `trigger`, `outcome`, `failure_code` | Exactly one `latest_trigger` sample with value `1`; bounded rejection code exposes overlap/admission outcome |
| `hriv_restore_validation_latest_run_timestamp_seconds`                    | `event` (`started`,`completed`)      | Newest accepted `latest_run` timestamp, or `0`                                                               |
| `hriv_restore_validation_latest_run_info`                                 | `trigger`, `outcome`                 | Exactly one sample using the strict `latest_run.state` outcome projection                                    |
| `hriv_restore_validation_latest_run_duration_seconds`                     | none                                 | Completed or elapsed duration of `latest_run`                                                                |
| `hriv_restore_validation_active`                                          | none                                 | `1` only for a nonterminal owning `active_run`; terminal pointer-clearing interval is `0`                    |
| `hriv_restore_validation_stage_info`                                      | `stage`, `outcome`                   | Historical per-stage records from `latest_run.stages`, never current trigger/run outcome                     |
| `hriv_restore_validation_heartbeat_timestamp_seconds`                     | `stage`                              | Owning `active_run` heartbeat labelled by its exact non-null `current_stage`; otherwise no sample            |
| `hriv_restore_validation_heartbeat_age_seconds`                           | `stage`                              | Exporter time minus that owning heartbeat, with the same `current_stage` label; otherwise no sample          |
| `hriv_restore_validation_stage_duration_seconds`                          | `stage`, `outcome`                   | Completed/elapsed historical stage duration from `latest_run.stages`                                         |
| `hriv_restore_validation_failure_info`                                    | `stage`, `failure_code`              | `1` only when newest completed accepted run is `FAILED_RETAIN`, using `failure_stage`; no trigger failures   |
| `hriv_restore_validation_cleanup_remaining_resources`                     | none                                 | Remaining child count from accepted `latest_run` cleanup or identity-matched retained record                 |
| `hriv_restore_validation_cleanup_info`                                    | `outcome`, `failure_code`            | Exactly one sample from that accepted-run/latest-retained cleanup record                                     |
| `hriv_restore_validation_retained_run_count`                              | none                                 | Exact number of `retained_runs` entries, from 0 through 2                                                    |
| `hriv_restore_validation_retained_expired_run_count`                      | none                                 | Number of retained entries past `expires_at`, from 0 through 2                                               |
| `hriv_restore_validation_retained_remaining_resources`                    | none                                 | Aggregate `remaining_resource_count` across deduplicated `retained_runs`                                     |
| `hriv_restore_validation_retained_cleanup_runs`                           | `outcome`, `failure_code`            | Count of retained entries for each bounded cleanup outcome/code                                              |
| `hriv_restore_validation_exporter_parse_success`                          | none                                 | `1` iff the latest poll opened/read/parsed/schema-validated; `0` on any such failure                         |
| `hriv_restore_validation_exporter_last_successful_read_timestamp_seconds` | none                                 | Exporter-local process time after each successful read/parse, including unchanged valid state; initially `0` |
| `hriv_restore_validation_exporter_last_successful_read_age_seconds`       | none                                 | Current exporter time minus local last-successful-read time, or `+Inf` before the first success              |
| `hriv_restore_validation_state_update_age_seconds`                        | none                                 | Current exporter time minus durable business `state.updated_at`, or `+Inf` when no valid state exists        |

Metric label domains are exact and disjoint by metric:

- both info metrics use `trigger={scheduled,on_demand}` and timestamp metrics use
  `event={started,completed}`;
- `latest_trigger_info.outcome={accepted,rejected}` only. Accepted uses `failure_code=none`;
  rejected uses exactly one of
  `failure_code={OVERLAP_ACTIVE,RETAINED_RUN_LIMIT,CAPACITY_INSUFFICIENT,QUOTA_UNAVAILABLE,LEASE_STATE_INITIALIZATION_LOST}`;
- `latest_run_info.outcome={running,succeeded,retained}` only, strictly projected from
  nonterminal/`SUCCEEDED`/`FAILED_RETAIN`; it never emits `accepted`, `rejected`, `pending`, `failed`,
  or `interrupted`;
- `stage_info` and `stage_duration` use an enumerated contract `stage` and
  `outcome={running,succeeded,failed}` only;
- `cleanup_info` and `retained_cleanup_runs` use
  `outcome={not_started,running,succeeded,retained,failed}` and `failure_code` equal to `none` or a
  cleanup taxonomy code; and
- `failure_info.failure_code` is an accepted-run failure taxonomy code or `INTERNAL_ERROR`, never a
  trigger-only rejection code.

No other label values or labels are permitted. Archive/recovery-set/run/trigger IDs, Job/resource
names, LSNs, paths, emails, and free text never appear in labels. The exporter selects
the newest completed accepted-run summary using canonical accepted-run ordering for failure
metrics. Cleanup comes from the accepted `latest_run` or its identity-matched `retained_runs`
record after transfer; retained count/expired/remaining/cleanup-outcome metrics come only from
deduplicated retained records. Active, heartbeat, and stuck inputs use matching owning
`active_run`/`latest_run` and exact `active_run.current_stage`; stage metrics use only
`latest_run.stages` history. The exporter never interprets `latest_trigger` as an owning run or emits
trigger rejection under accepted-run metric enums.

Exporter availability is based only on scrape presence, latest read/parse success, and exporter-local
successful-read age. `exporter_read_alert_after_intervals` defaults to 3, is bounded from 3 through
5, and alerts only when read age is strictly greater than that many polling intervals. Durable
`state_update_age_seconds` is business-state age only: it may grow indefinitely during an idle,
unchanged but valid terminal state and MUST NOT trigger metrics-missing or exporter-read-health alerts.
It may be used for stuck diagnosis only in conjunction with owning `active_run`, its heartbeat and
`current_stage`, and that stage's deadline.

Success telemetry advances only after all database, filesystem, consistency, application,
viewer, and resource-cleanup gates succeed. It MUST NOT write production backup state,
production databases, Azure markers, or production PVCs.

Alert rules MUST distinguish:

| Alert condition    | Required signal                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation failed  | Newest completed accepted run has `state=FAILED_RETAIN,outcome=retained` and a failure code; no ambiguous failed/interrupted outcome                                          |
| Trigger rejected   | `latest_trigger` is `rejected` with a bounded trigger code; overlap remains separately visible as `OVERLAP_ACTIVE`                                                            |
| Validation overdue | No complete success for more than 14 days                                                                                                                                     |
| Validation stuck   | Nonterminal owning `active_run` heartbeat or exact `current_stage` exceeds its deadline                                                                                       |
| Cleanup failed     | Retained expired-count is nonzero, retained cleanup outcome is failed, or aggregate children remain after cleanup completion                                                  |
| Metrics missing    | Scrape is absent for its window, or read/parse success remains `0` while local successful-read age exceeds the configured interval threshold; never business-state update age |

A rejected overlap never suppresses active/stuck monitoring and never replaces the accepted-run
failure source. A newer accepted-run failure remains visible even when an older complete success is
fresh. No alert is silenced merely because a Job emitted OTLP or reached `Complete`.

## Failure taxonomy and deterministic handling

| Failure class              | Example codes                                                                                                                                                                | Deterministic handling                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger/Lease admission    | `OVERLAP_ACTIVE`, `RETAINED_RUN_LIMIT`, `CAPACITY_INSUFFICIENT`, `QUOTA_UNAVAILABLE`, `LEASE_STATE_INITIALIZATION_LOST`                                                      | Reject without accepted `latest_run`; orphan initialization needs expiry+grace, absent/terminal UID, zero children, Lease CAS, and trigger/history-only state merge |
| Source selection/policy    | `NO_PUBLISHED_SET`, `STATE_MARKER_MISMATCH`, `UNSUPPORTED_FORMAT`, `SOURCE_CHECKSUM_INVALID`, `SOURCE_STATE_DIGEST_INVALID`, `SOURCE_STATE_UNAPPROVED`, `SOURCE_STATE_DRIFT` | Provision nothing; manifest acceptance is insufficient; preserve prior success                                                                                      |
| Capacity/preflight         | `CAPACITY_INSUFFICIENT`, `RETAINED_RUN_LIMIT`, `QUOTA_UNAVAILABLE`                                                                                                           | Proves quota only; provision nothing; preserve prior success                                                                                                        |
| Provisioning/authorization | `PROVISION_FAILED`, `RBAC_DENIED`, `OWNERSHIP_CONFLICT`, `EGRESS_POLICY_UNAVAILABLE`                                                                                         | Includes physical scheduling/storage provision failure; stop creating children and retain exact evidence                                                            |
| CNPG recovery              | `CNPG_TIMEOUT`, `CNPG_RECOVERY_FAILED`, `TARGET_LSN_MISMATCH`, `DB_PROFILE_MISMATCH`, `WAL_FENCE_UNSUPPORTED`, `TIMELINE_MISMATCH`                                           | Do not restore files/start app; never fall back to latest timeline                                                                                                  |
| Database/credential        | `DB_INVENTORY_MISMATCH`, `ROLE_INVENTORY_MISMATCH`, `SCHEMA_MISMATCH`, `ROW_INVARIANT_FAILED`, `SYNTHETIC_ROW_INVALID`, `CREDENTIAL_INIT_FAILED`                             | Fail closed; never invent a row; only the controlled one-row hash mutation is allowed after fidelity                                                                |
| Filesystem restore         | `ARCHIVE_READ_FAILED`, `FILESYSTEM_TIMEOUT`, `PATH_INVALID`, `FILE_CHECKSUM_MISMATCH`                                                                                        | Stop before app; preserve bounded diagnostic target                                                                                                                 |
| DB/file consistency        | `SOURCE_STATE_UNAPPROVED`, `SOURCE_STATE_DRIFT`, `COUNT_MISMATCH`, `FILE_MUTATED`, `EXCLUDED_ARTIFACT_UNAPPROVED`                                                            | Preserve missing rows/orphans; exact reviewed exception only; no row/file changes                                                                                   |
| Application/tile/viewer    | `APP_START_FAILED`, `TILE_REBUILD_FAILED`, `AUTH_FAILED`, `BROWSE_FAILED`, `DZI_INVALID`, `VIEWER_TILE_INVALID`                                                              | Stop validation; retain isolated resources until expiry                                                                                                             |
| State/timeout/interruption | `STATE_SIZE_EXCEEDED`, `STAGE_TIMEOUT`, `MAX_RUNTIME_EXCEEDED`, `INTERRUPTED`, `INTERRUPTED_STALE_HOLDER`                                                                    | Codes are failure evidence, never state/outcome; safe resume stays running, otherwise transition to `FAILED_RETAIN`/retained through CAS                            |
| Cleanup/reaping            | `CLEANUP_INCOMPLETE`, `CLEANUP_AUTHORIZATION_FAILED`, `REAPER_FAILED`                                                                                                        | Success-path leaks block success; failed-run reaper preserves exact retained ownership until all children are absent; terminal-Job evidence is separate             |

Failure codes form a versioned bounded enum. `OVERLAP_ACTIVE` and
`LEASE_STATE_INITIALIZATION_LOST` are trigger-rejection/history codes only and MUST NOT become an
accepted-run failure. Accepted-run failure codes, including interruption/timeout codes and
`INTERNAL_ERROR`, map to terminal `state=FAILED_RETAIN,outcome=retained`; the code and separate
`failure_stage` carry the cause rather than inventing another terminal run outcome. Unknown internal
exceptions map to `INTERNAL_ERROR`, with detail in structured evidence rather than metric labels.

## Threat model

| Threat                                                | Control and required evidence                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Compromised backup container gains cluster control    | Backup Deployment has no API token/client/RBAC; orchestration is a separate component and namespace                                            |
| Orchestrator changes production                       | Namespace Role only, no production credentials/mounts, network deny, explicit negative authorization and connectivity tests                    |
| Child workload abuses Kubernetes API                  | No-permission service account, token automount disabled, no Kubernetes client requirement                                                      |
| Pod-create permission mounts arbitrary Secrets        | Flux-controlled fixed templates, digest-pinned allowlisted images, admission enforcement, and negative mount tests                             |
| Recovery metadata injects workload/target behavior    | Metadata cannot control templates, images, commands, volumes, Secrets, service accounts, synthetic `BASE_URL`/path/image                       |
| Synthetic Secret selects or installs wrong credential | Email matches the sole recovered row; pinned-image `app.auth.hash_password` generation and same-version `verify_password` prove plaintext/hash |
| Validation corrupts recovery sources                  | Read-only SAS and Barman credentials; no Azure write credential; no write to backup markers or retention                                       |
| Wrong, drifting, or incomplete set is accepted        | Fully published selection plus exact source-state policy and exclusions allowlist; acceptance alone is insufficient                            |
| Wrong database profile/timeline is restored           | Versioned static profile; manifest cross-check; first-eight-hex timeline binding; explicit targetLSN/targetTLI                                 |
| Resource spoofing causes unintended cleanup           | Exact managed-by/run labels plus bound name and UID; child/evidence separation; static/production exclusions                                   |
| Unbounded failed runs exhaust cluster                 | Explicit quota bounds, 24-hour default expiry, retained-count bound, child reaper; physical failure stays `PROVISION_FAILED`                   |
| Network misconfiguration reaches production/internet  | Default deny, approved Azure FQDN/proxy enforcement, concrete DNS/API/operator/scrape selectors, negative connectivity tests                   |
| High-cardinality telemetry/state overloads            | Exact metric allowlist; IDs/names/LSNs/free text excluded; 512 KiB and count bounds fail closed                                                |
| Idle business state is mistaken for exporter failure  | Local successful-read timestamp advances on every valid poll; missing alert ignores durable state-update age                                   |
| Restart repeats or skips unsafe work                  | CAS state sequence, immutable binding, deterministic names, machine-readable child outcomes, idempotent reconciliation                         |
| Concurrent overlap erases owning-run state            | Separate trigger/run pointers, identity-keyed history union, field-aware CAS merge, holder-only stages/resources/heartbeat                     |
| Ambiguous run state/outcome hides failure             | Exact stage-or-terminal state, equal active/latest `current_stage`, strict three-value run outcome projection, separate failure stage/code     |
| Orphan Lease is stolen after pre-state crash          | Encoded UID/run/times, expiry plus grace, absent/terminal UID, zero-child all-kind query, resourceVersion CAS, ambiguity deny                  |
| New run overwrites failed cleanup ownership           | `FAILED_RETAIN` transfers full exact inventory to max-2 `retained_runs` before release/replacement; reaper never uses history                  |
| Source-state digest hides semantic drift              | Exact typed keys/path normalization/sorts/JSON bytes, recomputed policy digest, constant-time digest plus structural comparison                |
| Rejected trigger contaminates run monitoring          | Disjoint metric enums and sources; active/stage/stuck/failure/cleanup/success never derive from `latest_trigger`                               |
| GitOps reconciliation resets state or an active lock  | Helm always omits runtime fields; three-way merge preserves controller additions; keep/prune policy and active/completed tests                 |
| CronJob GC deletes lifecycle evidence early           | Job quota 32, history limits 33, no TTL, 24h orchestrator/1h reaper evidence, hourly terminal reaper, joint formula; it alone deletes          |
| Job lifecycle is mistaken for child leakage           | Child absence gates success; own Job/Pod remain evidence until exit and static terminal-Job reaping                                            |
| Secret leaks through evidence                         | Secrets and password hashes excluded from state, metadata, args, logs, events, and metrics; scans and redaction tests                          |

## Test matrix for #1229

| #1229 requirement               | Test level and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same scheduled/on-demand path   | Helm tests assert hard `count/jobs.batch: 32`, both history limits `33` on all four CronJobs, absent TTL, Never/zero retry, 24h orchestrator/1h reaper-Job evidence, hourly terminal reaper, suspended on-demand parity, and rejects history<=quota, unapproved evidence<24h, interval>1h, any TTL, formula overflow, or independent overrides; acceptance runs both paths                                                                                                                                                                                                                                                                                                                                                                                                         |
| Latest set/source-state binding | Fake-Azure/golden tests cover exact missing/orphan keys/types/bounds, base-10 IDs, path normalization, duplicate rejection, numeric/lexical sorting, UTF-8 sorted-key compact JSON bytes/no newline, SHA-256 lowercase digest, policy recomputation/counts, constant-time digest plus structural match, zero default versus exact reviewed nonzero/new drift, manifest-accepted-but-unapproved, `SOURCE_STATE_DIGEST_INVALID`, and separate exclusions                                                                                                                                                                                                                                                                                                                             |
| Source profile/timeline         | ConfigMap schema tests bind profile ID/version, `app`/`app`/server/`ObjectStore`; accept format-2 `database_name=hriv` only as inventoried application connection DB and never as profile/bootstrap authority; reject actual manifest-profile conflict and malformed/missing/inconsistent fence; derive `00000007` as 7 and render explicit targetLSN/targetTLI                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Static templates and targets    | Mount versioned child templates/image digests and synthetic `BASE_URL`/category path/image name read-only; mutate recovery metadata with workload/target values and prove it cannot alter rendered children or journey targets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Fresh CNPG and PVC targets      | Fake-Kubernetes reconciliation and Helm tests prove deterministic run-labelled resources; physical binding/scheduling failures map to `PROVISION_FAILED`; acceptance observes new UIDs every run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| No production writes/isolation  | RBAC tests allow named source-profile/policy gets and exact run-kind verbs, deny Secret/arbitrary ConfigMap gets, inspect no-token children, reject arbitrary Secret mounts/template/image/target injection, and test exact network paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CNPG/database fidelity          | Production-shaped recovery verifies bound profile, exact LSN/timeline, all DBs, system identity, roles, schema, counts, fence, exact one synthetic row, and no `db.sql`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Synthetic credential mutation   | Require recovered row fidelity/email match; generate through pinned-image `app.auth.hash_password`, verify through same-version `app.auth.verify_password`, reject version/plaintext mismatch, assert no credential logging and one hash-only update, no migration/production connection, and Secret/target-config isolation                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Filesystem and consistency      | Failure injection covers partial reads, interruption, path/checksum/count/version errors, allowed/unapproved missing/orphan policy, excluded-artifact allowlist, and mutation/disappearance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Application, tile, and viewer   | Acceptance proves migrations/OIDC/workers/ARQ disabled, one-shot idempotent CLI invokes existing serial primitive for one recovered image on validation-only targets, emits machine output, then login/browse/DZI/tile succeeds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Overlap and interruption        | Crash/CAS tests cover every point after Lease acquisition and before initial state: no side effects, same-live-UID repair, active/grace rejection, and later recovery only after expiry+grace with exact absent/terminal UID and zero children across every kind; child/ambiguous identity denies takeover; Lease conflicts and recovery-only-holder crashes retry under the same guards; `LEASE_STATE_INITIALIZATION_LOST` affects trigger/history only; normal overlap and holder completion preserve owning state/history; retain normal terminal clear/immediate-terminal recovery and expired over-runtime stale takeover; interruption/timeout tests assert safe resume remains running or failure code transitions only to `FAILED_RETAIN`/retained with null current stage |
| Quota and retention             | Tests cover pre-accept max-2 retained reservation, fixed-template Job formula/current usage under quota 32, current+retained+evidence+reaper slots, atomic ownership transfer, invalid independent overrides, expiry, and physical-capacity non-claims without Longhorn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Durable state and telemetry     | Schema/property tests exhaust every nonterminal stage and both terminals, equal active/latest `current_stage`, terminal null stage/separate `failure_stage`, strict running/succeeded/retained run and accepted-history projections, no failed/interrupted/pending run outcome, max-2 retained records, 64-child inventories, byte reserves, ownership/trim, and Helm guarantees; metric/config goldens assert 10–60-second poll and 3–5-interval alert bounds, disjoint enums/retained metrics/no IDs, successful unchanged polls advancing local read time, open/read/parse/schema failures freezing it and retaining business samples, idle state update age not causing missing, and read age alerting only when greater than the configured default three intervals           |
| Cleanup gates success           | For each retained child kind inject absent, changed UID/label, partial deletion, and CAS conflict; prove reaper uses only retained full records, preserves remaining entries, removes record only at zero, mirrors only same-ID latest cleanup evidence, never sources ownership from history/latest labels, and keeps orchestrator evidence separate                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Alert behavior                  | Rule tests prove validation-failed/failure metrics require accepted `FAILED_RETAIN` plus separate failure stage/code, heartbeat/stuck labels use active `current_stage`, stage metrics use `latest_run.stages`, retained cleanup/count/aggregate and last success ignore trigger rejection; trigger-rejected covers each bounded trigger code separately; include overdue, scrape/read-age/parse missing cases, idle-old business state non-alerting, and clean recovery                                                                                                                                                                                                                                                                                                           |
| Production rollout              | Run latest first, inspect evidence and guarded cleanup, then run stable with the same production-shaped criteria; keep target removal explicitly manual until ownership guards pass acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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

| Phase                         | Issue                                                 | Boundary                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-only restore primitive   | [#1250](https://github.com/bcit-tlu/hriv/issues/1250) | Container-scoped read-only SAS selection, canonical format-2 source-state document/digest validation, and stateless filesystem restore with machine output, preserved missing/orphan semantics, and no backup-state writes                                                                                                        |
| Core orchestration            | [#1251](https://github.com/bcit-tlu/hriv/issues/1251) | Controller/chart; CAS state/Lease fields omitted by Helm; guarded post-Lease initialization recovery; active/latest/trigger plus max-2 retained ownership state; overlap-safe merge; concrete RBAC; fixed templates; exact `targetLSN`/fence-derived decimal `targetTLI`; default-deny only and no deployment                     |
| Application/viewer validation | [#1252](https://github.com/bcit-tlu/hriv/issues/1252) | Recovered synthetic email/row fidelity then pinned-backend-helper-generated/verified one-row credential-init; Flux target config; isolated app/Redis; one-shot serial tile CLI; login/browse/DZI/tile; no ARQ/production routes; no ownership of core egress or rollout                                                           |
| Operations and rollout        | [#1253](https://github.com/bcit-tlu/hriv/issues/1253) | UTC schedule/on-demand/reapers; Job quota/history/evidence formula (defaults 32/33/24h/1h), no TTL, Never/zero retry; exporter-local read health and disjoint run/retained metrics/alerts; exact cleanup/evidence; fixed reviewed egress/admission policies; immutable-config version rollout; Flux/Vault wiring; rollout/runbook |

Unresolved deployment blockers include the exact flux-fleet resource paths/ownership and
versioned #241 source profile; an operator-reviewed #1240 source-state policy or repaired zero
state; Vault policies/VSO destinations for read-only Azure and the email plus validation
credential fields generated by the pinned backend helper with matching version binding; CNPG-I Barman Cloud plugin read-credential/`ObjectStore` wiring;
approved and tested Azure FQDN/proxy or service-tag egress enforcement; concrete
API/DNS/Prometheus/CNPG policy selectors; versioned child-template/image allowlist and synthetic
target values; admission control for fixed child templates; initialization grace and
stage/max-runtime budgets; representative synthetic invariants; and Prometheus/alert routing. Exact
platform sizing may jointly adjust the default Job quota 32, history limits 33, 24-hour
orchestrator/one-hour reaper-Job evidence windows, hourly terminal reaper, retained reserve, and fixed-template maxima, but it MUST preserve the strict
history-greater-than-quota inequality, Job-slot formula, no-TTL rule, and bounded time requirements;
these relationships are defined contract requirements, not unresolved values. In particular, no deployment
may substitute broad TCP 443 egress or claim physical capacity from namespace quota. These are
configuration work for #1250–#1253; they do not reopen the baseline choices of read-only SAS,
dedicated component/namespace, `app`/`app`, exact LSN and fence-derived timeline, local synthetic
auth, or one serial tile rebuild.

Until every phase is deployed and a full clean run updates durable last-success state,
`HRIVRestoreTestFailed` remains valid and actionable.

## Simplified #1253 operational contract (supersedes prior level-5 sections)

This section is the current contract for #1253. It **supersedes** every earlier statement in this
document that requires #1252, application/viewer validation, credential-init, Redis, tile rebuild,
OIDC, a status exporter, dashboard, autonomous failed-child/Job reaper, multiple retained runs, or
exact whole-cluster database/role equality. Those older level-5 passages remain only as design
history and are not implementation or rollout requirements.

The deployed drill consists only of the #1251 core controller, fixed state ConfigMap and Lease,
initially suspended weekly and suspended on-demand orchestrator CronJobs, one suspended manual-cleanup CronJob, the
validation-local ObjectStore, fixed Envoy egress proxy, RBAC/quota, and fixed NetworkPolicies. The
weekly schedule is unsuspended only after the latest on-demand acceptance run passes; stable remains suspended until latest evidence is reviewed. The weekly CronJob is exactly `hriv-restore-validation-weekly`, runs `0 11 * * 0` in UTC, forbids
concurrency, has a 3600-second starting deadline, zero Job retries, `Never` restart, a 21600-second
active deadline, two successful and one failed Job histories, and no TTL. The on-demand template is
`hriv-restore-validation-on-demand`; its standalone Job template sets native
`ttlSecondsAfterFinished: 604800` (seven days), as does the standalone cleanup Job template. This is
native evidence cleanup, not an application reaper. Operators MUST preserve/download Job and Pod logs
and final JSON before TTL expiry, or explicitly delete the Job only after review. Operators trigger it server-side with:

```bash
kubectl -n hriv-restore-validation create job --from=cronjob/hriv-restore-validation-on-demand \
  hriv-restore-validation-on-demand-$(date -u +%Y%m%d%H%M%S)
```

Its Job template is generated by the same shared helper as weekly and differs only in trigger identity
and the standalone seven-day TTL; weekly deliberately omits TTL. Resource-quota preflight counts
all currently retained namespace Jobs conservatively before reserving the remaining child Jobs. A retained failure
is a terminal nonzero Job and rejects later runs until cleanup. Every accepted `run` writes exactly
one bounded final JSON report after diagnostics. It includes Job/run identity, recovery point, stage
outcomes and durations, bounded counts/bytes, `source_files_sha256`, failure, and cleanup evidence;
it excludes source-file inventories, secrets, URLs, and archive ETags. Scheduled retained failures
and retained-overlap rejection are nonzero so native Job failure is observable.

### Simplified source profile fidelity

`database_row_count` from the immutable selected recovery set is the sole expected recovered
`source_images` count. The controller passes that value as a fixed `validate-database` argument; the
profile contains no static source-image count. `requiredDatabaseInventory` and
`requiredStaticRoleInventory` are required subsets: every configured name and its configured
owner/connection flag or complete attributes/memberships must match exactly, while unrelated
shared-cluster databases and static roles are allowed. Duplicate configured names remain invalid,
and configured dynamic Vault role prefixes are filtered before matching. Alembic migration remains
exact. `minimumRowCounts` are lower bounds and observed counts are reported. Synthetic identity is
only `{id,email_sha256}`; the validator lowercases the recovered email, hashes it with SHA-256, and
never emits the email.

### One retained environment and audited cleanup

Operational values require `maxRetainedRuns: 1`. Cleanup is never autonomous. After diagnosis, an
operator starts the fixed template without a run-id argument:

```bash
kubectl -n hriv-restore-validation create job --from=cronjob/hriv-restore-validation-cleanup \
  hriv-restore-validation-cleanup-$(date -u +%Y%m%d%H%M%S)
```

`cleanup-retained` acquires the same Lease with its Job UID and rejects an active run, zero retained
records, multiple records, altered UID/labels/template identity, or any unbound child. It reconciles
UID-preconditioned foreground deletion only for the one state-bound run in the validation namespace,
waits until all bound and run-labelled children are absent, then CAS-removes that retained record,
updates matching latest-run cleanup evidence, and releases the Lease. A restart with the same Job UID
resumes safely. A replacement cleanup Job UID may CAS-take over only after the cleanup Lease expires,
the old holder Job UID is absent or terminal, state still contains exactly one matching retained/latest
record, and every observed object passes exact bound-resource or controlled-descendant validation.
Live or unexpired holders, different run IDs, corrupt ownership, or changed state fail closed. It
never accepts arbitrary run IDs or deletes static, orchestrator-evidence, or production resources.
After cleanup completes, confirm PVC capacity is recovered, review the failed Job logs/evidence,
then trigger the suspended on-demand CronJob before waiting for the next weekly run.

### Fixed egress and native alert contract

Azure-reading selection/source-restore/CNPG workloads use only `HTTPS_PROXY` pointing to
`hriv-restore-validation-egress-proxy:10000`; `NO_PROXY` is exactly
`.svc,.cluster.local,10.43.0.1,localhost,127.0.0.1`. Database/consistency/controller containers do
not receive an internet proxy. Default deny remains. DNS is selector-limited to CoreDNS;
orchestrator/cleanup may reach only API `10.43.0.1/32:443`; validation traffic stays in the namespace;
Azure readers reach only the proxy; and only the proxy receives TCP/443 internet egress. NetworkPolicy
cannot enforce hostnames: the Envoy v1.39 CONNECT virtual-host ACL is the hostname enforcement layer
and allows only one-to-four exact reviewed `<account>.blob.core.windows.net:443` authorities represented
as literal domains—there is no wildcard route/domain. The operational value pins `envoyproxy/envoy:v1.39.1` to
`sha256:57e14a549d7bd43c8d3f6d03e8cfa653e037d4b38e133acd9b54f38c524401b4`.

The environment overlay must keep source-state-policy digest `958b1dc2dca298c56fd96dd80b6c694144905e22c00c4b3ca9d2c59c3b666083`; it is deployment evidence and intentionally is not the chart default. The reviewed PostgreSQL image must use an explicit OCI-valid tag plus SHA-256 digest (for example, `postgresql:17@sha256:<digest>`), because CNPG rejects a digest-only `spec.imageName` during upgrade detection. Consistency validates every selected canonical absent row's exact ID/status/path/reason and requires zero unexpected restored orphans internally. Its result omits the full list and contains only `missing_count`, SHA-256 of the actual canonical UTF-8 missing list, `unexpected_orphan_count=0`, source file digest, counts/bytes, and policy digest; the controller independently computes and exactly compares expected count/digest. Maximum 256-entry output remains below 32 KiB. The chart's 200Gi per-PVC LimitRange permits stable's required 160Gi source PVC for 128,986,771,498 bytes plus controller margin; latest remains 40Gi and namespace quota remains 320Gi under the one-active-or-one-retained rule; the 32-ConfigMap quota retains bounded immutable payload generations alongside fixed coordination and proxy ConfigMaps.

The current changed runtime payload identities are atomically `hriv-restore-validation-controller-v6`,
`hriv-restore-validation-source-profile-v6`, `hriv-restore-validation-source-state-policy-v6`, and
`hriv-restore-validation-child-templates-v6`. Every orchestrator, cleanup, embedded child mount, and
strict parser expectation uses `-v6`. Upgrade creates those immutable ConfigMaps rather than patching
prior generations; no workload references the older generations, which remain until explicit
operator-managed cleanup. The fixed
`hriv-restore-validation-state` ConfigMap and `hriv-restore-validation` Lease retain their names.

There is one operationally rendered native `monitoring.coreos.com/v1` PrometheusRule and exactly one
alert, `HRIVCoreRestoreValidationUnhealthy`. Its kube-state-metrics-only expression compares the
latest failed and successful Job start times separately for weekly, on-demand, and cleanup prefixes,
so a retained failure clears only after a newer success in the same trigger family. It also checks
weekly last success older than eight days and an absent weekly last-success series only after
`kube_cronjob_created` is older than eight days. It uses `for: 15m`, fixed low-cardinality labels,
no run IDs, and links the flux-fleet restore-validation
observability runbook. Full core success plus confirmed child cleanup is required before a weekly Job
exits zero. At that point the controller sets `core_succeeded.contract_boundary=simplified1253` and
atomically advances strict bounded `last_complete_success` containing only run ID, completion time,
recovery-set ID, source-files digest, and succeeded zero-remaining cleanup evidence. Failures never
advance it. A preserved terminal `1251` success remains readable after upgrade but cannot populate
`last_complete_success`; the next accepted simplified run replaces it normally. On-demand success
does not rewrite the weekly kube-state-metrics last-success timestamp. There is no dashboard, custom
metric, exporter, or #1252 dependency.
