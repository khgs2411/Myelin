# Chunk 02: Curator Validator

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-curator-contracts.md`
**Enables:** `04-curator-service-prewrite-flow.md`

## Goal

Add deterministic validation for Project Memory Curator outputs. The validator classifies creation drafts and maintenance proposal items before any wiki write can happen. It returns structured findings rather than throwing for item-level problems.

## Source Artifacts

- `../spec.md`: Validation Contract, Provenance Floor And Citation Standard, Error Handling.
- `../agenda.md`: Question 2 per-item outcomes; Question 3 packet-resolvable evidence.
- `../pseudocode/src/project/project-memory-curator-validator.ts`: source-shaped validator reference.
- `src/project/project-memory-packet.ts`: packet refs and mode.
- `src/project/project-memory-curator-contracts.ts`: created by Chunk 01.

## Relationships

- **Depends on:** Chunk 01 contract exports.
- **Enables:** Curator service can validate provider JSON and persist `curator-validation.json`.
- **Shared contracts:** `validateCuratorOutput(packet, output)`, `ProjectMemoryCuratorValidationResult`, per-item outcomes.
- **Integration points:** `tests/project/project-memory-curator-validator.test.ts`, `src/project/project-memory-curator-service.ts`.

## Validation Ownership Matrix

This chunk owns these deterministic checks before Chunk 04 can depend on the validator:

| Area | Required behavior | Outcome |
| --- | --- | --- |
| Envelope | output object, schema version, project key, mode, packet ref | global blocker |
| Creation pages | at least one page, safe wiki/new-page target, evidence refs, protected state assignment limited to allowed creation state intent | global blocker |
| Maintenance items | item count and content-size budgets | global blocker or item rejection |
| Target pages | target stays under project wiki; existing-page operations target a page present in packet wiki pages | item rejection |
| Operations | only Chunk 01 maintenance operations are accepted; broad page operations are rejected as unsupported | item rejection |
| Packet refs | source and evidence refs have valid shape and resolve to packet contents or accepted inference/repo citation refs | item rejection |
| Provenance | evidence refs are required; inference needs an inference label and packet evidence; repo-groundable command/code/runtime/setup/test claims need repo citations unless explicit inference explains absence | item rejection or quarantine |
| Lifecycle | operation and lifecycle intent must be compatible | item rejection |
| Risk/degraded state | high-risk, quarantine-required, degraded packet, and conflicting evidence conditions cannot become normal eligible output | item quarantine |

## File Responsibility Map

**Create:**
- `src/project/project-memory-curator-validator.ts` - deterministic shape, mode, packet-ref, path, evidence, and risk checks.
- `tests/project/project-memory-curator-validator.test.ts` - behavior-focused validator tests.

**Modify:**
- None.

**Test:**
- `tests/project/project-memory-curator-validator.test.ts` - global rejection, item rejection, quarantine, and eligible item behavior.

## Implementation Tasks

### Task 1: Add Validator Tests First

**Files:**
- Create: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Add focused validator tests**

```ts
import { expect, test } from "bun:test";
import type { ProjectMemoryPacket } from "../../src/project/project-memory-packet.ts";
import { validateCuratorOutput } from "../../src/project/project-memory-curator-validator.ts";

test("rejects wrong project key as a global hard error", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "other",
    mode: "maintain",
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run", artifact: "input-packet.json", packet_schema_version: 1 },
    summary: "wrong project",
    items: [],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("project_key_mismatch");
});

test("eligible maintenance item requires packet refs, evidence, and safe wiki path", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run", artifact: "input-packet.json", packet_schema_version: 1 },
    summary: "one update",
    items: [
      {
        id: "item_1",
        operation: "CREATE_ENTRY",
        target_page: { path: "setup/index.md", path_kind: "existing_wiki_page" },
        proposed_entry_id: "setup.cli",
        content_intent: "Document CLI setup command.",
        source_packet_refs: [{ kind: "project_candidate", ref: "cand_1" }],
        evidence_refs: [{ kind: "project_candidate", ref: "cand_1" }],
        repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }],
        applicability: { commands: ["myelin project learn demo"] },
        lifecycle_intent: "active",
        risk: lowRisk(),
        preconditions: ["setup page exists"],
        expected_outcome: "setup page receives a sourced entry in a later apply slice",
      },
    ],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.eligible_item_ids).toEqual(["item_1"]);
  expect(result.rejected_item_ids).toEqual([]);
});

test("rejects maintenance items with unknown packet references or out-of-wiki paths", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run", artifact: "input-packet.json", packet_schema_version: 1 },
    summary: "bad item",
    items: [
      {
        id: "item_bad",
        operation: "PATCH_ENTRY",
        target_page: { path: "../state/project.json", path_kind: "existing_wiki_page" },
        target_entry_id: "setup.cli",
        content_intent: "Patch outside wiki.",
        source_packet_refs: [{ kind: "project_candidate", ref: "missing" }],
        evidence_refs: [],
        repo_citations: [],
        applicability: {},
        lifecycle_intent: "active",
        risk: lowRisk(),
        preconditions: [],
        expected_outcome: "rejected",
      },
    ],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.rejected_item_ids).toEqual(["item_bad"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["target_path_outside_wiki", "unknown_source_packet_ref", "missing_evidence_refs"]),
  );
});

test("quarantines high-risk maintenance items instead of marking them eligible", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run", artifact: "input-packet.json", packet_schema_version: 1 },
    summary: "risky item",
    items: [
      {
        id: "item_risky",
        operation: "MARK_DISPUTED",
        target_page: { path: "setup/index.md", path_kind: "existing_wiki_page" },
        target_entry_id: "setup.cli",
        content_intent: "Mark disputed due to conflicting evidence.",
        source_packet_refs: [{ kind: "project_candidate", ref: "cand_1" }],
        evidence_refs: [{ kind: "project_candidate", ref: "cand_1" }],
        repo_citations: [],
        applicability: {},
        lifecycle_intent: "disputed",
        risk: { level: "high", reasons: ["conflicting evidence"], requires_quarantine: true },
        preconditions: [],
        expected_outcome: "quarantine",
      },
    ],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.quarantined_item_ids).toEqual(["item_risky"]);
});

test("rejects creation drafts with unsafe page targets or protected state assignment", () => {
  const result = validateCuratorOutput(packet("create"), {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run", artifact: "input-packet.json", packet_schema_version: 1 },
    summary: "unsafe draft",
    brain_intent: { name: "Demo", first_brain_summary: "Create first brain", untrusted_existing_markdown_policy: "adopt" },
    pages: [{ id: "unsafe", target: { path: "../state/project.json", path_kind: "project_state" }, title: "Unsafe", purpose: "Unsafe", content_intent: "Write state", required_sections: [], evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }], repo_citations: [], notes_for_apply: [] }],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize", owner: "curator" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["creation_target_path_outside_wiki", "protected_state_assignment"]),
  );
});

test("rejects existing-page maintenance operations when the page is absent from the packet", () => {
  const result = validateCuratorOutput(packet("maintain"), proposalWithItem({
    id: "missing_page",
    operation: "PATCH_ENTRY",
    target_page: { path: "missing/index.md", path_kind: "existing_wiki_page" },
    target_entry_id: "setup.cli",
  }));

  expect(result.rejected_item_ids).toEqual(["missing_page"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain("target_page_missing");
});

test("rejects unsupported broad operations and illegal lifecycle transitions", () => {
  const result = validateCuratorOutput(packet("maintain"), proposalWithItem({
    id: "broad",
    operation: "DELETE_PAGE",
    lifecycle_intent: "active",
  }));

  expect(result.rejected_item_ids).toEqual(["broad"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["unknown_operation", "illegal_lifecycle_transition"]),
  );
});

test("rejects repo-groundable command claims without repo citation or inference explanation", () => {
  const result = validateCuratorOutput(packet("maintain"), proposalWithItem({
    id: "no_repo_citation",
    content_intent: "Document command myelin project learn demo behavior.",
    repo_citations: [],
    inference: undefined,
  }));

  expect(result.rejected_item_ids).toEqual(["no_repo_citation"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain("missing_repo_citation");
});

test("quarantines otherwise valid maintenance items when packet state is degraded", () => {
  const degraded = packet("maintain");
  degraded.degraded = true;
  degraded.degraded_reasons = ["lookup degraded"];

  const result = validateCuratorOutput(degraded, proposalWithItem({ id: "degraded_item" }));

  expect(result.ok).toBe(false);
  expect(result.quarantined_item_ids).toEqual(["degraded_item"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain("packet_degraded");
});

test("rejects proposals that exceed item or content budgets", () => {
  const manyItems = Array.from({ length: 26 }, (_, index) => maintenanceItem({ id: `item_${index}` }));
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run", artifact: "input-packet.json", packet_schema_version: 1 },
    summary: "too many",
    items: manyItems,
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("proposal_item_budget_exceeded");
});

function packet(mode: "create" | "maintain"): ProjectMemoryPacket {
  return {
    schema_version: 1,
    project_key: "demo",
    mode,
    project: { key: "demo", name: "Demo", lifecycle: "active", repo_paths: ["/repo/demo"] },
    state: { bootstrap_state: { status: mode === "create" ? "uncurated" : "curated" }, project_memory: mode === "maintain" ? { status: "curated" } : null, freshness: null, pages_manifest: null },
    wiki: { page_count: 1, pages: [{ path: "wiki/setup/index.md", title: "Setup", headings: [], snippet: "Setup", size_bytes: 5 }] },
    pending: { project_handoffs: [], project_candidates: [{ id: "cand_1", status: "pending", candidate_type: "project.setup", title: "Setup", summary: "Document setup.", source_event_refs: ["evt_1"], confidence: "medium", risk: "low", reason: "durable" }] },
    session_memory: { selected: [] },
    lookup: { queries: [], results: [] },
    degraded: false,
    degraded_reasons: [],
  };
}

function lowRisk() {
  return { level: "low" as const, reasons: [], requires_quarantine: false };
}

function proposalWithItem(overrides: Record<string, unknown>) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run", artifact: "input-packet.json", packet_schema_version: 1 },
    summary: "proposal",
    items: [maintenanceItem(overrides)],
    noop_inputs: [],
    risk: lowRisk(),
  };
}

function maintenanceItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item",
    operation: "CREATE_ENTRY",
    target_page: { path: "setup/index.md", path_kind: "existing_wiki_page" },
    proposed_entry_id: "setup.cli",
    content_intent: "Document setup behavior.",
    source_packet_refs: [{ kind: "project_candidate", ref: "cand_1" }],
    evidence_refs: [{ kind: "project_candidate", ref: "cand_1" }],
    repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }],
    applicability: {},
    lifecycle_intent: "active",
    risk: lowRisk(),
    preconditions: [],
    expected_outcome: "eligible",
    ...overrides,
  };
}
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-curator-validator.test.ts`
Expected: fails because `src/project/project-memory-curator-validator.ts` does not exist.

### Task 2: Implement Validator

**Files:**
- Create: `src/project/project-memory-curator-validator.ts`

- [ ] **Step 1: Add deterministic validator implementation**

```ts
import { PROJECT_MEMORY_MAINTENANCE_OPERATIONS, type ProjectMemoryCuratorOutput, type ProjectMemoryCuratorValidationResult, type ProjectMemoryEvidenceRef, type ProjectMemoryItemValidation, type ProjectMemoryMaintenanceProposal, type ProjectMemoryMaintenanceProposalItem, type ProjectMemoryValidationFinding } from "./project-memory-curator-contracts.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

const MAX_MAINTENANCE_ITEMS = 25;
const MAX_ITEM_CONTENT_CHARS = 4_000;
const REPO_GROUNDABLE_RE = /\b(command|cli|runtime|setup|test|file|path|import|export|function|class|api|schema|migration|build|typecheck|myelin|bun|npm)\b/i;

export function validateCuratorOutput(packet: ProjectMemoryPacket, output: unknown): ProjectMemoryCuratorValidationResult {
  const envelope = isRecord(output) ? output : null;
  if (!envelope) return globalFailure(packet, "create", "invalid_json_shape", "Curator output must be a JSON object.");

  const mode = envelope.mode === "maintain" ? "maintain" : "create";
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  if (envelope.schema_version !== 1) globalFindings.push(finding("blocker", "schema_version_mismatch", "Curator output schema_version must be 1."));
  if (envelope.project_key !== packet.project_key) globalFindings.push(finding("blocker", "project_key_mismatch", `Curator output project_key must be ${packet.project_key}.`));
  if (envelope.mode !== packet.mode) globalFindings.push(finding("blocker", "mode_mismatch", `Curator output mode must be ${packet.mode}.`));
  if (!isRecord(envelope.packet_ref) || envelope.packet_ref.artifact !== "input-packet.json" || envelope.packet_ref.packet_schema_version !== packet.schema_version) {
    globalFindings.push(finding("blocker", "packet_ref_mismatch", "Curator output packet_ref must point at input-packet.json with the packet schema version."));
  }

  if (globalFindings.length > 0) return result(packet, mode, globalFindings, []);
  if (mode === "maintain") return validateMaintenanceProposal(packet, output as ProjectMemoryMaintenanceProposal);
  return validateCreationDraft(packet, output as ProjectMemoryCuratorOutput);
}

export function validateCreationDraft(packet: ProjectMemoryPacket, output: ProjectMemoryCuratorOutput): ProjectMemoryCuratorValidationResult {
  const draft = output as { pages?: unknown[]; evidence_refs?: ProjectMemoryEvidenceRef[]; risk?: unknown; state_intent?: unknown };
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  if (packet.mode !== "create") globalFindings.push(finding("blocker", "creation_mode_required", "Creation draft requires packet mode create."));
  if (!Array.isArray(draft.pages) || draft.pages.length === 0) globalFindings.push(finding("blocker", "creation_pages_required", "Creation draft must include at least one page draft."));
  if (!Array.isArray(draft.evidence_refs) || draft.evidence_refs.length === 0) globalFindings.push(finding("blocker", "creation_evidence_required", "Creation draft must include proposal-level evidence refs."));
  for (const ref of draft.evidence_refs ?? []) {
    if (!validEvidenceRefShape(ref) || !resolvePacketRef(packet, ref)) globalFindings.push(finding("blocker", "invalid_creation_evidence_ref", `Invalid creation evidence ref: ${String(ref?.kind)}:${String(ref?.ref)}`, undefined, validEvidenceRefShape(ref) ? [ref] : undefined));
  }
  for (const page of draft.pages ?? []) {
    const item = isRecord(page) ? page : {};
    const target = isRecord(item.target) ? item.target : {};
    if (!isSafeWikiTarget(target.path)) globalFindings.push(finding("blocker", "creation_target_path_outside_wiki", "Creation page targets must stay inside project wiki."));
    if (target.path_kind !== "new_wiki_page" && target.path_kind !== "existing_wiki_page") globalFindings.push(finding("blocker", "unsupported_creation_target_kind", "Creation page target must be a wiki page."));
    const pageEvidence = Array.isArray(item.evidence_refs) ? item.evidence_refs : [];
    if (pageEvidence.length === 0) globalFindings.push(finding("blocker", "creation_page_evidence_required", "Every creation page draft needs evidence refs."));
  }
  if (isRecord(draft.state_intent)) {
    const allowed = new Set(["mark_project_memory_curated", "freshness_intent"]);
    for (const key of Object.keys(draft.state_intent)) {
      if (!allowed.has(key)) globalFindings.push(finding("blocker", "protected_state_assignment", `Creation draft cannot self-assign protected state field: ${key}.`));
    }
  }
  return result(packet, "create", globalFindings, []);
}

export function validateMaintenanceProposal(packet: ProjectMemoryPacket, proposal: ProjectMemoryMaintenanceProposal): ProjectMemoryCuratorValidationResult {
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  if (packet.mode !== "maintain") globalFindings.push(finding("blocker", "maintenance_mode_required", "Maintenance proposal requires packet mode maintain."));
  if (!Array.isArray(proposal.items)) globalFindings.push(finding("blocker", "items_required", "Maintenance proposal must include an items array."));
  if (Array.isArray(proposal.items) && proposal.items.length > MAX_MAINTENANCE_ITEMS) globalFindings.push(finding("blocker", "proposal_item_budget_exceeded", `Maintenance proposal must include at most ${MAX_MAINTENANCE_ITEMS} items.`));
  if (globalFindings.length > 0) return result(packet, "maintain", globalFindings, []);

  const itemResults = proposal.items.map((item) => validateMaintenanceItem(packet, item));
  return result(packet, "maintain", globalFindings, itemResults);
}

export function validateMaintenanceItem(packet: ProjectMemoryPacket, item: ProjectMemoryMaintenanceProposalItem): ProjectMemoryItemValidation {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (!item.id) findings.push(finding("blocker", "missing_item_id", "Maintenance item requires id."));
  if (!isAllowedOperation(item.operation)) findings.push(finding("blocker", "unknown_operation", `Unsupported operation: ${String(item.operation)}`, item.id));
  if (!isSafeWikiTarget(item.target_page?.path)) findings.push(finding("blocker", "target_path_outside_wiki", "Target page must be a project wiki-relative markdown path.", item.id));
  else if (item.target_page?.path_kind === "existing_wiki_page" && !packetHasWikiPage(packet, item.target_page.path)) findings.push(finding("blocker", "target_page_missing", "Existing-page operation target must exist in packet wiki pages.", item.id));
  if (typeof item.content_intent === "string" && item.content_intent.length > MAX_ITEM_CONTENT_CHARS) findings.push(finding("blocker", "item_content_budget_exceeded", `Item content_intent must be at most ${MAX_ITEM_CONTENT_CHARS} characters.`, item.id));
  for (const ref of item.source_packet_refs ?? []) {
    if (!validEvidenceRefShape(ref)) findings.push(finding("blocker", "invalid_source_packet_ref", "Source packet refs require kind and ref strings.", item.id));
    else if (!resolvePacketRef(packet, ref)) findings.push(finding("blocker", "unknown_source_packet_ref", `Unknown source packet ref: ${ref.kind}:${ref.ref}`, item.id, [ref]));
  }
  for (const ref of item.evidence_refs ?? []) {
    if (!validEvidenceRefShape(ref)) findings.push(finding("blocker", "invalid_evidence_ref", "Evidence refs require kind and ref strings.", item.id));
    else if (!resolvePacketRef(packet, ref)) findings.push(finding("blocker", "unknown_evidence_ref", `Unknown evidence ref: ${ref.kind}:${ref.ref}`, item.id, [ref]));
  }
  if (!Array.isArray(item.source_packet_refs) || item.source_packet_refs.length === 0) findings.push(finding("blocker", "missing_source_packet_refs", "Maintenance item requires source packet refs.", item.id));
  if (!Array.isArray(item.evidence_refs) || item.evidence_refs.length === 0) findings.push(finding("blocker", "missing_evidence_refs", "Maintenance item requires evidence refs.", item.id));
  if (!lifecycleAllowed(item.operation, item.lifecycle_intent)) findings.push(finding("blocker", "illegal_lifecycle_transition", `Operation ${String(item.operation)} cannot set lifecycle ${String(item.lifecycle_intent)}.`, item.id));
  if (requiresRepoCitation(item) && (!Array.isArray(item.repo_citations) || item.repo_citations.length === 0) && !hasInferenceExplanation(item)) findings.push(finding("blocker", "missing_repo_citation", "Repo-groundable claims require repo citations or an explicit inference explanation.", item.id));
  if (item.risk?.requires_quarantine || item.risk?.level === "high") findings.push(finding("warn", "risk_requires_quarantine", "High-risk item must be quarantined before apply.", item.id));
  if (packet.degraded) findings.push(finding("warn", "packet_degraded", `Packet is degraded: ${packet.degraded_reasons.join("; ")}`, item.id));

  const hasBlocker = findings.some((entry) => entry.severity === "blocker");
  const hasQuarantine = findings.some((entry) => entry.code === "risk_requires_quarantine" || entry.code === "packet_degraded");
  return {
    item_id: item.id,
    outcome: hasBlocker ? "rejected" : hasQuarantine ? "quarantined" : item.operation === "NOOP" ? "noop" : "eligible",
    findings,
  };
}

function result(packet: ProjectMemoryPacket, mode: "create" | "maintain", global_findings: ProjectMemoryValidationFinding[], item_results: ProjectMemoryItemValidation[]): ProjectMemoryCuratorValidationResult {
  const eligible_item_ids = item_results.filter((item) => item.outcome === "eligible").map((item) => item.item_id);
  const rejected_item_ids = item_results.filter((item) => item.outcome === "rejected").map((item) => item.item_id);
  const quarantined_item_ids = item_results.filter((item) => item.outcome === "quarantined").map((item) => item.item_id);
  const noop_refs = item_results.filter((item) => item.outcome === "noop").map((item) => item.item_id);
  return {
    ok: global_findings.length === 0 && (mode === "create" ? true : eligible_item_ids.length > 0 && rejected_item_ids.length === 0 && quarantined_item_ids.length === 0),
    mode,
    project_key: packet.project_key,
    global_findings,
    item_results,
    eligible_item_ids,
    rejected_item_ids,
    quarantined_item_ids,
    noop_refs,
  };
}

function globalFailure(packet: ProjectMemoryPacket, mode: "create" | "maintain", code: string, message: string): ProjectMemoryCuratorValidationResult {
  return result(packet, mode, [finding("blocker", code, message)], []);
}

function resolvePacketRef(packet: ProjectMemoryPacket, ref: ProjectMemoryEvidenceRef): boolean {
  if (!ref || typeof ref.ref !== "string" || ref.ref.length === 0) return false;
  if (ref.kind === "project_handoff") return packet.pending.project_handoffs.some((item) => item.id === ref.ref);
  if (ref.kind === "project_candidate") return packet.pending.project_candidates.some((item) => item.id === ref.ref);
  if (ref.kind === "session_memory") return packet.session_memory.selected.some((item) => item.id === ref.ref);
  if (ref.kind === "wiki_page") return packet.wiki.pages.some((page) => page.path === ref.ref || page.path === `wiki/${ref.ref}`);
  if (ref.kind === "lookup_result") return packet.lookup.results.some((_, index) => ref.ref === `lookup:${index}`);
  if (ref.kind === "project_state") return ["bootstrap_state", "project_memory", "freshness", "pages_manifest"].includes(ref.ref);
  return ref.kind === "repo_citation" || ref.kind === "inference";
}

function validEvidenceRefShape(ref: unknown): ref is ProjectMemoryEvidenceRef {
  return isRecord(ref) && typeof ref.kind === "string" && typeof ref.ref === "string" && ref.ref.length > 0;
}

function isAllowedOperation(operation: unknown): operation is ProjectMemoryMaintenanceProposalItem["operation"] {
  return typeof operation === "string" && PROJECT_MEMORY_MAINTENANCE_OPERATIONS.includes(operation as ProjectMemoryMaintenanceProposalItem["operation"]);
}

function isSafeWikiTarget(path: unknown): path is string {
  return typeof path === "string" && path.endsWith(".md") && !path.startsWith("/") && !path.split("/").includes("..");
}

function packetHasWikiPage(packet: ProjectMemoryPacket, path: string): boolean {
  return packet.wiki.pages.some((page) => page.path === path || page.path === `wiki/${path}`);
}

function lifecycleAllowed(operation: unknown, lifecycle: unknown): boolean {
  if (!isAllowedOperation(operation) || typeof lifecycle !== "string") return false;
  if (operation === "MARK_STALE") return lifecycle === "stale_pending";
  if (operation === "MARK_DISPUTED") return lifecycle === "disputed";
  if (operation === "SUPERSEDE_ENTRY") return lifecycle === "superseded";
  if (operation === "RETRACT_ENTRY") return lifecycle === "retracted";
  return lifecycle === "active";
}

function requiresRepoCitation(item: ProjectMemoryMaintenanceProposalItem): boolean {
  return REPO_GROUNDABLE_RE.test(item.content_intent) || (item.applicability.commands?.length ?? 0) > 0;
}

function hasInferenceExplanation(item: ProjectMemoryMaintenanceProposalItem): boolean {
  return Boolean(item.inference?.label && item.inference.why_direct_repo_evidence_is_unavailable);
}

function finding(severity: ProjectMemoryValidationFinding["severity"], code: string, message: string, item_id?: string, evidence_refs?: ProjectMemoryEvidenceRef[]): ProjectMemoryValidationFinding {
  return { severity, code, message, item_id, evidence_refs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **Step 2: Run focused validator tests**

Run: `bun test tests/project/project-memory-curator-validator.test.ts`
Expected: passes.

## Verification

- `bun test tests/project/project-memory-curator-validator.test.ts`
  - Expected: global hard errors, eligible item, rejected item, quarantined item, creation safety, missing target page, unsupported broad operation, lifecycle, repo-citation, degraded packet, and budget tests pass.
- `bun run typecheck`
  - Expected: validator imports and exported functions typecheck.

## Acceptance Criteria Covered

- Invalid proposals are rejected before wiki writes.
- Missing provenance, invalid or unknown packet references, and out-of-wiki targets are rejected.
- Unsupported broad operations, illegal lifecycle transitions, missing existing pages, protected state assignment, budget excesses, and missing repo citations for repo-groundable claims are rejected.
- High-risk and degraded-packet items are quarantined rather than silently eligible.
- Validation returns structured per-item outcomes.

## Risks And Rollback

- Risk: this chunk starts with mechanical checks only; semantic writing quality remains outside the validator.
- Risk: repo citation enforcement may need tightening in the service chunk once prompts define claim categories.
- Rollback: delete `src/project/project-memory-curator-validator.ts` and its test; contract exports remain useful but unused.

## Non-Goals

- No provider prompt invocation.
- No artifact writing.
- No command wiring.
- No markdown apply.
- No `runner.ts` deletion.

## Type And Name Consistency

Before marking this chunk done, verify `validateCuratorOutput`, `validateCreationDraft`, and `validateMaintenanceProposal` are exported and imported by the service chunk using the same names.
