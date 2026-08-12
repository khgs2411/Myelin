# Chunk 08: Docs Validation And Source Set

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-embedding-config-contract.md` through `07-session-memory-query-facade.md`
**Enables:** Execution handoff and later MCP/query design

## Goal

Align documentation, configuration notes, and source-set references after implementation, then run full repo validation. This chunk adds no new product behavior.

## Source Artifacts

- `../spec.md`
- `../agenda.md`
- `../plan.md`
- `../../../CONTEXT.md`
- `../../../AGENTS.md`
- `.tasks/06-retrieval-and-indexing/embedding-provider.md`
- `.tasks/06-retrieval-and-indexing/vector-indexer.md`
- `.tasks/05-semantic-interface/query-facade.md`

## Relationships

- **Depends on:** All behavior chunks complete.
- **Enables:** clean handoff to execution acceptance or later MCP/query planning.
- **Shared contracts:** documented config keys, command name, out-of-scope deferrals.
- **Integration points:** docs only.

## File Responsibility Map

**Modify as needed:**
- `AGENTS.md` - ensure embedding config keys and command vocabulary are documented.
- `myelin.config` - ensure commented embedding defaults are present.
- `docs/design/2026-06-13-session-memory-embedding-index/plan.md` - update status if chunk plans are complete.
- `.tasks/06-retrieval-and-indexing/embedding-provider.md` - mark implementation evidence only if repo conventions support updating `.tasks`.
- `.tasks/06-retrieval-and-indexing/vector-indexer.md` - mark implementation evidence only if repo conventions support updating `.tasks`.
- `.tasks/05-semantic-interface/query-facade.md` - preserve broader scope and note internal Session Memory facade if appropriate.

## Implementation Tasks

### Task 1: Align Docs With Implemented Contracts

- [ ] **Step 1: Verify documented config keys**

Confirm docs mention:

```text
EMBEDDING_PROVIDER
EMBEDDING_GEMINI_MODEL
EMBEDDING_DIMENSIONS
EMBEDDING_STUB_RESPONSES_DIR
GEMINI_API_KEY
```

- [ ] **Step 2: Verify command name**

Confirm `myelin memory index session <project-key> [--limit N] [--retry-failed] [--json]` is documented wherever command vocabulary is listed.

- [ ] **Step 3: Preserve deferrals**

Docs must state:

- no MCP tool exposure in this plan set
- no Current Briefing integration in this plan set
- no broader `memory query` redesign
- no Project/Practice/Personal Memory vectorization

### Task 2: Update Roadmap Status

- [ ] **Step 1: Update `../plan.md`**

After chunk files exist and have passed self-review, set:

```md
**Status:** Chunk Plans Written
```

and ensure the chunk table links use `plans/NN-*.md`.

### Task 3: Full Validation

- [ ] **Step 1: Run full test suite**

Run: `rtk bun test`

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run: `rtk bun run typecheck`

Expected: exits 0.

- [ ] **Step 3: Run whitespace check**

Run: `rtk git diff --check`

Expected: no whitespace errors.

## Verification

- Run: `rtk bun test`
  - Expected: all tests pass.
- Run: `rtk bun run typecheck`
  - Expected: exits 0.
- Run: `rtk git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Docs reflect implemented config and command contracts.
- Explicit deferrals remain visible.
- Full repo validation passes.

## Risks And Rollback

- Risk: `.tasks` files are roadmap notes rather than status ledgers. Mitigation: update only if the implementation pattern already supports it; otherwise leave them unchanged and document completion in design artifacts.
- Rollback: docs-only edits can be reverted independently from behavior chunks.

## Non-Goals

- No behavior changes.
- No MCP exposure.
- No Current Briefing integration.
- No new chunk scope.

## Type And Name Consistency

Use the same command/config/function names introduced by Chunks 01 through 07. Do not rename contracts in docs during final validation.
