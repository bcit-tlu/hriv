## Status and purpose

This document is the normative design contract for issue
[#1249](https://github.com/bcit-tlu/hriv/issues/1249), a design slice of
[#1229](https://github.com/bcit-tlu/hriv/issues/1229). It defines how a future
`hriv-restore-validation` component must prove that a published HRIV recovery set can restore
without touching production. The recovery-set publication and consistency rules remain
normative in [the recovery-set contract](../recovery-set-contract.md).

The original sections retain the level-5 design and threat analysis for reference, but they are no
longer the deployment contract. The current proportionate scope is the
[weekly core recovery contract](delivery.md#simplified-1253-operational-contract-supersedes-prior-level-5-sections)
in the delivery contract. That section explicitly supersedes requirements for #1252,
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
