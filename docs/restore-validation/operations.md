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
