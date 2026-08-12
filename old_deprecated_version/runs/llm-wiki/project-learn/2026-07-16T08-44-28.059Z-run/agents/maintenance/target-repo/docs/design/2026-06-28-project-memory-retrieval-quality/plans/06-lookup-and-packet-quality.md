# Chunk 06: Lookup And Packet Quality

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Completed  
**Depends on:** `01-retrieval-contracts-and-run-status.md`, `02-markdown-section-manifest.md`, `03-retrieval-storage-and-vector-state.md`, `05-indexer-and-status-command.md`  
**Enables:** `07-curator-evidence-and-scoped-gating.md`, `09-project-learn-lifecycle-and-dogfood.md`

## Goal

Replace the current page-only Project Memory lookup degradation path with a lookup service that prefers indexed section retrieval, falls back to deterministic markdown search with typed quality metadata, and exposes packet-level lookup quality summaries. This chunk changes packet construction and lookup output shape but does not yet change validator/apply gating.

## Source Artifacts

- `../spec.md`: Lookup Quality And Apply Gating, Packet And Evidence Contract
- `../agenda.md`: Question 1, Question 3, Question 5
- `../pseudocode/ProjectMemoryLookupIntegration.ts`
- `../pseudocode/ProjectMemoryRetrievalContracts.ts`
- `../../../../src/project/project-memory-lookup.ts`
- `../../../../src/project/project-memory-packet.ts`
- `../../../../src/project/project-memory-prompt-budget.ts`
- `../../../../tests/project/project-memory-packet.test.ts`
- `../../../../tests/project/project-memory-prompt-budget.test.ts`

## Relationships

- **Depends on:** retrieval contracts, section extraction, storage/vector helpers, indexer/status foundations.
- **Enables:** validator can apply scoped gating based on lookup quality and dependencies.
- **Shared contracts:** `ProjectMemoryLookupResult`, `ProjectMemoryLookupQualitySummary`, packet `lookup.quality_summary`.
- **Integration points:** packet prompt budgeting, curator packet artifact, tests that currently expect markdown fallback degradation.

## File Responsibility Map

**Modify:**

- `src/project/project-memory-lookup.ts` - adapt current markdown lookup into fallback lookup with typed quality fields and section-compatible hits.
- `src/project/project-memory-packet.ts` - store lookup queries, typed results, and quality summary; keep compatibility `degraded` fields derived from blocking reasons only.
- `src/project/project-memory-prompt-budget.ts` - preserve budget trimming against the updated packet shape.

**Create:**

- `tests/project/project-memory-lookup.test.ts` - focused lookup service tests for fallback and indexed-store injection.

**Test:**

- `tests/project/project-memory-packet.test.ts`
- `tests/project/project-memory-prompt-budget.test.ts`
- `tests/project/project-memory-lookup.test.ts`

## Implementation Tasks

### Task 1: Add lookup tests for fallback quality

**Files:**

- Create: `tests/project/project-memory-lookup.test.ts`
- Modify: `src/project/project-memory-lookup.ts`

- [ ] **Step 1: Write fallback lookup tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupProjectMemory } from "../../src/project/project-memory-lookup.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pm-lookup-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("markdown fallback lookup reports fallback quality without packet-wide blocking severity", async () => {
  await mkdir(join(root, "projects", "demo", "wiki", "architecture"), { recursive: true });
  await writeFile(
    join(root, "projects", "demo", "wiki", "architecture", "ranking.md"),
    "# Ranking\n\nProposal ranking uses deterministic impact scoring.\n",
    "utf8",
  );

  const result = await lookupProjectMemory(root, "demo", "proposal ranking", {
    source_kind: "project_candidate",
    source_id: "cand_1",
    mode: "create",
    limit: 5,
    allow_fallback: true,
  });

  expect(result.lookup_quality).toBe("fallback");
  expect(result.lookup_freshness).toBe("not_applicable");
  expect(result.apply_severity).toBe("advisory");
  expect(result.hits[0]?.canonical_ref?.wiki_path).toBe("wiki/architecture/ranking.md");
  expect(result.degraded_reason).toContain("fallback markdown search");
});
```

- [ ] **Step 2: Run lookup test**

Run: `rtk bun test tests/project/project-memory-lookup.test.ts`  
Expected: fails because `lookupProjectMemory` still returns the legacy shape.

### Task 2: Adapt markdown fallback lookup shape

**Files:**

- Modify: `src/project/project-memory-lookup.ts`

- [ ] **Step 1: Update input and result compatibility**

Keep `loadProjectMemoryCorpus` available because packet construction and tests use it. Change `lookupProjectMemory` to accept the new metadata input while preserving optional pages/search text injection.

```ts
export type LookupProjectMemoryInput = {
  pages?: ProjectMemoryPage[];
  searchTextByPath?: Record<string, string>;
  limit?: number;
  source_kind?: ProjectMemoryLookupSourceKind;
  source_id?: string;
  mode?: "create" | "maintain";
  allow_fallback?: boolean;
};
```

Return `ProjectMemoryLookupResult` from `project-memory-retrieval-contracts.ts`. For fallback results:

```ts
return {
  id: lookupResultId(input.source_kind ?? "manual", input.source_id ?? "manual", query),
  query,
  source_kind: input.source_kind ?? "manual",
  source_id: input.source_id ?? "manual",
  retrieval_method: "fallback_markdown_search",
  lookup_quality: "fallback",
  lookup_freshness: "not_applicable",
  apply_severity: (input.mode ?? "create") === "maintain" ? "proposal_scoped" : "advisory",
  degraded_reason: "Project Memory lookup used fallback markdown search; derived metadata/vector indexes were unavailable or not selected.",
  hits,
  source_tools: ["project-memory-markdown-scan"],
};
```

- [ ] **Step 2: Map legacy matches to hits**

Fallback hits must include canonical refs when possible.

```ts
function fallbackHitFor(match: ProjectMemoryLookupMatch, projectKey: string, index: number): ProjectMemoryLookupHit {
  return {
    id: `hit:${index}`,
    canonical_ref: {
      project_key: projectKey,
      wiki_path: match.path,
      category: categoryFor(match.path),
      page_title: match.title,
      section_id: pageSectionId(match.path, match.title),
      heading_path: [match.title],
      section_hash: "sha256:unknown-fallback",
    },
    score: match.score,
    snippet: match.snippet,
    matched_terms: match.matched_terms,
    source_components: {
      structural_text: false,
      retrieval_hints: false,
      fallback_text: true,
    },
    freshness: "not_applicable",
  };
}
```

Chunk 2 section extraction can later replace `section_hash: "sha256:unknown-fallback"` for fallback hits when the extractor is available in this module. If implemented now, use actual section extraction and section hashes.

- [ ] **Step 3: Run lookup test**

Run: `rtk bun test tests/project/project-memory-lookup.test.ts`  
Expected: passes.

### Task 3: Add packet quality summary

**Files:**

- Modify: `src/project/project-memory-packet.ts`
- Test: `tests/project/project-memory-packet.test.ts`

- [ ] **Step 1: Update packet test expectations**

Change the existing deterministic lookup test so it expects fallback quality rather than packet-wide degraded reason.

```ts
expect(packet.lookup.results.every((result) => result.lookup_quality === "fallback")).toBe(true);
expect(packet.lookup.quality_summary.blocking).toBe(false);
expect(packet.lookup.quality_summary.advisory_reasons).toEqual(
  expect.arrayContaining([expect.stringContaining("fallback markdown search")]),
);
expect(packet.degraded).toBe(false);
expect(packet.degraded_reasons).not.toContain(
  "Project Memory lookup is markdown text search only; derived metadata/vector indexes are not implemented.",
);
```

Keep the memory DB missing test expecting packet degraded because missing pending/session inputs are still blocking context for the packet.

- [ ] **Step 2: Extend packet lookup block**

Update packet type:

```ts
lookup: {
  queries: PacketLookupQuery[];
  results: ProjectMemoryLookupResult[];
  quality_summary: ProjectMemoryLookupQualitySummary;
};
```

Build summary:

```ts
function summarizeLookupQuality(results: ProjectMemoryLookupResult[]): ProjectMemoryLookupQualitySummary {
  return {
    blocking: results.some((result) => result.apply_severity === "blocking"),
    blocking_reasons: uniqueReasons(results.filter((result) => result.apply_severity === "blocking")),
    advisory_reasons: uniqueReasons(results.filter((result) => result.apply_severity === "advisory")),
    proposal_scoped_result_ids: results
      .filter((result) => result.apply_severity === "proposal_scoped")
      .map((result) => result.id),
  };
}
```

Set compatibility fields:

```ts
const lookupQuality = summarizeLookupQuality(results);
const blockingDegradedReasons = [
  ...memoryInputs.degradedReasons,
  ...lookupQuality.blocking_reasons,
];
```

The packet remains degraded when memory input availability is degraded or lookup summary is blocking. Advisory fallback reasons stay in `lookup.quality_summary.advisory_reasons`, not `packet.degraded_reasons`.

- [ ] **Step 3: Pass lookup metadata from queries**

When calling lookup:

```ts
const result = await lookupProjectMemory(root, projectKey, query.query, {
  pages,
  searchTextByPath: corpus.search_text_by_path,
  limit: options.lookupLimit ?? DEFAULT_LOOKUP_LIMIT,
  source_kind: query.source_kind,
  source_id: query.source_id,
  mode: packetMode(state.bootstrap_state, state.project_memory),
  allow_fallback: true,
});
```

- [ ] **Step 4: Run packet tests**

Run: `rtk bun test tests/project/project-memory-packet.test.ts`  
Expected: passes with new quality summary expectations.

### Task 4: Preserve prompt budgeting

**Files:**

- Modify: `src/project/project-memory-prompt-budget.ts`
- Test: `tests/project/project-memory-prompt-budget.test.ts`

- [ ] **Step 1: Update budget trimming for lookup quality summary**

If `adjustedPacket` currently injects degraded reasons, keep that behavior for true prompt-budget degradation. Do not add fallback advisory reasons to `packet.degraded_reasons`.

```ts
function adjustedPacket(packet: ProjectMemoryPacket, degradedReason: string | null): ProjectMemoryPacket {
  if (!degradedReason) return packet;
  return {
    ...packet,
    degraded: true,
    degraded_reasons: [...new Set([...packet.degraded_reasons, degradedReason])].sort(),
  };
}
```

- [ ] **Step 2: Update tests that search degraded reasons**

Prompt-budget tests should assert prompt-budget degradation remains packet-level while fallback lookup quality lives under `packet.lookup.quality_summary`.

- [ ] **Step 3: Run prompt budget tests**

Run: `rtk bun test tests/project/project-memory-prompt-budget.test.ts`  
Expected: passes.

## Verification

- `rtk bun test tests/project/project-memory-lookup.test.ts tests/project/project-memory-packet.test.ts tests/project/project-memory-prompt-budget.test.ts`  
  Expected: passes.
- `rtk bun run typecheck`  
  Expected: passes.

## Acceptance Criteria Covered

- Markdown fallback reports `lookup_quality: fallback`.
- Fallback lookup alone no longer makes `packet.degraded` true.
- Packet contains lookup quality summary for advisory, proposal-scoped, and blocking retrieval states.
- Prompt budgeting still reports actual packet degradation when prompt size reduction fails.

## Risks And Rollback

- Risk: old tests may lose safety around missing memory DB. Mitigation: keep memory input degradation packet-level.
- Risk: fallback canonical refs use page-level section placeholders. Mitigation: prefer chunk 2 section extraction if feasible; otherwise keep placeholders clearly marked as fallback with `not_applicable` freshness.
- Rollback: restore legacy lookup result shape and packet degraded aggregation. No data migrations are changed in this chunk.

## Non-Goals

- No validator scoped gating.
- No explicit no-op validation.
- No live vector lookup if storage/indexer is not ready.
- No hint generation.

## Type And Name Consistency

Verify these names are exact:

- `lookup.quality_summary`
- `ProjectMemoryLookupQualitySummary`
- `fallback_markdown_search`
- `lookup_quality: "fallback"`
- `apply_severity: "advisory"`
- `apply_severity: "proposal_scoped"`
