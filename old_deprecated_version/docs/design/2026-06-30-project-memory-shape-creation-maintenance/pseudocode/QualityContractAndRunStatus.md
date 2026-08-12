# QualityContractAndRunStatus

Pseudocode artifact. Non-executable reference shape for planning.

## Intended Destination

Likely touches:

- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-output-schema.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-curator-service.ts`
- run artifacts such as `curator-validation.json`, `curator-run-result.json`, and `summary.md`
- project state under `projects/<key>/state/project-memory.json`

## Owns

- The Project Memory Documentation Contract as a machine-checkable publication/preservation bar.
- The distinction between content quality and retrieval readiness.
- Result vocabulary that prevents shallow content from being reported as curated or `completed_with_pending_index`.
- Diagnostics that explain why content is trusted, review-only, shallow, or rejected.

## Does Not Own

- The actual markdown rendering mechanics.
- Retrieval hint generation or vector indexing.
- Candidate/handoff queue lifecycle.
- Exact prose content of generated wiki pages.
- Practice or Personal Memory quality states.

## Draft Status Vocabulary

Content quality axis:

- `trusted`: satisfies the Project Memory Documentation Contract and may become curated Project Memory.
- `review_only`: structurally valid and potentially useful, but not safe for auto-curation.
- `shallow`: mechanically valid but fails role depth, section coverage, or useful-documentation checks.
- `blocked`: cannot be evaluated because required evidence, orientation, schema context, or packet context is missing.

Retrieval readiness axis:

- `ready`: section extraction, hint generation, and retrieval indexing are usable.
- `pending`: canonical markdown is trusted, but derived retrieval work is incomplete.
- `degraded`: canonical markdown is trusted, but derived retrieval work failed or is unavailable with a recorded reason.
- `not_applicable`: no canonical markdown was applied or the run stopped before writes.

Run status relationship:

- `completed`: content quality is `trusted` and retrieval readiness is `ready` or not required for this terminal path.
- `completed_with_pending_index`: content quality is `trusted` and retrieval readiness is `pending` or `degraded`.
- `needs_review`: content quality is `review_only`, `shallow`, or validation produced non-auto-applicable results.
- `failed`: infrastructure, provider, schema context, reconciliation, or blocking packet failure prevents a trustworthy decision.

Important invariant:

- `completed_with_pending_index` must never mean "content is shallow but retrieval is pending." It only means "content is trusted, derived retrieval is not fully ready."

## Draft Contract Shape

Conceptual fields for validation/run artifacts:

```text
quality_diagnostics:
  schema_version: 1
  content_quality:
    status: trusted | review_only | shallow | blocked
    reasons: string[]
    role_coverage: role -> satisfied | missing | shallow
    section_coverage: role -> sections_seen / minimum_required
    citation_coverage: page_or_section_ref -> sufficient | insufficient | inference_only
    candidate_dispositions: source_ref -> applied | already_trusted | not_durable | other_layer | insufficient_evidence | missing_coverage
  retrieval_readiness:
    status: ready | pending | degraded | not_applicable
    artifacts: retrieval_sections?, hint_generation?, retrieval_index_result?
    reason?: string
```

## Validation Relationship

- Existing structural validation still runs first: schema shape, safe paths, provenance refs, repo citations, apply payload shape, lifecycle validity.
- Documentation quality validation runs before auto-apply eligibility.
- Auto-apply can proceed only when structural validation is ok and `content_quality.status == trusted`.
- If structural validation is ok but `content_quality.status != trusted`, the run stops before canonical curated-state writes and records review diagnostics.
- Retrieval readiness is evaluated only after trusted content is applied.

## State Persistence Shape

Project state should record that Project Memory is curated only after content quality passes.

Conceptual curated state:

```text
project-memory.json:
  project_key
  source_run_dir
  status: curated
  content_quality:
    status: trusted
    checked_at
    contract_version
  retrieval_readiness:
    status: ready | pending | degraded
    checked_at
    reason?
```

Review-only or shallow output should stay in run artifacts, not mark `project-memory.json` as curated.

## Idempotency And Recovery Posture

- Re-running after review-only/shallow output should not require recovery because no canonical curated state was promoted.
- Re-running after trusted apply with pending retrieval should preserve canonical markdown and allow retrieval repair/indexing to continue.
- Existing apply journal recovery remains responsible for partial canonical write recovery.

## Failure Posture

- Quality evaluation failure caused by malformed diagnostics is a blocker.
- Quality evaluation finding shallow content is not infrastructure failure; it is a non-curated `needs_review` terminal path.
- Retrieval lifecycle failure after trusted apply is not content failure; it becomes pending/degraded retrieval readiness.

## Review Points

- Exact enum names can change, but the two-axis model should remain.
- Decide during planning whether `review_only` and `shallow` are separate stored states or separate reason codes under one review state.
- Decide whether `quality_diagnostics` belongs inside existing `curator-validation.json`, a new run artifact, or both.
