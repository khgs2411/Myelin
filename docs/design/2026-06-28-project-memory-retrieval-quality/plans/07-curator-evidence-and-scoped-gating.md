# Chunk 07: Curator Evidence And Scoped Gating

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `01-retrieval-contracts-and-run-status.md`, `06-lookup-and-packet-quality.md`  
**Enables:** `09-project-learn-lifecycle-and-dogfood.md`

## Goal

Extend curator output validation and apply gating so lookup quality affects only proposals that depend on weak/stale evidence. This chunk adds explicit evidence dependency validation, explicit no-op completion policy, fallback-dependent maintenance review gating, and removes the old rule that any packet degradation quarantines every maintenance item.

## Source Artifacts

- `../spec.md`: Packet And Evidence Contract, Lookup Quality And Apply Gating
- `../agenda.md`: Question 5 evidence dependency tracking, Question 6 no-op completion
- `../pseudocode/ProjectMemoryCuratorEvidenceContract.md`
- `../pseudocode/ProjectLearnRetrievalLifecycle.md`
- `../../../../src/project/project-memory-curator-contracts.ts`
- `../../../../src/project/project-memory-curator-validator.ts`
- `../../../../src/project/project-memory-curator-service.ts`
- `../../../../tests/project/project-memory-curator-validator.test.ts`
- `../../../../tests/project/project-memory-curator-service.test.ts`

## Relationships

- **Depends on:** packet lookup quality summary and retrieval contract types.
- **Enables:** dogfood can complete or review based on scoped evidence rather than fallback lookup alone.
- **Shared contracts:** `evidence_dependencies`, `explicit_noop_decisions`, validator finding codes.
- **Integration points:** curator prompt contracts, validation result, `canApply`, service run result.

## File Responsibility Map

**Modify:**

- `src/project/project-memory-curator-contracts.ts` - ensure fields from chunk 1 are available in concrete output types.
- `src/project/project-memory-curator-validator.ts` - validate dependencies, explicit no-op decisions, and scoped lookup quality findings.
- `src/project/project-memory-curator-service.ts` - update `canApply` to use validation and lookup quality summary instead of raw `packet.degraded` only.
- Stage instruction assets under `stages/` if curator JSON schema/prompt text requires the new fields.

**Test:**

- `tests/project/project-memory-curator-validator.test.ts` - scoped gating and no-op policy.
- `tests/project/project-memory-curator-service.test.ts` - service no longer stops solely on fallback advisory lookup, but still stops on fallback-dependent maintenance writes.

## Implementation Tasks

### Task 1: Add explicit no-op validation tests

**Files:**

- Modify: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Add fallback no-op regression tests**

Use packets with one project candidate, fallback lookup advisory/proposal-scoped
summary, and zero write proposals. Cover both maintenance (`items: []`) and
creation (`pages: []`) because explicit no-op decisions live on the common
curator envelope.

```ts
test("requires explicit no-op decision for non-empty fallback lookup packet with zero maintenance items", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.lookup.quality_summary = {
    blocking: false,
    blocking_reasons: [],
    advisory_reasons: ["fallback markdown search"],
    proposal_scoped_result_ids: ["lookup:cand_1"],
  };
  input.pending.project_candidates = [
    {
      id: "cand_1",
      status: "pending",
      candidate_type: "project.fact",
      title: "Ranking",
      summary: "Ranking is already covered.",
      source_event_refs: [],
      confidence: "high",
      risk: "low",
      reason: "durable",
    },
  ];

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "No items",
    items: [],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("noop_missing_explicit_decision");
});

test("requires explicit no-op decision for non-empty fallback lookup packet with zero creation pages", () => {
  const input = packet("create");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.lookup.quality_summary = {
    blocking: false,
    blocking_reasons: [],
    advisory_reasons: ["fallback markdown search"],
    proposal_scoped_result_ids: ["lookup:cand_1"],
  };
  input.pending.project_candidates = [candidate("cand_1")];

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "No pages",
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Nothing to write.",
      untrusted_existing_markdown_policy: "ignore",
    },
    pages: [],
    state_intent: {
      mark_project_memory_curated: false,
      freshness_intent: "leave_degraded",
    },
    evidence_refs: [],
    repo_citations: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("noop_missing_explicit_decision");
});

test("accepts explicit no-op decision under fallback lookup when checked refs are present", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.lookup.quality_summary = {
    blocking: false,
    blocking_reasons: [],
    advisory_reasons: ["fallback markdown search"],
    proposal_scoped_result_ids: ["lookup:cand_1"],
  };
  input.pending.project_candidates = [candidate("cand_1")];

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "Already covered",
    items: [],
    noop_inputs: [],
    explicit_noop_decisions: [
      {
        id: "noop_1",
        source_packet_refs: [{ kind: "project_candidate", ref: "cand_1", required_for: "noop_support" }],
        checked_existing_memory_refs: [{ kind: "lookup_result", ref: "lookup:cand_1", required_for: "noop_support" }],
        reason: "already_trusted",
        explanation: "Existing ranking memory covers the candidate.",
      },
    ],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.noop_refs).toEqual(["noop_1"]);
});

test("accepts explicit creation no-op decision under fallback lookup when checked refs are present", () => {
  const input = packet("create");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.pending.project_candidates = [candidate("cand_1")];

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "Already covered",
    explicit_noop_decisions: [
      {
        id: "noop_create_1",
        source_packet_refs: [{ kind: "project_candidate", ref: "cand_1", required_for: "noop_support" }],
        checked_existing_memory_refs: [{ kind: "lookup_result", ref: "lookup:cand_1", required_for: "noop_support" }],
        reason: "already_trusted",
        explanation: "Existing memory covers the creation candidate.",
      },
    ],
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Nothing to write.",
      untrusted_existing_markdown_policy: "ignore",
    },
    pages: [],
    state_intent: {
      mark_project_memory_curated: false,
      freshness_intent: "leave_degraded",
    },
    evidence_refs: [],
    repo_citations: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.noop_refs).toEqual(["noop_create_1"]);
});

test("keeps insufficient-evidence explicit no-op reviewable", () => {
  const result = validateCuratorOutput(packetWithFallbackCandidate(), proposalWithExplicitNoop("insufficient_evidence"));

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("noop_insufficient_evidence");
});
```

- [ ] **Step 2: Run validator tests**

Run: `rtk bun test tests/project/project-memory-curator-validator.test.ts`  
Expected: fails because validator has not implemented explicit no-op decisions yet.

### Task 2: Implement explicit no-op validation

**Files:**

- Modify: `src/project/project-memory-curator-validator.ts`

- [ ] **Step 1: Add finding codes and packet non-empty helper**

```ts
function packetHasInputs(packet: ProjectMemoryPacket): boolean {
  return (
    packet.pending.project_handoffs.length > 0 ||
    packet.pending.project_candidates.length > 0 ||
    packet.session_memory.selected.length > 0
  );
}

function packetUsedFallbackLookup(packet: ProjectMemoryPacket): boolean {
  return packet.lookup.results.some((result) => result.lookup_quality === "fallback");
}
```

- [ ] **Step 2: Validate explicit no-op decisions in maintenance and creation output**

Use one helper for both output modes. Pass `hasWriteProposals` as
`output.pages.length > 0` for creation and `output.items.length > 0` for
maintenance.

```ts
function validateExplicitNoopDecisions(
  packet: ProjectMemoryPacket,
  decisions: unknown,
  hasWriteProposals: boolean,
): { findings: ProjectMemoryValidationFinding[]; noopRefs: string[] } {
  const findings: ProjectMemoryValidationFinding[] = [];
  const noopRefs: string[] = [];
  const values = Array.isArray(decisions) ? decisions : [];

  if (!hasWriteProposals && packetHasInputs(packet) && packetUsedFallbackLookup(packet) && values.length === 0) {
    findings.push(finding("blocker", "explicit_noop", "noop_missing_explicit_decision", "Fallback lookup with zero write proposals requires an explicit no-op decision."));
  }

  for (const decision of values) {
    if (!isRecord(decision) || typeof decision.id !== "string") {
      findings.push(finding("blocker", "explicit_noop", "noop_invalid_shape", "Explicit no-op decision requires an id."));
      continue;
    }
    if (decision.reason === "insufficient_evidence") {
      findings.push(finding("blocker", "explicit_noop", "noop_insufficient_evidence", "Insufficient-evidence no-op remains reviewable.", decision.id));
    }
    const sourceRefs = Array.isArray(decision.source_packet_refs) ? decision.source_packet_refs : [];
    const checkedRefs = Array.isArray(decision.checked_existing_memory_refs) ? decision.checked_existing_memory_refs : [];
    if (sourceRefs.length === 0) {
      findings.push(finding("blocker", "explicit_noop", "noop_missing_source_refs", "Explicit no-op requires source packet refs.", decision.id));
    }
    if (packetUsedFallbackLookup(packet) && checkedRefs.length === 0) {
      findings.push(finding("blocker", "explicit_noop", "noop_missing_checked_memory_refs", "Fallback no-op requires checked existing memory refs.", decision.id));
    }
    noopRefs.push(decision.id);
  }

  return { findings, noopRefs };
}
```

Integrate it into both `validateCreationDraft` and
`validateMaintenanceProposal` after mode-specific shape validation. `result()`
may need an overload or input for global no-op refs rather than deriving only
from maintenance item `NOOP`.

- [ ] **Step 3: Run no-op tests**

Run: `rtk bun test tests/project/project-memory-curator-validator.test.ts`  
Expected: new no-op tests pass.

### Task 3: Add evidence dependency scoped gating tests

**Files:**

- Modify: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Add scoped dependency tests**

```ts
test("requires review for maintenance item depending on fallback lookup", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];

  const result = validateCuratorOutput(
    input,
    proposalWithItem({
      id: "fallback_dep",
      evidence_dependencies: [{ kind: "lookup_result", ref: "lookup:cand_1", required_for: "dedupe" }],
    }),
  );

  expect(result.quarantined_item_ids).toEqual(["fallback_dep"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain(
    "lookup_dependency_fallback_requires_review",
  );
});

test("rejects item depending on stale lookup result without quarantining unrelated item", () => {
  const input = packet("maintain");
  input.lookup.results = [
    staleLookupResult("lookup:stale", "cand_1"),
    indexedLookupResult("lookup:fresh", "cand_2"),
  ];

  const result = validateCuratorOutput(input, proposalWithItems([
    maintenanceItem({
      id: "bad",
      evidence_dependencies: [{ kind: "lookup_result", ref: "lookup:stale", required_for: "target_selection" }],
    }),
    maintenanceItem({
      id: "good",
      evidence_dependencies: [{ kind: "lookup_result", ref: "lookup:fresh", required_for: "target_selection" }],
    }),
  ]));

  expect(result.rejected_item_ids).toEqual(["bad"]);
  expect(result.eligible_item_ids).toEqual(["good"]);
});
```

- [ ] **Step 2: Implement dependency lookup**

In validator:

```ts
function validateEvidenceDependencies(
  packet: ProjectMemoryPacket,
  item: ProjectMemoryMaintenanceProposalItem,
): ProjectMemoryValidationFinding[] {
  const dependencies = item.evidence_dependencies ?? [];
  const findings: ProjectMemoryValidationFinding[] = [];
  for (const dependency of dependencies) {
    if (dependency.kind !== "lookup_result") continue;
    const lookup = packet.lookup.results.find((result) => result.id === dependency.ref);
    if (!lookup) {
      findings.push(finding("blocker", "lookup_dependency", "lookup_dependency_missing", `Unknown lookup dependency: ${dependency.ref}`, item.id));
      continue;
    }
    if (lookup.lookup_freshness === "stale" || lookup.lookup_freshness === "orphaned" || lookup.lookup_quality === "unavailable") {
      findings.push(finding("blocker", "lookup_dependency", "lookup_dependency_stale", `Lookup dependency is ${lookup.lookup_freshness}.`, item.id));
      continue;
    }
    if (packet.mode === "maintain" && lookup.lookup_quality === "fallback") {
      findings.push(finding("warn", "lookup_dependency", "lookup_dependency_fallback_requires_review", "Maintenance writes depending on fallback lookup require review.", item.id));
    }
  }
  return findings;
}
```

Update item outcome logic:

- blocker dependency findings reject item;
- `lookup_dependency_fallback_requires_review` quarantines item;
- unrelated items are not changed.

- [ ] **Step 3: Remove global packet degraded quarantine for advisory fallback**

Replace:

```ts
if (packet.degraded) {
  findings.push(finding("warn", "degraded_context", "packet_degraded", ...));
}
```

with:

```ts
if (packet.degraded) {
  findings.push(finding("warn", "degraded_context", "packet_degraded", `Packet has blocking degraded context: ${packet.degraded_reasons.join("; ")}`, itemId));
}
```

Only true blocking packet degradation should set `packet.degraded` after chunk 6. Do not use advisory fallback reasons for all-item quarantine.

- [ ] **Step 4: Run validator tests**

Run: `rtk bun test tests/project/project-memory-curator-validator.test.ts`  
Expected: passes.

### Task 4: Update apply gate in service

**Files:**

- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add service tests for fallback advisory no-op**

Add a dry runner output with empty items and explicit no-op decisions for a packet with a pending candidate and fallback lookup. The expected result should not be `"packet was degraded"` once chunk 6 makes fallback advisory non-blocking.

```ts
expect(result.status).toBe("completed");
expect(result.stopped_reason).toBe("dry-run requested");
```

For non-dry-run maintenance writes depending on fallback lookup, expect:

```ts
expect(result.status).toBe("needs_review");
expect(result.stopped_reason).toContain("curator validation produced rejected or quarantined output");
```

- [ ] **Step 2: Update `canApply` only for blocking degradation**

Keep the packet degradation guard, but after chunk 6 this only represents blocking context:

```ts
if (input.packet.degraded) {
  return { ok: false, status: "needs_review", reason: "packet has blocking degraded context" };
}
```

Do not bypass validation for no-op. Validation must decide whether explicit no-op is sufficient.

- [ ] **Step 3: Run service tests**

Run: `rtk bun test tests/project/project-memory-curator-service.test.ts`  
Expected: passes.

## Verification

- `rtk bun test tests/project/project-memory-curator-validator.test.ts`  
  Expected: passes with explicit no-op and scoped dependency tests.
- `rtk bun test tests/project/project-memory-curator-service.test.ts`  
  Expected: passes.
- `rtk bun run typecheck`  
  Expected: passes.

## Acceptance Criteria Covered

- Explicit no-op is required for non-empty fallback lookup packets with zero write proposals.
- `insufficient_evidence` no-op remains reviewable.
- Maintenance writes depending on fallback lookup require review.
- Stale/orphaned/unavailable lookup dependencies reject or quarantine only affected items.
- Unrelated proposals are not blocked by another proposal's low-quality lookup evidence.

## Risks And Rollback

- Risk: shared no-op validation may accidentally diverge between creation and maintenance call sites. Mitigation: keep the helper mode-agnostic and assert both `pages: []` and `items: []` fallback cases in validator tests.
- Risk: old packet degraded tests may conflict with new scoped behavior. Mitigation: preserve blocking packet degradation and rewrite fallback-specific tests only.
- Rollback: restore old validator packet-degraded quarantine and service `packet was degraded` guard. No migrations are changed.

## Non-Goals

- No vector lookup implementation.
- No post-write indexing lifecycle.
- No hint generation.
- No command changes except test fixtures if service output formatting needs updates.

## Type And Name Consistency

Verify these names are exact:

- `evidence_dependencies`
- `explicit_noop_decisions`
- `lookup_dependency_missing`
- `lookup_dependency_stale`
- `lookup_dependency_fallback_requires_review`
- `noop_missing_explicit_decision`
- `noop_missing_checked_memory_refs`
- `noop_insufficient_evidence`
