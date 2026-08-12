# CreationDocumentationFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Intended Destination

Likely touches:

- `src/project/project-memory-prompt-budget.ts`
- `src/project/project-memory-curator-output-schema.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-curator-service.ts`

## Owns

- First-create Project Memory flow from repo orientation through trusted curated state.
- Documentation role coverage requirements.
- Creation-mode diagnostics for inspected surfaces, missing coverage, shallow summaries, and citation coverage.

## Does Not Own

- Provider invocation mechanics beyond prompt/contract requirements.
- Maintenance section targeting.
- Retrieval query answer synthesis.
- Practice/Personal Memory promotion.

## Inputs

- `ProjectMemoryPacket` in create mode.
- `curator-output-contract.json` for creation mode.
- Deterministic default orientation surfaces.
- Curator-added repo surfaces, with justification.
- Existing untrusted wiki markdown, if present.
- Pending project candidates/handoffs and selected Session Memory as leads.

## Output Shape

Curator creation output should still conceptually resemble `ProjectMemoryCreationDraft`, but with documentation-contract fields added or derived:

```text
creation_draft:
  pages:
    - id
      target
      title
      purpose
      role: orientation_index | product_memory_model | runtime_workflows | architecture_data_flow | current_work_roadmap | decisions_terms
      required_sections
      inspected_surface_refs
      apply_payload.pages[one page]
      evidence_refs
      repo_citations
  documentation_contract:
    role_coverage
    inspected_default_surfaces
    curator_added_surfaces
    missing_coverage
    shallow_summary_findings
  state_intent:
    mark_project_memory_curated: true only if content quality is trusted
```

## Flow

1. Prepare create-mode packet.
2. Prepare artifact-reference prompt and output schema.
3. Prompt tells curator:
   - read packet artifact;
   - read contract artifact;
   - inspect deterministic orientation surfaces;
   - add repo surfaces only when justified;
   - treat Session Memory, candidates, and handoffs as leads, not direct truth;
   - produce documentation-role pages with direct repo citations.
4. Provider returns structured creation draft.
5. Structural validator checks:
   - schema shape;
   - safe wiki targets;
   - one apply payload page per page draft;
   - evidence refs;
   - direct repo citations where required;
   - protected state assignments.
6. Documentation quality validator checks:
   - every required page role is covered;
   - every required role has enough sections;
   - pages are not shallow summaries;
   - repo-groundable claims have citations;
   - candidates/handoffs are disposed or traced;
   - default orientation surfaces were inspected or explicitly explained.
7. Content quality decision:
   - trusted: allow apply;
   - review_only/shallow/blocked: stop before canonical curated-state write.
8. Apply trusted markdown pages through deterministic applier.
9. Write `project-memory.json` as curated only after trusted content is promoted.
10. Run post-apply retrieval lifecycle.
11. Terminal result uses content quality plus retrieval readiness:
   - trusted + retrieval ready => completed;
   - trusted + retrieval pending/degraded => completed_with_pending_index;
   - not trusted => needs_review;
   - infrastructure failure => failed.

## Terminal States

- `completed`: trusted Project Memory markdown created and retrieval ready enough for the terminal path.
- `completed_with_pending_index`: trusted Project Memory markdown created, derived retrieval pending or degraded.
- `needs_review`: valid or partially useful output exists but content quality is not trusted.
- `failed`: provider/runtime/schema/reconciliation/packet failure prevents useful review or apply.

## Idempotency

- Existing curated Project Memory should skip creation apply or force maintenance mode.
- Review-only/shallow drafts stay in run artifacts and can be superseded by a later create run.
- Trusted apply continues to use apply journals for recovery.

## Failure Posture

- Missing orientation diagnostics should fail content quality, not be hidden as low confidence.
- Missing repo citations for repo-groundable creation pages should remain blocker.
- Shallow page role coverage should stop before `project-memory.json` is marked curated.

## Review Points

- Exact minimum section counts per role remain planning work.
- Exact default orientation manifest may start from existing prompt defaults but should include repo-specific additions for `llm-wiki` such as `MYELIN.md`, `CONTEXT.md`, and relevant design/ADR surfaces.
- Decide later whether page roles are explicit schema fields or inferred by validator from targets/sections.
