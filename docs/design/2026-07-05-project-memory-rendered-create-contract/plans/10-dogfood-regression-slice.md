# Chunk 10: Dogfood Regression Slice

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `06-curator-writer-flow.md`, `07-independent-usefulness-critique.md`, `08-all-or-nothing-promotion-state.md`, `09-clean-rebootstrap-reset.md`
**Enables:** Step 7 maintenance planning

## Goal

Add integrated regression coverage and a documented dogfood acceptance slice proving the June 30 shallow Project Memory shape cannot pass, trusted content with pending retrieval stays separate from retrieval readiness, and clean reset preserves root memory continuity.

## Source Artifacts

- `../spec.md`: Testing Strategy and Planning Boundary Guidance.
- `../plan.md`: Verification Strategy.
- `docs/design/2026-06-30-project-memory-shape-creation-maintenance/dogfood-validation.md`
- `src/commands/project.ts`
- `src/project/project-memory-curator-service.ts`
- `tests/commands/project.test.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/query/project-memory-query-service.test.ts`

## Relationships

- **Depends on:** Full create flow, critique gate, promotion state, reset command.
- **Enables:** Step 7 auto-maintenance design can rely on a useful first-create baseline.
- **Shared contracts:** command-level JSON output for `project learn` and `project reset`.
- **Integration points:** Tests should use stubs/fixtures; real provider dogfood is documented as a manual acceptance command, not required for unit CI.

## File Responsibility Map

**Create:**
- `tests/project/project-memory-create-contract-regression.test.ts` - integrated contract regression fixtures.

**Modify:**
- `tests/commands/project.test.ts` - command-level JSON assertions for reset and learn outcomes if not already covered.
- `tests/project/project-memory-curator-service.test.ts` - pending retrieval/status separation assertions.
- `docs/design/2026-07-05-project-memory-rendered-create-contract/dogfood-acceptance.md` - manual dogfood checklist and expected JSON signals; update or verify the existing file if it already exists.

**Test:**
- `tests/query/project-memory-query-service.test.ts` - verify query hydration still returns canonical markdown refs/content after sectioned pages.

## Implementation Tasks

### Task 1: Add Failed-Dogfood Shape Regression

**Files:**
- Create: `tests/project/project-memory-create-contract-regression.test.ts`

- [ ] **Step 1: Build old role-shaped fixture**

Create a fixture that resembles the June 30 failure:

```ts
const oldRoleShapedCreateOutput = {
  schema_version: 1,
  project_key: "llm-wiki",
  mode: "create",
  packet_ref: { run_dir: "projects/llm-wiki/runs/project-learn/test-run", artifact: "input-packet.json", packet_schema_version: 1 },
  packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: null, max_content_chars: null } },
  summary: "Creates role pages.",
  explicit_noop_decisions: [],
  quality_diagnostics: trustedButOldRoleDiagnostics(),
  documentation_contract: validDocumentationContract(),
  brain_intent: { name: "llm-wiki", first_brain_summary: "Project Memory", untrusted_existing_markdown_policy: "rewrite" },
  pages: oldRolePagesWithBodyOnly(),
  state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
  evidence_refs: [{ kind: "repo_citation", ref: "docs/ROADMAP.md" }],
  repo_citations: [{ path: "docs/ROADMAP.md", line_start: 1, reason: "roadmap" }],
  risk: { level: "low", reasons: [], requires_quarantine: false },
};
```

The old pages should include `role`, `required_sections`, and `apply_payload.pages[].body`, not `answer_domains` or sectioned payloads.

- [ ] **Step 2: Assert rejection**

```ts
const result = validateCuratorOutput(packetFixtureForCreate(), oldRoleShapedCreateOutput);
expect(result.ok).toBe(false);
expect(result.quality_diagnostics?.content_quality.status).not.toBe("trusted");
expect(result.global_findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
  "creation_page_answer_domains_required",
]));
```

### Task 2: Assert Content Quality And Retrieval Readiness Separation

**Files:**
- Modify: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Trusted content can be pending retrieval**

Use a passing create output and a retrieval lifecycle stub that returns pending:

```ts
const service = new ProjectMemoryCuratorService(root, {
  retrievalLifecycle: {
    async afterProjectMemoryApply() {
      return {
        status: "pending",
        artifacts: {
          retrieval_sections: "project-memory-retrieval-sections.json",
          hint_generation: "project-memory-hint-generation-result.json",
          retrieval_index_result: "project-memory-retrieval-index-result.json",
        },
        degraded_reason: "mandatory Project Memory retrieval hint generation is pending",
      };
    },
  },
});

const result = await service.runProjectLearn(input);
expect(result.status).toBe("completed_with_pending_index");
expect(result.content_quality_status).toBe("trusted");
expect(result.retrieval_readiness_status).toBe("pending");
```

- [ ] **Step 2: Shallow content cannot become pending-index success**

Use shallow diagnostics and assert:

```ts
expect(result.status).toBe("needs_review");
expect(result.stopped_before_writes).toBe(true);
expect(result.content_quality_status).toBe("shallow");
```

### Task 3: Assert Query Hydration Still Uses Canonical Markdown

**Files:**
- Modify: `tests/query/project-memory-query-service.test.ts`

- [ ] **Step 1: Create sectioned markdown fixture**

Write a canonical wiki page with `## SQLite State`, index it through existing retrieval storage fixtures, and assert query hydration returns the markdown section content or a file ref to that section.

Expected assertion shape:

```ts
expect(result.results[0].source.path).toContain("projects/llm-wiki/wiki/storage-retrieval.md");
expect(result.results[0].content ?? "").toContain("state/memory.db");
```

Use the actual result property names in `ProjectMemoryQueryResult`.

### Task 4: Document Manual Dogfood Acceptance

**Files:**
- Modify or verify: `docs/design/2026-07-05-project-memory-rendered-create-contract/dogfood-acceptance.md`

- [ ] **Step 1: Add or update acceptance checklist**

```md
# Project Memory Create Dogfood Acceptance

## Preconditions

- Root `state/memory.db` exists when preserving Session Memory and candidates matters.
- The operator accepts deleting and recreating `projects/llm-wiki/`.

## Commands

1. `bun src/cli.ts project reset llm-wiki --clean --confirm llm-wiki --json`
   - Expected: JSON reports `reset_scope: "project_shell"` and `preserved_memory_db` ending in `state/memory.db`.
2. `bun src/cli.ts project learn llm-wiki --json`
   - Expected on success: `content_quality_status: "trusted"` and either `status: "completed"` or `status: "completed_with_pending_index"`.
   - Expected on insufficient docs: `status: "needs_review"` or `status: "failed"` and `stopped_before_writes: true`.
3. Inspect `projects/llm-wiki/runs/project-learn/<run>/project-memory-evidence-map.json`.
   - Expected: all required answer domains are present.
4. Inspect canonical wiki pages only when result content quality is trusted.
   - Expected: pages contain real `##` sections and repo citations.
```

## Verification

- Run: `bun test tests/project/project-memory-create-contract-regression.test.ts`
  - Expected: exits 0; June 30-style role-shaped output is rejected.
- Run: `bun test tests/project/project-memory-curator-service.test.ts`
  - Expected: exits 0; pending retrieval cannot mask shallow content.
- Run: `bun test tests/query/project-memory-query-service.test.ts`
  - Expected: exits 0; query hydration still points to canonical markdown sections.
- Run: `bun test tests/commands/project.test.ts`
  - Expected: exits 0; reset JSON contract is covered.
- Run: `bun test`
  - Expected: exits 0 for the full suite.
- Run: `bun run typecheck`
  - Expected: exits 0.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- June 30 shallow role-shaped output cannot pass.
- Trusted content with pending retrieval remains distinct from retrieval readiness.
- Clean reset preserves `state/memory.db`.
- Existing query hydration still resolves canonical markdown sections.

## Risks And Rollback

- Risk: real provider dogfood may be non-deterministic. Keep unit/integration tests deterministic and document manual dogfood separately.
- Rollback: remove the regression test and acceptance doc only if they block unrelated implementation; do not remove contract tests that protect the product failure.

## Non-Goals

- No Step 7 maintenance automation.
- No MCP tool exposure.
- No practice or personal memory work.

## Type And Name Consistency

Before finishing, verify test fixture field names match the final create schema from chunk 05 and command names match chunk 09.
