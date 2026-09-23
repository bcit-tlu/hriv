# Isolated restore-validation contract

This is the normative design contract for issue
[#1249](https://github.com/bcit-tlu/hriv/issues/1249), a design slice of
[#1229](https://github.com/bcit-tlu/hriv/issues/1229). It defines how the
`hriv-restore-validation` component must prove that a published HRIV recovery set
can restore without touching production. Recovery-set publication and consistency
rules remain normative in [the recovery-set contract](recovery-set-contract.md).

The document is split into per-area files under `docs/restore-validation/` — load
the one matching your task rather than the whole contract:

| File                                              | Contents                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [contract.md](restore-validation/contract.md)     | Status/purpose, baseline decisions and non-goals, trust boundary and component architecture, least privilege, credentials and read surfaces, network isolation                                |
| [lifecycle.md](restore-validation/lifecycle.md)   | Scheduling/invocation/overlap, run identity and ownership, source selection and immutable binding, capacity/quota preflight, state machine, durable state contract, idempotent reconciliation |
| [validation.md](restore-validation/validation.md) | Database/filesystem validation details, cleanup and failed-target retention                                                                                                                   |
| [operations.md](restore-validation/operations.md) | Telemetry/metrics/alerts, failure taxonomy, threat model                                                                                                                                      |
| [delivery.md](restore-validation/delivery.md)     | #1229 test matrix, delivery phases/prerequisites, and the **simplified #1253 operational contract** (the current deployment contract — supersedes the earlier level-5 sections)               |

The keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** state implementation
requirements throughout the linked files.
