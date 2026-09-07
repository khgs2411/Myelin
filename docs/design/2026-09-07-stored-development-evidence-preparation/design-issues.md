# Stored Development Evidence Preparation — Design Issues

Established context: [Feature Shape](feature-shape.md).

## Application Ingestion With The Development No-Op

**Status:** RESOLVED — approved by the user on 2026-09-07 and implemented.

**Evidence:** current config.json selects development.no-op/no-op. Verified
NoOpCurator returns completed with no memories. Removing the preparation factory
makes this executor reachable through normal ingestion. The approved service
flow completes the whole batch for this result. The roadmap distinguishes
preparation and placeholder execution from real evidence evaluation.

**Exposed by:** the development team's implementation review, confirmed against
current configuration, executor factory, and service pseudocode.

**Established:** zero-memory completion is a valid result from a curator that
evaluates the complete batch. Executor selection is lazy at application
ingestion and occurs before claims. Capture can start without an available
ingestion executor.

**Decision:** Remove the development no-op from available application ingestion
executors. Preserve lazy selection. Application ingestion fails with
`ingestion:executor-unavailable` before claims until real execution exists.
Controlled service-boundary verification proves that a real completed
zero-memory evaluation still completes its claimed batch.

**Reason:** A no-op completion would make unevaluated evidence ineligible for a
future real curator. Preparation alone must not advance evidence completion.
