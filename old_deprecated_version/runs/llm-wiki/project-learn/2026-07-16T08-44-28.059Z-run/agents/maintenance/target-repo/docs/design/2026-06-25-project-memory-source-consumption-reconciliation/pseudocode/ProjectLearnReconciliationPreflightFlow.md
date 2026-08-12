# ProjectLearnReconciliationPreflightFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Flow

`project learn <key>` should close consumed Project Memory source refs before building the next curator packet.

Current relevant flow shape:

1. `ProjectMemoryCuratorService.runProjectLearn(input)` starts.
2. It checks incomplete Project Memory apply journals.
3. If a journal exists, it recovers or fails closed before new curator work.
4. It repairs the project shell when not dry-run.
5. It creates the current run directory.
6. It builds schema context.
7. It builds the Project Memory packet.
8. It invokes the curator.
9. It validates output.
10. It applies eligible output when gates allow.

Target flow with reconciliation:

1. Start `ProjectMemoryCuratorService.runProjectLearn(input)`.
2. Preflight incomplete apply journals.
3. If recovery succeeds, return the recovery result as today.
4. If recovery fails, return failed as today.
5. Run `ProjectMemorySourceConsumptionReconciler.reconcileProject(projectKey, now)`.
6. If reconciliation is degraded because state evidence is malformed, stop before curator invocation with a `needs_review` or failed result.
7. If reconciliation is degraded only because `state/memory.db` is missing, continue with degraded packet behavior as current packet construction already reports missing memory DB.
8. Repair project shell when not dry-run.
9. Create the current `project-learn` run.
10. Build schema context.
11. Build the Project Memory packet.
12. Invoke curator with packet that no longer includes DB rows moved to `processed`.
13. Continue existing validate/apply/report flow.

## Failure Posture

- Apply recovery failure blocks new curator work.
- Malformed source-consumption state blocks or degrades before new curator work; do not mutate SQLite from bad lifecycle evidence.
- Missing source-consumption state is not a failure.
- Missing root memory DB is not a reconciliation failure; packet building already reports Session Memory and pending inputs unavailable.
- Missing queue rows for a source-consumption record are not fatal.

## Why Reconciliation Runs Before Packet

`buildProjectMemoryPacket` reads `pending` and `needs_review` project candidates and project handoffs from SQLite. If consumed rows remain pending, the curator can see the same source again even though markdown apply already made it terminal Project Memory.

Running reconciliation before packet construction keeps the curator input bounded and prevents repeated proposal loops.

## Result Surfacing

Initial slice can keep reconciliation internal.

Allowed later extension:

- include reconciliation counts in JSON `project learn` result;
- include a compact human line such as `reconciled sources: 3`;
- add a diagnostic command only if operators need explicit visibility.

Do not add a public command solely because the internal service exists.

