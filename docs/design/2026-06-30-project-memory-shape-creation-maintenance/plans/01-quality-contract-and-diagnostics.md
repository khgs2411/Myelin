# Chunk 01: Quality Contract And Diagnostics

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `02-create-mode-documentation-contract.md`, `03-section-targeting-foundation.md`, `04-producer-boundary-and-packet-prioritization.md`, `05-maintain-mode-section-first-apply.md`, `07-dogfood-reset-and-validation.md`

## Goal

Add the shared Project Memory Documentation Contract, content-quality and retrieval-readiness vocabulary, deterministic quality diagnostics, and run/state status mapping used by later creation and maintenance work. This chunk defines the contract and applies it to terminal run decisions without changing create-mode role enforcement or section-first maintenance behavior yet.

## Source Artifacts

- `../spec.md`: `Publication Quality States`, `Creation Quality Bar`, and `Testing Strategy`.
- `../agenda.md`: Question 1, Question 6, and External Audit recommendations.
- `../pseudocode/QualityContractAndRunStatus.md`.
- `../../../../CONTEXT.md`: `Project Memory Documentation Contract`, `Project Memory Content Quality State`.
- ADRs: `docs/adr/0021-keep-curated-project-memory-in-markdown.md`, `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`, `docs/adr/0059-use-structured-project-memory-apply-payloads.md`, `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`.
- Current code: `src/project/project-memory-curator-contracts.ts`, `src/project/project-memory-curator-output-schema.ts`, `src/project/project-memory-curator-validator.ts`, `src/project/project-memory-curator-service.ts`, `src/project/project-memory-markdown-applier.ts`.
- Tests: `tests/project/project-memory-curator-contracts.test.ts`, `tests/project/project-memory-curator-output-schema.test.ts`, `tests/project/project-memory-curator-validator.test.ts`, `tests/project/project-memory-curator-service.test.ts`.

## Relationships

- **Depends on:** Current structured curator output and validator plumbing.
- **Enables:** Creation and maintenance chunks can depend on `quality_diagnostics` and `content_quality.status`.
- **Shared contracts:** `ProjectMemoryQualityDiagnostics`, `ProjectMemoryContentQualityStatus`, `ProjectMemoryRetrievalReadinessStatus`, `ProjectMemoryDocumentationRole`, `ProjectMemoryCandidateDisposition`.
- **Integration points:** Curator output schema, validator result, run result artifacts, `project-memory.json` state written by the applier.

## Resolved Decisions For Execution

- **Diagnostics placement:** full `quality_diagnostics` is persisted in `curator-validation.json`. `curator-run-result.json` stores `content_quality_status`, `retrieval_readiness_status`, and `quality_diagnostics_ref: "curator-validation.json"`. `projects/<key>/state/project-memory.json` persists only trusted canonical state: `content_quality.status: "trusted"` and current retrieval readiness after apply.
- **Curator versus Myelin precedence:** curator-supplied diagnostics are advisory input. Myelin recomputes deterministic diagnostics during validation and the computed result is authoritative for auto-apply and run status. If curator diagnostics are missing or contradict computed blockers, validation records both the mismatch and the computed status.
- **Create-mode trusted threshold:** all six roles are present; each role has at least two required sections and one direct repo citation; no present default orientation surface is uninspected; every project candidate/handoff lead has a disposition; no deterministic shallow-summary finding exists; no missing coverage string exists.
- **Maintenance trusted threshold:** every eligible write has supported target ownership, repo citation or explicit inference, supported candidate disposition, no stale section target, no missing coverage without grounded write, and no broad rewrite. Maintenance does not require all six create roles to be restated.
- **Status rules:** `trusted` means all deterministic checks pass. `shallow` means structurally valid output fails role depth, citation, shallow-summary, or missing-coverage checks. `review_only` means structurally valid output may be useful but is not auto-applicable because of risk, conflict, unsupported no-op, degraded lookup dependency, or human-review-only disposition. `blocked` means quality cannot be evaluated because diagnostics, packet evidence, schema context, or required target state is missing or malformed.
- **Shallow-summary checks:** deterministic checks flag pages/sections with fewer than two body paragraphs, fewer than one citation for a repo-groundable role, body text that only repeats the title/purpose, or role sections whose combined body text is below 300 non-whitespace characters. Model-authored `shallow_summary_findings` can add reasons, but cannot override deterministic results.

## File Responsibility Map

**Create:**
- `src/project/project-memory-quality-contract.ts` - owns role names, deterministic thresholds, diagnostics types, and base evaluators.
- `tests/project/project-memory-quality-contract.test.ts` - verifies deterministic status decisions and no shallow content can become trusted.

**Modify:**
- `src/project/project-memory-curator-contracts.ts` - imports or re-exports shared quality types and adds `quality_diagnostics` to validation/run types.
- `src/project/project-memory-curator-output-schema.ts` - adds `documentation_contract` and `quality_diagnostics` schema fields shared by create and maintain modes.
- `src/project/project-memory-curator-validator.ts` - attaches quality diagnostics to validation results and treats non-trusted quality as non-auto-applicable.
- `src/project/project-memory-curator-service.ts` - uses quality diagnostics when mapping validation to run status.
- `src/project/project-memory-markdown-applier.ts` - persists trusted content quality metadata in `project-memory.json` when creation applies.

**Test:**
- `tests/project/project-memory-curator-contracts.test.ts` - contract constants and status vocabulary.
- `tests/project/project-memory-curator-output-schema.test.ts` - schema requires quality diagnostics.
- `tests/project/project-memory-curator-validator.test.ts` - quality gate blocks shallow outputs.
- `tests/project/project-memory-curator-service.test.ts` - shallow output returns `needs_review`, trusted output with degraded retrieval may return `completed_with_pending_index`.

## Implementation Tasks

### Task 1: Add shared quality contract types

**Files:**
- Create: `src/project/project-memory-quality-contract.ts`
- Modify: `src/project/project-memory-curator-contracts.ts`
- Test: `tests/project/project-memory-quality-contract.test.ts`

- [ ] **Step 1: Add failing tests for deterministic status classification**

```ts
import { describe, expect, test } from "bun:test";
import {
  evaluateProjectMemoryQuality,
  PROJECT_MEMORY_DOCUMENTATION_ROLES,
} from "../../src/project/project-memory-quality-contract.ts";

describe("Project Memory quality contract", () => {
  test("requires the six default documentation roles before trusted quality", () => {
    const result = evaluateProjectMemoryQuality({
      mode: "create",
      role_coverage: PROJECT_MEMORY_DOCUMENTATION_ROLES.filter((role) => role !== "decisions_terms").map((role) => ({
        role,
        page_ref: `${role}.md`,
        sections_seen: 2,
        citations_seen: 2,
        body_chars_seen: 500,
      })),
      candidate_dispositions: [],
      shallow_summary_findings: [],
      missing_coverage: [],
      blocked_reasons: [],
      review_reasons: [],
    });

    expect(result.content_quality.status).toBe("shallow");
    expect(result.content_quality.reasons).toContain("missing required documentation role: decisions_terms");
  });

  test("uses blocked when required evidence prevents deterministic evaluation", () => {
    const result = evaluateProjectMemoryQuality({
      mode: "create",
      role_coverage: [],
      candidate_dispositions: [],
      shallow_summary_findings: [],
      missing_coverage: [],
      blocked_reasons: ["quality diagnostics missing"],
      review_reasons: [],
    });

    expect(result.content_quality.status).toBe("blocked");
  });

  test("uses review_only for structurally useful output that requires human review", () => {
    const result = evaluateProjectMemoryQuality({
      mode: "maintain",
      role_coverage: [],
      candidate_dispositions: [],
      shallow_summary_findings: [],
      missing_coverage: [],
      blocked_reasons: [],
      review_reasons: ["lookup dependency used fallback result"],
    });

    expect(result.content_quality.status).toBe("review_only");
  });
});
```

- [ ] **Step 2: Implement the quality contract helper**

Add this file and keep the thresholds centralized here so later chunks do not duplicate policy:

```ts
import type { ProjectMemoryCuratorMode } from "./project-memory-curator-contracts.ts";

export const PROJECT_MEMORY_DOCUMENTATION_ROLES = [
  "orientation_index",
  "product_memory_model",
  "runtime_workflows",
  "architecture_data_flow",
  "current_work_roadmap",
  "decisions_terms",
] as const;

export const PROJECT_MEMORY_CONTENT_QUALITY_STATUSES = ["trusted", "review_only", "shallow", "blocked"] as const;
export const PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES = ["ready", "pending", "degraded", "not_applicable"] as const;
export const PROJECT_MEMORY_CANDIDATE_DISPOSITIONS = [
  "applied_to_project_memory",
  "already_trusted",
  "not_durable",
  "belongs_to_other_layer",
  "insufficient_evidence",
  "missing_coverage_no_grounded_write",
  "blocked_by_quality",
] as const;

export type ProjectMemoryDocumentationRole = (typeof PROJECT_MEMORY_DOCUMENTATION_ROLES)[number];
export type ProjectMemoryContentQualityStatus = (typeof PROJECT_MEMORY_CONTENT_QUALITY_STATUSES)[number];
export type ProjectMemoryRetrievalReadinessStatus = (typeof PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES)[number];
export type ProjectMemoryCandidateDisposition = (typeof PROJECT_MEMORY_CANDIDATE_DISPOSITIONS)[number];

export type ProjectMemoryRoleCoverage = {
  role: ProjectMemoryDocumentationRole;
  page_ref: string;
  sections_seen: number;
  citations_seen: number;
  body_chars_seen: number;
};

export type ProjectMemoryQualityDiagnostics = {
  schema_version: 1;
  content_quality: { status: ProjectMemoryContentQualityStatus; reasons: string[] };
  retrieval_readiness: { status: ProjectMemoryRetrievalReadinessStatus; reason?: string };
  role_coverage: ProjectMemoryRoleCoverage[];
  candidate_dispositions: { source_ref: string; disposition: ProjectMemoryCandidateDisposition; reason: string }[];
  missing_coverage: string[];
  shallow_summary_findings: string[];
};

export function evaluateProjectMemoryQuality(input: {
  mode: ProjectMemoryCuratorMode;
  role_coverage: ProjectMemoryRoleCoverage[];
  candidate_dispositions: ProjectMemoryQualityDiagnostics["candidate_dispositions"];
  missing_coverage: string[];
  shallow_summary_findings: string[];
  blocked_reasons: string[];
  review_reasons: string[];
}): ProjectMemoryQualityDiagnostics {
  if (input.blocked_reasons.length > 0) {
    return diagnosticsFor(input, "blocked", input.blocked_reasons);
  }

  const reasons: string[] = [];
  if (input.mode === "create") {
    for (const role of PROJECT_MEMORY_DOCUMENTATION_ROLES) {
      const coverage = input.role_coverage.find((item) => item.role === role);
      if (!coverage) reasons.push(`missing required documentation role: ${role}`);
      else if (coverage.sections_seen < 2) reasons.push(`role has insufficient section coverage: ${role}`);
      else if (coverage.citations_seen < 1) reasons.push(`role has insufficient repo citation coverage: ${role}`);
      else if (coverage.body_chars_seen < 300) reasons.push(`role has shallow body coverage: ${role}`);
    }
  }
  reasons.push(...input.missing_coverage, ...input.shallow_summary_findings);
  if (reasons.length > 0) return diagnosticsFor(input, "shallow", reasons);
  if (input.review_reasons.length > 0) return diagnosticsFor(input, "review_only", input.review_reasons);
  return diagnosticsFor(input, "trusted", []);
}

function diagnosticsFor(
  input: {
    role_coverage: ProjectMemoryRoleCoverage[];
    candidate_dispositions: ProjectMemoryQualityDiagnostics["candidate_dispositions"];
    missing_coverage: string[];
    shallow_summary_findings: string[];
  },
  status: ProjectMemoryContentQualityStatus,
  reasons: string[],
): ProjectMemoryQualityDiagnostics {
  return {
    schema_version: 1,
    content_quality: { status, reasons },
    retrieval_readiness: { status: "not_applicable" },
    role_coverage: input.role_coverage,
    candidate_dispositions: input.candidate_dispositions,
    missing_coverage: input.missing_coverage,
    shallow_summary_findings: input.shallow_summary_findings,
  };
}

export function isTrustedProjectMemoryQuality(diagnostics?: ProjectMemoryQualityDiagnostics): boolean {
  return diagnostics?.content_quality.status === "trusted";
}
```

- [ ] **Step 3: Export diagnostics from curator contracts**

In `src/project/project-memory-curator-contracts.ts`, import and re-export the new types. Extend `ProjectMemoryCuratorValidationResult`:

```ts
import type { ProjectMemoryQualityDiagnostics } from "./project-memory-quality-contract.ts";
export type { ProjectMemoryQualityDiagnostics } from "./project-memory-quality-contract.ts";

export type ProjectMemoryCuratorValidationResult = {
  ok: boolean;
  mode: ProjectMemoryCuratorMode;
  project_key: string;
  quality_diagnostics?: ProjectMemoryQualityDiagnostics;
  global_findings: ProjectMemoryValidationFinding[];
  item_results: ProjectMemoryItemValidation[];
  eligible_item_ids: string[];
  rejected_item_ids: string[];
  quarantined_item_ids: string[];
  noop_refs: string[];
};
```

### Task 2: Attach diagnostics to schema, validator, and run status

**Files:**
- Modify: `src/project/project-memory-curator-output-schema.ts`
- Modify: `src/project/project-memory-curator-validator.ts`
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-output-schema.test.ts`
- Test: `tests/project/project-memory-curator-validator.test.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Add schema fields**

Add `$defs` for `qualityDiagnostics` and require `quality_diagnostics` on both creation and maintenance output. The intended schema shape:

```ts
quality_diagnostics: { $ref: "#/$defs/qualityDiagnostics" }
```

with:

```ts
qualityDiagnostics: objectSchema({
  schema_version: constNumber(1),
  content_quality: objectSchema({
    status: { type: "string", enum: ["trusted", "review_only", "shallow", "blocked"] },
    reasons: stringArraySchema(),
  }, ["status", "reasons"]),
  retrieval_readiness: objectSchema({
    status: { type: "string", enum: ["ready", "pending", "degraded", "not_applicable"] },
    reason: nullable(stringSchema()),
  }, ["status", "reason"]),
  role_coverage: arrayOf(objectSchema({
    role: { type: "string", enum: ["orientation_index", "product_memory_model", "runtime_workflows", "architecture_data_flow", "current_work_roadmap", "decisions_terms"] },
    page_ref: stringSchema(),
    sections_seen: { type: "number" },
    citations_seen: { type: "number" },
    body_chars_seen: { type: "number" },
  }, ["role", "page_ref", "sections_seen", "citations_seen", "body_chars_seen"])),
  candidate_dispositions: arrayOf(objectSchema({
    source_ref: stringSchema(),
    disposition: { type: "string", enum: ["applied_to_project_memory", "already_trusted", "not_durable", "belongs_to_other_layer", "insufficient_evidence", "missing_coverage_no_grounded_write", "blocked_by_quality"] },
    reason: stringSchema(),
  }, ["source_ref", "disposition", "reason"])),
  missing_coverage: stringArraySchema(),
  shallow_summary_findings: stringArraySchema(),
}, ["schema_version", "content_quality", "retrieval_readiness", "role_coverage", "candidate_dispositions", "missing_coverage", "shallow_summary_findings"])
```

- [ ] **Step 2: Make validator copy diagnostics and block non-trusted quality**

In `validateCreationDraft` and `validateMaintenanceProposal`, parse `quality_diagnostics` from output. If malformed, add a blocker with category `schema` and code `quality_diagnostics_invalid`. If present but `content_quality.status !== "trusted"`, keep structural findings as-is but set `ok` false through the existing `result` helper and add a warn/blocker finding:

```ts
if (!isTrustedProjectMemoryQuality(diagnostics)) {
  globalFindings.push(
    finding("blocker", "schema", "content_quality_not_trusted", "Project Memory content quality must be trusted before canonical writes."),
  );
}
return result(packet, mode, globalFindings, itemResults, noopRefs, diagnostics);
```

Update `result(...)` and `failureValidation(...)` so all `ProjectMemoryCuratorValidationResult` values include or omit `quality_diagnostics` intentionally.

- [ ] **Step 3: Keep `completed_with_pending_index` trusted-only**

In `canApply`, add a guard before packet degraded checks:

```ts
if (!isTrustedProjectMemoryQuality(input.validation.quality_diagnostics)) {
  return { ok: false, status: "needs_review", reason: "Project Memory content quality is not trusted" };
}
```

In `writeTerminalArtifacts`, when retrieval is pending/degraded after apply, make sure the validation artifact still records `content_quality.status: "trusted"`.

### Task 3: Persist trusted quality state on creation apply

**Files:**
- Modify: `src/project/project-memory-markdown-applier.ts`
- Test: `tests/project/project-memory-markdown-applier.test.ts`

- [ ] **Step 1: Extend creation state write**

When creation applies, include trusted quality metadata in `project-memory.json`:

```ts
content_quality: {
  status: "trusted",
  checked_at: new Date().toISOString(),
  contract_version: 1,
},
retrieval_readiness: {
  status: "pending",
  checked_at: new Date().toISOString(),
},
```

Keep `status: "curated"` unchanged so existing maintain-mode state checks keep working.

- [ ] **Step 2: Add applier test**

Add an assertion that applied creation state includes `status: "curated"`, `content_quality.status: "trusted"`, and `retrieval_readiness.status: "pending"` after a successful creation apply.

## Verification

- Run: `bun test tests/project/project-memory-quality-contract.test.ts`
  Expected: passes all quality-contract classification tests.
- Run: `bun test tests/project/project-memory-curator-output-schema.test.ts`
  Expected: schema snapshot/assertions include `quality_diagnostics`.
- Run: `bun test tests/project/project-memory-curator-validator.test.ts`
  Expected: shallow or missing quality diagnostics produce `needs_review`-eligible validation failures.
- Run: `bun test tests/project/project-memory-curator-service.test.ts`
  Expected: non-trusted quality stops before writes; trusted content with degraded retrieval may end `completed_with_pending_index`.
- Run: `bun test tests/project/project-memory-markdown-applier.test.ts`
  Expected: creation state records trusted content quality.
- Run: `bun run typecheck`
  Expected: no TypeScript errors.
- Run: `git diff --check`
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- Valid JSON and safe markdown are not enough for curated Project Memory.
- `completed_with_pending_index` only applies to trusted content with pending/degraded retrieval.
- Quality diagnostics explain trusted, review-only, shallow, or blocked content.
- Project Memory state records content quality separately from retrieval readiness.

## Risks And Rollback

- Risk: quality checks become subjective. Mitigation: keep deterministic thresholds in `project-memory-quality-contract.ts`.
- Risk: schema changes break provider output tests. Mitigation: update output schema tests first.
- Rollback: revert this chunk's new quality field requirements and canApply guard; no canonical markdown migration is required because added state fields are additive.

## Non-Goals

- Does not enforce the full create-mode role contract beyond shared diagnostics.
- Does not implement section-first maintenance.
- Does not add Project Memory query behavior.

## Type And Name Consistency

Before finalizing implementation, verify that `ProjectMemoryQualityDiagnostics`, `quality_diagnostics`, `content_quality`, and `retrieval_readiness` are named consistently in contracts, schema, validation, run artifacts, and tests.
