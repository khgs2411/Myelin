# ProjectMemoryCuratorEvidenceContract

Pseudocode artifact. Non-executable reference shape for planning.

## Intended Destination

Extend:

- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-validator.ts`
- curator mode prompts or instruction assets

## Ownership

The curator declares what evidence it used. The validator decides whether that evidence is acceptable.

## Non-Ownership

The curator does not:

- decide lookup freshness;
- decide hint validity;
- bypass deterministic apply validation;
- convert stale lookup evidence into fresh evidence by citing it.

## Maintenance Proposal Item Extension

```ts
type ProjectMemoryMaintenanceProposalItem = {
  // existing fields...
  evidence_dependencies: ProjectMemoryEvidenceDependency[];
}
```

Required when operation depends on existing memory:

- `CREATE_ENTRY`: dependency for dedupe/target selection when existing memory was checked.
- `PATCH_ENTRY`: dependency for target selection and content support.
- `MARK_STALE`, `SUPERSEDE_ENTRY`, `RETRACT_ENTRY`: dependency for supersession/conflict check.
- `NOOP`: use explicit no-op decision instead of a write item.

## Explicit No-Op Decision Extension

```ts
type ProjectMemoryCuratorDraft = {
  // existing fields...
  explicit_noop_decisions: ExplicitNoOpDecision[];
}
```

Validation rules:

- for any non-empty packet that used fallback lookup, empty `items` is not enough for completed no-op;
- explicit no-op must cite candidate/source refs;
- explicit no-op must cite canonical markdown refs checked when claiming memory is already covered;
- `insufficient_evidence` no-op remains reviewable, not completed;
- no-op refs must map to packet input ids.
- explicit no-op applies in both creation and maintenance modes.

## Scoped Gating Rules

- If dependency points to fresh indexed lookup, normal validation may proceed.
- If dependency points to fallback lookup:
  - creation mode may proceed when direct candidate/source evidence supports the write;
  - maintenance mode requires review and must not auto-apply.
- If dependency points to stale/orphaned/unavailable lookup, quarantine or reject the item.
- If one item depends on stale evidence, unrelated items are not automatically quarantined.

## Result Vocabulary

Validation findings should distinguish:

- `lookup_dependency_missing`
- `lookup_dependency_stale`
- `lookup_dependency_fallback_requires_review`
- `noop_missing_explicit_decision`
- `noop_missing_checked_memory_refs`
