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

This section is the current contract for #1253. It **supersedes** every earlier statement across the
`docs/restore-validation/` documents (contract, lifecycle, validation, operations) that requires #1252, application/viewer validation, credential-init, Redis, tile rebuild,
OIDC, a status exporter, dashboard, autonomous failed-child/Job reaper, multiple retained runs, or
exact whole-cluster database/role equality. Those older level-5 passages remain only as design
history and are not implementation or rollout requirements.

The deployed drill consists only of the #1251 core controller, fixed state ConfigMap and Lease,
initially suspended weekly and suspended on-demand orchestrator CronJobs, one suspended manual-cleanup CronJob, the
validation-local ObjectStore, fixed Envoy egress proxy, RBAC/quota, and fixed NetworkPolicies. The
weekly schedule is unsuspended only after the latest on-demand acceptance run passes; stable remains suspended until latest evidence is reviewed. The weekly CronJob is exactly `hriv-restore-validation-weekly`, runs `0 11 * * 0` in UTC, forbids
concurrency, has a 3600-second starting deadline, zero Job retries, `Never` restart, an
active deadline equal to `controller.maxRuntimeSeconds` (21600 seconds in the reviewed overlays),
two successful and one failed Job histories, and no TTL. The on-demand template is
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
Azure readers reach only the proxy; and only the proxy receives TCP/443 internet egress. The CNPG
Cluster template sets `spec.inheritedMetadata.labels` to the fixed managed-by/role labels, and the
controller adds its run ID so generated recovery Jobs, Pods, PVCs, Services, and Secrets inherit
run evidence; observed Jobs, Pods, PVCs, and Services remain policy-selected and state-accounted.
A separate narrow ingress rule permits only the `cnpg-system`
`cnpg-operator`/`cloudnative-pg` operator to reach recovered instances on TCP/8000; database clients
remain limited to TCP/5432. NetworkPolicy
cannot enforce hostnames: the Envoy v1.39 CONNECT virtual-host ACL is the hostname enforcement layer
and allows only one-to-four exact reviewed `<account>.blob.core.windows.net:443` authorities represented
as literal domains—there is no wildcard route/domain. The operational value pins `envoyproxy/envoy:v1.39.1` to
`sha256:57e14a549d7bd43c8d3f6d03e8cfa653e037d4b38e133acd9b54f38c524401b4`.

The environment overlay must keep source-state-policy digest `958b1dc2dca298c56fd96dd80b6c694144905e22c00c4b3ca9d2c59c3b666083`; it is deployment evidence and intentionally is not the chart default. The reviewed PostgreSQL image must use an explicit OCI-valid tag plus SHA-256 digest (for example, `postgresql:17@sha256:<digest>`), because CNPG rejects a digest-only `spec.imageName` during upgrade detection. Consistency validates every selected canonical absent row's exact ID/status/path/reason and requires zero unexpected restored orphans internally. Its result omits the full list and contains only `missing_count`, SHA-256 of the actual canonical UTF-8 missing list, `unexpected_orphan_count=0`, source file digest, counts/bytes, and policy digest; the controller independently computes and exactly compares expected count/digest. Maximum 256-entry output remains below 32 KiB. The chart's 200Gi per-PVC LimitRange permits stable's required 160Gi source PVC for 128,986,771,498 bytes plus controller margin; latest remains 40Gi and namespace quota remains 320Gi under the one-active-or-one-retained rule; the 32-ConfigMap quota retains bounded immutable payload generations alongside fixed coordination and proxy ConfigMaps.

The current changed runtime payload identities are atomically `hriv-restore-validation-controller-v7`,
`hriv-restore-validation-source-profile-v7`, `hriv-restore-validation-source-state-policy-v7`, and
`hriv-restore-validation-child-templates-v7`. Every orchestrator, cleanup, embedded child mount, and
strict parser expectation uses `-v7`. Upgrade creates those immutable ConfigMaps rather than patching
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
