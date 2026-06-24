# Chunk 01: Apply Payload Contracts And Validation

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `02-markdown-entry-renderer-and-safe-mutation.md`, `03-apply-journal-staging-and-recovery.md`, `04-creation-apply.md`, `05-maintenance-apply.md`

## Goal

Add the concrete structured Project Memory Apply Payload contract and extend curator validation so creation and maintenance output is applyable by deterministic code, not by interpreting `content_intent`. This chunk does not write markdown or integrate apply into `project learn`.

## Source Artifacts

- `../spec.md`: Concrete Apply Payload, Creation Apply, Maintenance Apply, Testing Strategy, Acceptance Criteria.
- `../agenda.md`: Questions 1, 2, 3, 4, and audit refinement for trusted-state predicate.
- `../pseudocode/src/project/project-memory-apply-contracts.ts`
- `../pseudocode/ProjectApplyGateBoundary.md`
- `../pseudocode/ProjectLearnMarkdownApplyFlow.md`
- `../../../adr/0059-use-structured-project-memory-apply-payloads.md`
- `../../../adr/0060-use-apply-journal-for-project-memory-writes.md`
- `../../../../CONTEXT.md`: Project Memory Apply Payload and Project Memory Source Consumption terms.
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-validator.ts`
- `tests/project/project-memory-curator-validator.test.ts`
- `tests/project/project-memory-curator-contracts.test.ts`

## Relationships

- **Depends on:** current curator contracts and validator.
- **Enables:** deterministic renderer, applier, journal, creation apply, and maintenance apply chunks.
- **Shared contracts:** `ProjectMemoryApplyPayload`, `ProjectMemoryPageDraft`, `ProjectMemoryEntryDraft`, `ProjectMemoryApplyResult`, `ProjectMemoryApplyJournal`, `ProjectMemoryChangeset`, `ProjectMemorySourceConsumptionRecord`.
- **Integration points:** `ProjectMemoryCreationPageDraft.apply_payload`, `ProjectMemoryMaintenanceProposalItem.apply_payload`, `validateCuratorOutput`.

## File Responsibility Map

**Create:**

- `src/project/project-memory-apply-contracts.ts` - owns apply payload, apply input/result, apply journal, changeset, bounded snippet, source-consumption, and helper type exports.

**Modify:**

- `src/project/project-memory-curator-contracts.ts` - imports or references apply payload types and adds optional-but-validated apply payload fields to creation pages and maintenance items.
- `src/project/project-memory-curator-validator.ts` - validates concrete apply payload presence, shape, provenance, wiki target safety, creation publication minimum, and maintenance operation payload compatibility.

**Test:**

- `tests/project/project-memory-curator-validator.test.ts` - covers accepted/rejected concrete apply payloads.
- `tests/project/project-memory-curator-contracts.test.ts` - covers exported constants/types where runtime shape exists.

## Implementation Tasks

### Task 1: Add Apply Contract Types

**Files:**

- Create: `src/project/project-memory-apply-contracts.ts`

- [ ] **Step 1: Create the contract file**

Use the pseudocode as the authority and implement this file with exported types only:

```ts
import type {
  ProjectMemoryCuratorOutput,
  ProjectMemoryEvidenceRef,
  ProjectMemoryLifecycleIntent,
  ProjectMemoryMaintenanceProposalItem,
  ProjectMemoryRepoCitation,
  ProjectMemoryRisk,
} from "./project-memory-curator-contracts.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

export type ProjectMemoryApplyPayload = {
  schema_version: 1;
  entries?: ProjectMemoryEntryDraft[];
  pages?: ProjectMemoryPageDraft[];
};

export type ProjectMemoryEntryDraft = {
  entry_id: string;
  title: string;
  body: ProjectMemoryMarkdownLines;
  lifecycle: ProjectMemoryLifecycleIntent;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
  applicability?: ProjectMemoryApplicability;
};

export type ProjectMemoryPageDraft = {
  page_path: string;
  title: string;
  purpose: string;
  body: ProjectMemoryMarkdownLines;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
};

export type ProjectMemoryMarkdownLines = {
  paragraphs: string[];
  bullets?: string[];
  warnings?: string[];
};

export type ProjectMemoryInferenceLabel = {
  label: string;
  basis?: string;
  why_direct_repo_evidence_is_unavailable: string;
};

export type ProjectMemoryApplicability = {
  branches?: string[];
  repo_paths?: string[];
  commands?: string[];
  notes?: string;
};

export type ProjectMemoryApplicableMaintenanceItem = ProjectMemoryMaintenanceProposalItem & {
  apply_payload: ProjectMemoryApplyPayload;
};

export type ProjectMemoryApplyInput = {
  root: string;
  project_key: string;
  packet: ProjectMemoryPacket;
  curator_output: ProjectMemoryCuratorOutput;
  validation: {
    ok: true;
    mode: "create" | "maintain";
    eligible_item_ids?: string[];
  };
  selection:
    | { mode: "create"; page_ids: string[] }
    | { mode: "maintain"; item_ids: string[] };
  run_dir: string;
  absolute_run_dir: string;
  journal_path: string;
  staged_outputs_dir: string;
  dry_run: false;
  review: false;
};

export type ProjectMemoryApplyResult = {
  status: "applied" | "skipped" | "failed";
  applied_page_ids: string[];
  applied_item_ids: string[];
  skipped_page_ids: string[];
  skipped_item_ids: string[];
  failed_page_ids: string[];
  failed_item_ids: string[];
  changed_files: ProjectMemoryAppliedFileChange[];
  state_updates: ProjectMemoryStateUpdate[];
  source_consumptions: ProjectMemorySourceConsumptionRecord[];
  artifacts: {
    apply_journal: "project-memory-apply-journal.json";
    apply_result: "project-memory-apply-result.json";
    changeset: "project-memory-changeset.json";
  };
  reason?: string;
};

export type ProjectMemoryAppliedFileChange = {
  path: string;
  before_sha256: string | null;
  after_sha256: string;
  operation: "create" | "update";
  page_ids: string[];
  item_ids: string[];
  staged_output_ref: string;
};

export type ProjectMemoryStateUpdate = {
  path: string;
  before_sha256: string | null;
  after_sha256: string;
  reason: string;
};

export type ProjectMemoryChangeset = {
  schema_version: 1;
  project_key: string;
  run_dir: string;
  packet_ref: {
    artifact: "input-packet.json";
    packet_schema_version: ProjectMemoryPacket["schema_version"];
  };
  curator_output_ref: string;
  validation_ref: "curator-validation.json";
  applied_at: string;
  risk: ProjectMemoryRisk;
  file_changes: ProjectMemoryAppliedFileChange[];
  page_changes: ProjectMemoryAppliedPageChange[];
  item_changes: ProjectMemoryAppliedItemChange[];
  source_consumptions: ProjectMemorySourceConsumptionRecord[];
};

export type ProjectMemoryAppliedPageChange = {
  page_id: string;
  operation: "create" | "adopt" | "rewrite";
  target_page: string;
  before_snippet?: ProjectMemoryBoundedSnippet;
  after_snippet: ProjectMemoryBoundedSnippet;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
};

export type ProjectMemoryAppliedItemChange = {
  item_id: string;
  operation: ProjectMemoryMaintenanceProposalItem["operation"];
  target_page: string;
  entry_id?: string;
  before_snippet?: ProjectMemoryBoundedSnippet;
  after_snippet?: ProjectMemoryBoundedSnippet;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
};

export type ProjectMemoryApplyJournal = {
  schema_version: 1;
  project_key: string;
  run_dir: string;
  status: "staged" | "promoting" | "recovered" | "applied" | "failed";
  packet_ref: "input-packet.json";
  curator_output_ref: string;
  validation_ref: "curator-validation.json";
  staged_outputs_dir: string;
  expected_writes: ProjectMemoryExpectedWrite[];
  observed_promotions: ProjectMemoryObservedPromotion[];
  recovery: {
    required_before_new_curator: boolean;
    last_attempt_at?: string;
    guidance?: string;
  };
};

export type ProjectMemoryExpectedWrite = {
  canonical_path: string;
  staged_output_ref: string;
  before_sha256: string | null;
  write_order: number;
  write_kind: "wiki_page" | "project_state" | "page_state" | "source_consumption_state" | "log";
};

export type ProjectMemoryObservedPromotion = {
  canonical_path: string;
  after_sha256: string;
  promoted_at: string;
};

export type ProjectMemoryBoundedSnippet = {
  path: string;
  anchor: string;
  sha256: string;
  text: string;
  truncated: boolean;
};

export type ProjectMemorySourceConsumptionRecord = {
  source_ref: string;
  source_kind: "project_candidate" | "project_handoff" | "other_project_memory_source";
  consumed_by_run: string;
  consumed_at: string;
  output_refs: Array<{
    page_path: string;
    entry_id?: string;
    page_id?: string;
    item_id?: string;
  }>;
  terminal_decision: "applied_to_project_memory";
};
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: exits `0`; no implementation imports this file yet, but the exported type graph compiles.

### Task 2: Attach Apply Payloads To Curator Output Types

**Files:**

- Modify: `src/project/project-memory-curator-contracts.ts`

- [ ] **Step 1: Import the payload type**

Add near the existing imports:

```ts
import type { ProjectMemoryApplyPayload } from "./project-memory-apply-contracts.ts";
```

- [ ] **Step 2: Extend creation and maintenance output shapes**

Change the existing types like this:

```ts
export type ProjectMemoryCreationPageDraft = {
  id: string;
  target: ProjectMemoryPathRef;
  title: string;
  purpose: string;
  content_intent: string;
  apply_payload?: ProjectMemoryApplyPayload;
  required_sections: string[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  notes_for_apply: string[];
};
```

```ts
export type ProjectMemoryMaintenanceProposalItem = {
  id: string;
  operation: ProjectMemoryMaintenanceOperation;
  target_page: ProjectMemoryPathRef;
  target_entry_id?: string;
  proposed_entry_id?: string;
  content_intent: string;
  apply_payload?: ProjectMemoryApplyPayload;
  source_packet_refs: ProjectMemoryEvidenceRef[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: {
    label: string;
    why_direct_repo_evidence_is_unavailable: string;
  };
  applicability: {
    branches?: string[];
    repo_paths?: string[];
    commands?: string[];
    notes?: string;
  };
  lifecycle_intent: ProjectMemoryLifecycleIntent;
  risk: ProjectMemoryRisk;
  preconditions: string[];
  expected_outcome: string;
};
```

Keep the fields optional at the TypeScript contract level so old pre-write tests can still construct intentionally invalid outputs; validation determines applyability.

- [ ] **Step 3: Run focused contract tests**

Run: `bun test tests/project/project-memory-curator-contracts.test.ts`

Expected: exits `0`.

### Task 3: Validate Creation Apply Payloads

**Files:**

- Modify: `src/project/project-memory-curator-validator.ts`
- Test: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Add failing tests for creation payload requirements**

Add tests near existing creation validation tests:

```ts
test("accepts creation drafts with concrete page apply payloads and publication minimum", () => {
  const result = validateCuratorOutput(packet("create"), creationDraftWithApplyPayload());

  expect(result.ok).toBe(true);
  expect(result.global_findings).toEqual([]);
});

test("rejects creation drafts without concrete apply payloads", () => {
  const draft = creationDraftWithApplyPayload();
  delete draft.pages[0].apply_payload;

  const result = validateCuratorOutput(packet("create"), draft);

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("creation_page_apply_payload_required");
});

test("rejects creation drafts that lack index plus domain page or rationale", () => {
  const draft = creationDraftWithApplyPayload();
  draft.pages = draft.pages.filter((page) => page.id === "page_index");

  const result = validateCuratorOutput(packet("create"), draft);

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("creation_publication_minimum_not_met");
});
```

Add this helper at the bottom of the file:

```ts
function creationDraftWithApplyPayload() {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "creation",
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages: [
      creationPage("page_index", "index.md", "Demo", "Index"),
      creationPage("page_setup", "setup/index.md", "Setup", "Setup workflows"),
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: lowRisk(),
  };
}

function creationPage(id: string, path: string, title: string, purpose: string) {
  return {
    id,
    target: { path, path_kind: "new_wiki_page" },
    title,
    purpose,
    content_intent: `Create ${title}`,
    apply_payload: {
      schema_version: 1,
      pages: [
        {
          page_path: path,
          title,
          purpose,
          body: { paragraphs: [`${title} describes ${purpose}.`] },
          evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
          repo_citations: [],
        },
      ],
    },
    required_sections: ["Overview"],
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    notes_for_apply: [],
  };
}
```

Run: `bun test tests/project/project-memory-curator-validator.test.ts`

Expected: fails because the validator does not yet require `apply_payload` or the creation publication minimum.

- [ ] **Step 2: Add validation helpers**

In `src/project/project-memory-curator-validator.ts`, extend imports:

```ts
import type {
  ProjectMemoryApplyPayload,
  ProjectMemoryEntryDraft,
  ProjectMemoryPageDraft,
} from "./project-memory-apply-contracts.ts";
```

Add helpers near existing private helpers:

```ts
function validateApplyPayload(packet: ProjectMemoryPacket, payload: unknown, itemId?: string): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (!isRecord(payload)) {
    findings.push(finding("blocker", "schema", "apply_payload_required", "Concrete apply_payload is required for apply.", itemId));
    return findings;
  }
  if (payload.schema_version !== 1) {
    findings.push(finding("blocker", "schema", "apply_payload_schema_version_mismatch", "apply_payload.schema_version must be 1.", itemId));
  }
  const pages = Array.isArray(payload.pages) ? (payload.pages as ProjectMemoryPageDraft[]) : [];
  const entries = Array.isArray(payload.entries) ? (payload.entries as ProjectMemoryEntryDraft[]) : [];
  if (pages.length === 0 && entries.length === 0) {
    findings.push(finding("blocker", "schema", "apply_payload_content_required", "apply_payload requires pages or entries.", itemId));
  }
  for (const page of pages) {
    findings.push(...validatePageDraft(packet, page, itemId));
  }
  for (const entry of entries) {
    findings.push(...validateEntryDraft(packet, entry, itemId));
  }
  return findings;
}

function validatePageDraft(packet: ProjectMemoryPacket, page: ProjectMemoryPageDraft, itemId?: string): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (!isSafeWikiTarget(page.page_path)) {
    findings.push(finding("blocker", "path", "apply_page_path_outside_wiki", "Apply page paths must be project wiki-relative markdown paths.", itemId));
  }
  if (!page.title || !page.purpose) {
    findings.push(finding("blocker", "schema", "apply_page_title_purpose_required", "Apply page drafts require title and purpose.", itemId));
  }
  findings.push(...validateMarkdownLines(page.body, "apply_page_body_required", itemId));
  findings.push(...validatePayloadProvenance(packet, page.evidence_refs, page.repo_citations, page.inference, itemId));
  return findings;
}

function validateEntryDraft(packet: ProjectMemoryPacket, entry: ProjectMemoryEntryDraft, itemId?: string): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (!entry.entry_id || !/^[a-z0-9][a-z0-9._-]*$/i.test(entry.entry_id)) {
    findings.push(finding("blocker", "schema", "apply_entry_id_invalid", "Entry drafts require a stable entry_id.", itemId));
  }
  if (!entry.title) {
    findings.push(finding("blocker", "schema", "apply_entry_title_required", "Entry drafts require title.", itemId));
  }
  if (!lifecycleAllowed("CREATE_ENTRY", entry.lifecycle)) {
    findings.push(finding("blocker", "lifecycle", "apply_entry_lifecycle_invalid", "Entry draft lifecycle must be supported.", itemId));
  }
  findings.push(...validateMarkdownLines(entry.body, "apply_entry_body_required", itemId));
  findings.push(...validatePayloadProvenance(packet, entry.evidence_refs, entry.repo_citations, entry.inference, itemId));
  return findings;
}

function validateMarkdownLines(body: unknown, code: string, itemId?: string): ProjectMemoryValidationFinding[] {
  if (!isRecord(body) || !Array.isArray(body.paragraphs) || body.paragraphs.filter((line) => typeof line === "string" && line.trim()).length === 0) {
    return [finding("blocker", "schema", code, "Apply payload body requires at least one paragraph.", itemId)];
  }
  return [];
}

function validatePayloadProvenance(
  packet: ProjectMemoryPacket,
  evidenceRefs: unknown,
  repoCitations: unknown,
  inference: unknown,
  itemId?: string,
): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs : [];
  if (refs.length === 0) {
    findings.push(finding("blocker", "provenance", "apply_payload_evidence_required", "Apply payload requires evidence refs.", itemId));
  }
  for (const ref of refs) {
    if (!validEvidenceRefShape(ref) || !resolvePacketRef(packet, ref)) {
      findings.push(finding("blocker", "provenance", "invalid_apply_payload_evidence_ref", `Invalid apply payload evidence ref: ${describeRef(ref)}`, itemId));
    }
  }
  const hasRepoCitation = Array.isArray(repoCitations) && repoCitations.length > 0;
  const hasInference = isRecord(inference) && typeof inference.label === "string" && typeof inference.why_direct_repo_evidence_is_unavailable === "string";
  if (!hasRepoCitation && !hasInference) {
    findings.push(finding("blocker", "repo_citation", "apply_payload_repo_citation_or_inference_required", "Apply payload requires repo citations or explicit inference.", itemId));
  }
  return findings;
}

function creationHasPublicationMinimum(pages: Array<Record<string, unknown>>): boolean {
  const hasIndex = pages.some((page) => isRecord(page.target) && page.target.path === "index.md");
  const hasDomainPage = pages.some((page) => isRecord(page.target) && page.target.path !== "index.md");
  const hasRationale = pages.some((page) => Array.isArray(page.notes_for_apply) && page.notes_for_apply.some((note) => typeof note === "string" && note.includes("no-domain-pages")));
  return hasIndex && (hasDomainPage || hasRationale);
}
```

- [ ] **Step 3: Call validation from creation flow**

In `validateCreationDraft`, inside the `for (const page of draft.pages ?? [])` loop, add:

```ts
    if (!isRecord(item.apply_payload)) {
      globalFindings.push(
        finding("blocker", "schema", "creation_page_apply_payload_required", "Creation page drafts require concrete apply_payload."),
      );
    } else {
      globalFindings.push(...validateApplyPayload(packet, item.apply_payload));
    }
```

After the loop, add:

```ts
  const creationPages = (draft.pages ?? []).filter(isRecord);
  if (creationPages.length > 0 && !creationHasPublicationMinimum(creationPages)) {
    globalFindings.push(
      finding(
        "blocker",
        "schema",
        "creation_publication_minimum_not_met",
        "Creation apply requires index.md plus a domain page or explicit no-domain-pages rationale.",
      ),
    );
  }
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-curator-validator.test.ts`

Expected: existing old creation fixtures that lack payload now fail. Update only the fixtures for tests that expect valid creation output; tests that expect rejection can keep missing payload if the new code is expected.

### Task 4: Validate Maintenance Apply Payloads

**Files:**

- Modify: `src/project/project-memory-curator-validator.ts`
- Test: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Update valid maintenance fixtures with concrete entry payloads**

In `maintenanceItem`, add:

```ts
    apply_payload: {
      schema_version: 1,
      entries: [
        {
          entry_id: "setup.cli",
          title: "Setup CLI",
          body: { paragraphs: ["Document CLI setup command."] },
          lifecycle: "active",
          evidence_refs: [{ kind: "project_candidate", ref: "cand_1" }],
          repo_citations: [
            { path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" },
          ],
          applicability: { commands: ["myelin project learn demo"] },
        },
      ],
    },
```

- [ ] **Step 2: Add tests for missing and malformed maintenance payloads**

Add:

```ts
test("rejects eligible maintenance mutations without concrete apply payloads", () => {
  const result = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "missing_payload",
      apply_payload: undefined,
    }),
  );

  expect(result.ok).toBe(false);
  expect(result.rejected_item_ids).toEqual(["missing_payload"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain("maintenance_apply_payload_required");
});

test("rejects maintenance apply payload entries without provenance", () => {
  const result = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "payload_no_provenance",
      apply_payload: {
        schema_version: 1,
        entries: [
          {
            entry_id: "setup.cli",
            title: "Setup CLI",
            body: { paragraphs: ["Document CLI setup command."] },
            lifecycle: "active",
            evidence_refs: [],
            repo_citations: [],
          },
        ],
      },
    }),
  );

  expect(result.ok).toBe(false);
  expect(result.rejected_item_ids).toEqual(["payload_no_provenance"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["apply_payload_evidence_required", "apply_payload_repo_citation_or_inference_required"]),
  );
});
```

- [ ] **Step 3: Call validation from maintenance item flow**

In `validateMaintenanceItem`, after content budget validation and before packet ref loops, add:

```ts
  if (item.operation !== "NOOP") {
    if (!isRecord(item.apply_payload)) {
      findings.push(finding("blocker", "schema", "maintenance_apply_payload_required", "Maintenance mutation items require concrete apply_payload.", itemId));
    } else {
      findings.push(...validateApplyPayload(packet, item.apply_payload, itemId));
    }
  }
```

NOOP remains allowed without a payload because it does not mutate canonical markdown.

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-curator-validator.test.ts`

Expected: exits `0`.

### Task 5: Preserve Type And Name Consistency

**Files:**

- Review: `src/project/project-memory-curator-contracts.ts`
- Review: `src/project/project-memory-apply-contracts.ts`

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`

Expected: exits `0`. If there is an import cycle error, keep `src/project/project-memory-apply-contracts.ts` as the source file and convert imports in `project-memory-curator-contracts.ts` to `import type` only.

- [ ] **Step 2: Run whitespace check**

Run: `git diff --check`

Expected: no output and exit `0`.

## Verification

Run:

```bash
bun test tests/project/project-memory-curator-validator.test.ts
bun test tests/project/project-memory-curator-contracts.test.ts
bun run typecheck
git diff --check
```

Expected:

- Validator tests pass with missing/malformed payloads rejected.
- Contract tests pass.
- Typecheck exits `0`.
- Whitespace check exits `0`.

## Acceptance Criteria Covered

- Apply consumes validated curator artifacts plus concrete apply payloads.
- `content_intent` is no longer sufficient write authority.
- Rejected, invalid, malformed, unsupported outputs stop before writes.
- Creation publication minimum is enforced before apply.
- Maintenance apply requires concrete eligible item payloads.

## Risks And Rollback

- Risk: old tests or fixtures may fail because valid curator output now needs `apply_payload`.
- Rollback: remove the new type file import and validation helper calls; old pre-write behavior returns because no apply chunk depends on runtime writes yet.
- Risk: creation publication minimum may reject old single-index creation fixtures.
- Rollback: update only test fixtures that represent successful creation; do not weaken the validator.

## Non-Goals

- Does not write wiki markdown.
- Does not create `ProjectMemoryMarkdownApplier`.
- Does not implement apply journal, changesets, source-consumption state, service integration, or CLI output changes.
- Does not mutate candidate or handoff status.

## Type And Name Consistency

- Define `ProjectMemoryApplyPayload` only in `src/project/project-memory-apply-contracts.ts`.
- Use `apply_payload` as the JSON field on curator output.
- Use `ProjectMemoryPageDraft` and `ProjectMemoryEntryDraft` for structured payload content.
- Preserve existing `ProjectMemoryCreationDraft` and `ProjectMemoryMaintenanceProposal` names.
