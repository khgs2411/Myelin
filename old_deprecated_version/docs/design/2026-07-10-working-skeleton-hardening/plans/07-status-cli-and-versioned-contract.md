# Chunk 07: Status CLI And `myelin.status.v1`

**Plan Set:** ../plan.md
**Approved Source:** ../spec.md
**Status:** Ready for Review
**Depends on:** Chunk 06
**Enables:** Chunk 08

## Goal

Expose the normalized operational model through a compact human status view and the exact `myelin.status.v1` JSON contract. Remove the legacy shallow facade fields, keep human/JSON facts aligned, and return nonzero only when a trustworthy contract cannot be constructed.

## Source Artifacts And Constraints

- The public shape is exactly `ProjectOperationalStatusV1` in `../spec.md`.
- Remove, do not nest or alias, `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools`.
- Machine evidence paths are absolute; checkout evidence paths are relative to Myelin root.
- Human and JSON output derive from the same normalized result; neither recomputes health.
- Successfully observed `attention` or `blocked` exits 0.
- Invalid invocation, unresolved installation/project identity, or failure before a trustworthy contract exists exits nonzero.
- Step 12 may add a future optional semantic/briefing section, but this chunk adds none.

## Relationships

- Consumes the pure result model from Chunk 06 without changing its inspection rules.
- Freezes the public fixtures and renderer used in Chunk 08 end-to-end acceptance.
- Does not modify installer, hooks, or workers.

## File Responsibility Map

### Create

- `src/status/status-renderer.ts` — compact human renderer from the normalized status result.
- `src/status/status-v1.ts` — exact `myelin.status.v1` public type and serialization boundary.
- `tests/fixtures/status/healthy.json`
- `tests/fixtures/status/blocked.json`
- `tests/status/status-renderer.test.ts`
- `tests/status/status-v1.test.ts`

### Modify

- `src/commands/status.ts` — project resolution provenance, `--json` selection, rendering, serialization, and exit semantics.
- `tests/commands/status.test.ts`
- `tests/status/status-service.test.ts` — remove legacy response assertions and consume the normalized model where still applicable.

### Test

- `tests/status/status-v1.test.ts`
- `tests/status/status-renderer.test.ts`
- `tests/commands/status.test.ts`
- `tests/status/operational-status-service.test.ts`

## Behavioral And Contract Changes

- JSON owns exact top-level fields: `contract_version`, `kind`, `generated_at`, `overall_state`, `project`, `installation`, `session_memory`, `project_memory`, `warnings`, `actions`, and `evidence`.
- Section shapes, nested counts, provider records, lock values, warnings, actions, evidence kinds, and project `resolved_from` match the approved type exactly.
- Lifecycle strings come only from Chunk 06 normalization; serialization does not expose raw storage statuses opportunistically.
- Fixtures represent the approved healthy and blocked examples with deterministic time/path/process inputs.
- Human view identifies project and overall state, then compact installation/Session/Project sections, warnings, evidence-relevant paths, and exact suggested commands.
- JSON and human renderings contain the same warnings/actions/counts/states even though presentation differs.
- Source invocation without machine install may render installation `not_installed` as attention; invalid recorded ownership remains blocked.

## Implementation Tasks

- [ ] Add exact-key/type fixture tests before replacing the shallow response.
- [ ] Add a forbidden-key assertion recursively or at the top-level boundary for all eight removed legacy fields.
- [ ] Define the public V1 type separately from internal inspectors and implement an explicit serializer.
- [ ] Normalize evidence ordering and generated time through injected deterministic inputs so fixtures are stable.
- [ ] Implement healthy and blocked fixtures from the approved examples, including provider, lock, warning, action, and evidence path conventions.
- [ ] Implement the human renderer from the same V1-ready normalized object.
- [ ] Add parity tests comparing all operational facts represented in human output with their JSON source.
- [ ] Update `src/commands/status.ts` for argument/cwd provenance and error boundaries.
- [ ] Add CLI tests for healthy, attention, blocked, unresolved project, invalid installation, malformed optional state reported inside a contract, and inspector construction failure.
- [ ] Assert attention/blocked contracts exit 0 and only pre-contract failures exit nonzero.
- [ ] Remove all legacy shallow field construction and assertions.

## Verification

- `bun test tests/status/status-v1.test.ts tests/status/status-renderer.test.ts tests/status/operational-status-service.test.ts tests/commands/status.test.ts`
  - Expected: exact fixtures, parity, removed fields, and exit-code cases pass.
- `rg -n "answer|confidence|memory_scope|citations|candidate_ids|degraded_reason|source_tools" src/status src/commands/status.ts tests/status tests/commands/status.test.ts`
  - Expected: no legacy public-field construction remains; fixture assertions may mention them only to prove absence.
- `bun run typecheck`
  - Expected: public serialization satisfies the exact V1 type.
- `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- `myelin status [project-key]` is a coherent human operational view.
- `--json` returns the exact versioned `myelin.status.v1` contract.
- Human and JSON output agree on health facts.
- Legacy shallow fields are removed.
- Observed blocked/attention status exits 0; construction failure exits nonzero.

## Risks, Rollback, And Isolation

- This is an intentional breaking JSON change. Exact fixtures and forbidden-key tests are the rollback guard.
- Human output can accidentally omit actionable facts. Parity tests should compare normalized warnings/actions/states, not brittle whitespace alone.
- Rollback affects only presentation/public response code; inspector state remains untouched.

## Non-Goals

- Changing inspection or severity policy from Chunk 06.
- Automatic remediation or nonzero exit for operational degradation.
- Current Briefing, query answers, or MCP tool contracts.
- Installer or background-process changes.

## Consistency Check

- Implements the approved V1 contract and explicit removal list exactly.
- Keeps one source of truth for human and JSON output.
- Preserves the Step 12 extension seam without implementing Step 12.
