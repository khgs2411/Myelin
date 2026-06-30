import {
  PROJECT_MEMORY_CREATION_MIN_PAGES,
  PROJECT_MEMORY_LIFECYCLE_INTENTS,
  PROJECT_MEMORY_MAINTENANCE_OPERATIONS,
  type ProjectMemoryCreationDraft,
  type ProjectMemoryCuratorMode,
  type ProjectMemoryCuratorOutput,
  type ProjectMemoryCuratorValidationResult,
  type ProjectMemoryEvidenceRef,
  type ProjectMemoryItemValidation,
  type ProjectMemoryMaintenanceOperation,
  type ProjectMemoryMaintenanceProposal,
  type ProjectMemoryMaintenanceProposalItem,
  type ProjectMemoryValidationFinding,
  type ProjectMemoryValidatorIssueCategory,
} from "./project-memory-curator-contracts.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

const MAX_MAINTENANCE_ITEMS = 25;
const MAX_ITEM_CONTENT_CHARS = 4_000;
const REPO_GROUNDABLE_RE =
  /\b(command|cli|runtime|setup|test|file|path|import|export|function|class|api|schema|migration|build|typecheck|myelin|bun|npm)\b/i;

export function validateCuratorOutput(
  packet: ProjectMemoryPacket,
  output: unknown,
): ProjectMemoryCuratorValidationResult {
  const envelope = isRecord(output) ? output : null;
  if (!envelope) return globalFailure(packet, packet.mode, "schema", "invalid_json_shape", "Curator output must be a JSON object.");

  const mode = envelope.mode === "maintain" ? "maintain" : "create";
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  if (envelope.schema_version !== 1) {
    globalFindings.push(finding("blocker", "schema", "schema_version_mismatch", "Curator output schema_version must be 1."));
  }
  if (envelope.project_key !== packet.project_key) {
    globalFindings.push(
      finding("blocker", "project_key", "project_key_mismatch", `Curator output project_key must be ${packet.project_key}.`),
    );
  }
  if (envelope.mode !== packet.mode) {
    globalFindings.push(finding("blocker", "mode", "mode_mismatch", `Curator output mode must be ${packet.mode}.`));
  }
  if (
    !isRecord(envelope.packet_ref) ||
    envelope.packet_ref.artifact !== "input-packet.json" ||
    envelope.packet_ref.packet_schema_version !== packet.schema_version
  ) {
    globalFindings.push(
      finding(
        "blocker",
        "packet_ref",
        "packet_ref_mismatch",
        "Curator output packet_ref must point at input-packet.json with the packet schema version.",
      ),
    );
  }

  if (globalFindings.length > 0) return result(packet, mode, globalFindings, []);
  if (mode === "maintain") return validateMaintenanceProposal(packet, output as ProjectMemoryMaintenanceProposal);
  return validateCreationDraft(packet, output as ProjectMemoryCreationDraft);
}

export function validateCreationDraft(
  packet: ProjectMemoryPacket,
  output: ProjectMemoryCuratorOutput,
): ProjectMemoryCuratorValidationResult {
  const draft = output as ProjectMemoryCreationDraft & {
    pages?: unknown[];
    evidence_refs?: unknown[];
    state_intent?: unknown;
    explicit_noop_decisions?: unknown;
  };
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  const hasPages = Array.isArray(draft.pages) && draft.pages.length > 0;
  const noopValidation = validateExplicitNoopDecisions(packet, draft.explicit_noop_decisions, hasPages);
  globalFindings.push(...noopValidation.findings);
  if (packet.mode !== "create") {
    globalFindings.push(finding("blocker", "mode", "creation_mode_required", "Creation draft requires packet mode create."));
  }
  if (!hasPages && noopValidation.noopRefs.length === 0) {
    globalFindings.push(
      finding("blocker", "schema", "creation_pages_required", "Creation draft must include at least one page draft."),
    );
  }
  if (hasPages && (!Array.isArray(draft.evidence_refs) || draft.evidence_refs.length === 0)) {
    globalFindings.push(
      finding("blocker", "provenance", "creation_evidence_required", "Creation draft must include proposal-level evidence refs."),
    );
  }

  for (const ref of draft.evidence_refs ?? []) {
    if (!validEvidenceRefShape(ref) || !resolvePacketRef(packet, ref)) {
      globalFindings.push(
        finding(
          "blocker",
          "provenance",
          "invalid_creation_evidence_ref",
          `Invalid creation evidence ref: ${describeRef(ref)}`,
          undefined,
          validEvidenceRefShape(ref) ? [ref] : undefined,
        ),
      );
    }
  }

  for (const page of draft.pages ?? []) {
    const item: Record<string, unknown> = isRecord(page) ? page : {};
    const target = isRecord(item.target) ? item.target : {};
    if (!isSafeWikiTarget(target.path)) {
      globalFindings.push(
        finding("blocker", "path", "creation_target_path_outside_wiki", "Creation page targets must stay inside project wiki."),
      );
    }
    if (target.path_kind !== "new_wiki_page" && target.path_kind !== "existing_wiki_page") {
      globalFindings.push(
        finding("blocker", "path", "unsupported_creation_target_kind", "Creation page target must be a wiki page."),
      );
    }
    const pageEvidence = Array.isArray(item.evidence_refs) ? item.evidence_refs : [];
    if (pageEvidence.length === 0) {
      globalFindings.push(
        finding("blocker", "provenance", "creation_page_evidence_required", "Every creation page draft needs evidence refs."),
      );
    }
    if (!Array.isArray(item.repo_citations) || item.repo_citations.length === 0) {
      globalFindings.push(
        finding(
          "blocker",
          "repo_citation",
          "creation_page_repo_citation_required",
          "Creation page drafts require direct repo citations; packet-only inference is not enough to curate initial Project Memory.",
          typeof item.id === "string" ? item.id : undefined,
        ),
      );
    }
    const payloadFindings = validateApplyPayload(item.apply_payload, {
      mode: "create",
      targetPath: typeof target.path === "string" ? target.path : undefined,
      itemId: typeof item.id === "string" ? item.id : undefined,
      packet,
    });
    globalFindings.push(...payloadFindings);
  }

  if (hasPages && !creationPublicationMinimumMet(draft.pages ?? [])) {
    globalFindings.push(
      finding(
        "blocker",
        "schema",
        "creation_publication_minimum_not_met",
        `Creation apply requires index.md plus at least ${PROJECT_MEMORY_CREATION_MIN_PAGES - 1} repo-grounded non-index pages.`,
      ),
    );
  }

  if (isRecord(draft.state_intent)) {
    const allowed = new Set(["mark_project_memory_curated", "freshness_intent"]);
    for (const key of Object.keys(draft.state_intent)) {
      if (!allowed.has(key)) {
        globalFindings.push(
          finding(
            "blocker",
            "protected_state",
            "protected_state_assignment",
            `Creation draft cannot self-assign protected state field: ${key}.`,
          ),
        );
      }
    }
  }

  return result(packet, "create", globalFindings, [], noopValidation.noopRefs);
}

export function validateMaintenanceProposal(
  packet: ProjectMemoryPacket,
  proposal: ProjectMemoryMaintenanceProposal,
): ProjectMemoryCuratorValidationResult {
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  if (packet.mode !== "maintain") {
    globalFindings.push(
      finding("blocker", "mode", "maintenance_mode_required", "Maintenance proposal requires packet mode maintain."),
    );
  }
  if (!Array.isArray(proposal.items)) {
    globalFindings.push(finding("blocker", "schema", "items_required", "Maintenance proposal must include an items array."));
  }
  if (Array.isArray(proposal.items) && proposal.items.length > MAX_MAINTENANCE_ITEMS) {
    globalFindings.push(
      finding(
        "blocker",
        "budget",
        "proposal_item_budget_exceeded",
        `Maintenance proposal must include at most ${MAX_MAINTENANCE_ITEMS} items.`,
      ),
    );
  }
  const hasItems = Array.isArray(proposal.items) && proposal.items.length > 0;
  const noopInputsValidation = validateNoopInputs(packet, proposal.noop_inputs);
  const noopValidation = validateExplicitNoopDecisions(
    packet,
    proposal.explicit_noop_decisions,
    hasItems,
    noopInputsValidation.validCount,
  );
  globalFindings.push(...noopValidation.findings);
  globalFindings.push(...noopInputsValidation.findings);
  const noopRefs = [...noopValidation.noopRefs, ...noopInputsValidation.noopRefs];
  if (globalFindings.length > 0) return result(packet, "maintain", globalFindings, [], noopRefs);

  const itemResults = proposal.items.map((item) => validateMaintenanceItem(packet, item));
  return result(packet, "maintain", globalFindings, itemResults, noopRefs);
}

export function validateMaintenanceItem(
  packet: ProjectMemoryPacket,
  item: ProjectMemoryMaintenanceProposalItem,
): ProjectMemoryItemValidation {
  const findings: ProjectMemoryValidationFinding[] = [];
  const itemId = typeof item.id === "string" && item.id.length > 0 ? item.id : "unknown";
  if (!item.id) findings.push(finding("blocker", "schema", "missing_item_id", "Maintenance item requires id.", itemId));
  if (!isAllowedOperation(item.operation)) {
    findings.push(finding("blocker", "operation", "unknown_operation", `Unsupported operation: ${String(item.operation)}`, itemId));
  }
  if (!isSafeWikiTarget(item.target_page?.path)) {
    findings.push(finding("blocker", "path", "target_path_outside_wiki", "Target page must be a project wiki-relative markdown path.", itemId));
  } else if (item.target_page?.path_kind !== "existing_wiki_page") {
    findings.push(
      finding(
        "blocker",
        "path",
        "unsupported_maintenance_target_kind",
        "Maintenance proposal items must target existing Project Memory wiki pages.",
        itemId,
      ),
    );
  } else if (!packetHasWikiPage(packet, item.target_page.path)) {
    findings.push(
      finding("blocker", "path", "target_page_missing", "Existing-page operation target must exist in packet wiki pages.", itemId),
    );
  }
  if (typeof item.content_intent === "string" && item.content_intent.length > MAX_ITEM_CONTENT_CHARS) {
    findings.push(
      finding(
        "blocker",
        "budget",
        "item_content_budget_exceeded",
        `Item content_intent must be at most ${MAX_ITEM_CONTENT_CHARS} characters.`,
        itemId,
      ),
    );
  }

  for (const ref of item.source_packet_refs ?? []) {
    if (!validEvidenceRefShape(ref)) {
      findings.push(finding("blocker", "provenance", "invalid_source_packet_ref", "Source packet refs require kind and ref strings.", itemId));
    } else if (!resolvePacketRef(packet, ref)) {
      findings.push(
        finding("blocker", "provenance", "unknown_source_packet_ref", `Unknown source packet ref: ${ref.kind}:${ref.ref}`, itemId, [ref]),
      );
    }
  }
  for (const ref of item.evidence_refs ?? []) {
    if (!validEvidenceRefShape(ref)) {
      findings.push(finding("blocker", "provenance", "invalid_evidence_ref", "Evidence refs require kind and ref strings.", itemId));
    } else if (!resolvePacketRef(packet, ref)) {
      findings.push(
        finding("blocker", "provenance", "unknown_evidence_ref", `Unknown evidence ref: ${ref.kind}:${ref.ref}`, itemId, [ref]),
      );
    }
  }
  if (!Array.isArray(item.source_packet_refs) || item.source_packet_refs.length === 0) {
    findings.push(finding("blocker", "provenance", "missing_source_packet_refs", "Maintenance item requires source packet refs.", itemId));
  }
  if (!Array.isArray(item.evidence_refs) || item.evidence_refs.length === 0) {
    findings.push(finding("blocker", "provenance", "missing_evidence_refs", "Maintenance item requires evidence refs.", itemId));
  }
  if (!lifecycleAllowed(item.operation, item.lifecycle_intent)) {
    findings.push(
      finding(
        "blocker",
        "lifecycle",
        "illegal_lifecycle_transition",
        `Operation ${String(item.operation)} cannot set lifecycle ${String(item.lifecycle_intent)}.`,
        itemId,
      ),
    );
  }
  if (
    requiresRepoCitation(item) &&
    (!Array.isArray(item.repo_citations) || item.repo_citations.length === 0) &&
    !hasInferenceExplanation(item)
  ) {
    findings.push(
      finding(
        "blocker",
        "repo_citation",
        "missing_repo_citation",
        "Repo-groundable claims require repo citations or an explicit inference explanation.",
        itemId,
      ),
    );
  }
  if (item.risk?.requires_quarantine || item.risk?.level === "high") {
    findings.push(finding("warn", "risk", "risk_requires_quarantine", "High-risk item must be quarantined before apply.", itemId));
  }
  if (packet.degraded) {
    findings.push(
      finding(
        "warn",
        "degraded_context",
        "packet_degraded",
        `Packet has blocking degraded context: ${packet.degraded_reasons.join("; ")}`,
        itemId,
      ),
    );
  }
  findings.push(...validateEvidenceDependencies(packet, item, itemId));
  findings.push(
    ...validateApplyPayload(item.apply_payload, {
      mode: "maintain",
      targetPath: item.target_page?.path,
      itemId,
      packet,
      operation: item.operation,
      expectedEntryId: item.operation === "CREATE_ENTRY" ? item.proposed_entry_id : item.target_entry_id,
    }),
  );

  const hasBlocker = findings.some((entry) => entry.severity === "blocker");
  const hasQuarantine = findings.some((entry) =>
    entry.code === "risk_requires_quarantine" ||
      entry.code === "packet_degraded" ||
      entry.code === "lookup_dependency_fallback_requires_review"
  );
  return {
    item_id: itemId,
    outcome: hasBlocker ? "rejected" : hasQuarantine ? "quarantined" : item.operation === "NOOP" ? "noop" : "eligible",
    findings,
  };
}

function validateApplyPayload(
  payload: unknown,
  input: {
    mode: ProjectMemoryCuratorMode;
    targetPath?: string;
    itemId?: string;
    packet: ProjectMemoryPacket;
    operation?: unknown;
    expectedEntryId?: string;
  },
): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (!isRecord(payload)) {
    findings.push(finding("blocker", "schema", "apply_payload_required", "Concrete apply_payload is required before apply.", input.itemId));
    return findings;
  }
  if (payload.schema_version !== 1) {
    findings.push(finding("blocker", "schema", "apply_payload_schema_version", "apply_payload.schema_version must be 1.", input.itemId));
  }

  if (input.mode === "create") {
    if (!Array.isArray(payload.pages) || payload.pages.length === 0) {
      findings.push(finding("blocker", "schema", "apply_payload_pages_required", "Creation apply_payload requires page drafts.", input.itemId));
      return findings;
    }
    if (payload.pages.length !== 1) {
      findings.push(
        finding(
          "blocker",
          "schema",
          "apply_payload_page_count_invalid",
          "Creation apply_payload must contain exactly one page matching the page draft target.",
          input.itemId,
        ),
      );
    }
    const page = payload.pages.find((candidate) => isRecord(candidate) && candidate.page_path === input.targetPath);
    if (!isRecord(page)) {
      findings.push(finding("blocker", "schema", "apply_payload_page_target_missing", "Creation apply_payload must include the target page.", input.itemId));
      return findings;
    }
    findings.push(...validatePageDraft(page, input));
    return findings;
  }

  if (input.operation === "NOOP") return findings;
  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    findings.push(finding("blocker", "schema", "apply_payload_entries_required", "Maintenance apply_payload requires entry drafts.", input.itemId));
    return findings;
  }
  const entry = isRecord(payload.entries[0]) ? payload.entries[0] : null;
  if (!entry) {
    findings.push(finding("blocker", "schema", "apply_payload_entry_invalid", "Maintenance apply_payload entry must be an object.", input.itemId));
    return findings;
  }
  if (input.expectedEntryId && entry.entry_id !== input.expectedEntryId) {
    findings.push(
      finding("blocker", "schema", "apply_payload_entry_id_mismatch", "Maintenance apply_payload entry id must match the target/proposed entry id.", input.itemId),
    );
  }
  findings.push(...validateEntryDraft(entry, input));
  return findings;
}

function validatePageDraft(
  page: Record<string, unknown>,
  input: { targetPath?: string; itemId?: string; packet: ProjectMemoryPacket },
): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (page.page_path !== input.targetPath || !isSafeWikiTarget(page.page_path)) {
    findings.push(finding("blocker", "path", "apply_payload_page_path_invalid", "Apply payload page_path must match a safe wiki target.", input.itemId));
  }
  if (!nonEmptyString(page.title) || !nonEmptyString(page.purpose)) {
    findings.push(finding("blocker", "schema", "apply_payload_page_metadata_required", "Page drafts require title and purpose.", input.itemId));
  }
  findings.push(...validateMarkdownLines(page.body, "apply_payload_page_body_invalid", input.itemId));
  findings.push(...validateApplyProvenance(page, input.packet, input.itemId));
  return findings;
}

function validateEntryDraft(
  entry: Record<string, unknown>,
  input: { itemId?: string; packet: ProjectMemoryPacket },
): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (!nonEmptyString(entry.entry_id) || !nonEmptyString(entry.title)) {
    findings.push(finding("blocker", "schema", "apply_payload_entry_metadata_required", "Entry drafts require entry_id and title.", input.itemId));
  }
  if (
    typeof entry.lifecycle !== "string" ||
    !PROJECT_MEMORY_LIFECYCLE_INTENTS.includes(entry.lifecycle as (typeof PROJECT_MEMORY_LIFECYCLE_INTENTS)[number])
  ) {
    findings.push(finding("blocker", "lifecycle", "apply_payload_entry_lifecycle_invalid", "Entry draft lifecycle is not supported.", input.itemId));
  }
  findings.push(...validateMarkdownLines(entry.body, "apply_payload_entry_body_invalid", input.itemId));
  findings.push(...validateApplyProvenance(entry, input.packet, input.itemId));
  return findings;
}

function validateMarkdownLines(body: unknown, code: string, itemId?: string): ProjectMemoryValidationFinding[] {
  if (!isRecord(body) || !Array.isArray(body.paragraphs) || body.paragraphs.some((line) => !nonEmptyString(line))) {
    return [finding("blocker", "schema", code, "Apply payload markdown body requires non-empty paragraph strings.", itemId)];
  }
  for (const key of ["bullets", "warnings"] as const) {
    const value = body[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((line) => !nonEmptyString(line)))) {
      return [finding("blocker", "schema", code, "Apply payload markdown lists must contain non-empty strings.", itemId)];
    }
  }
  return [];
}

function validateApplyProvenance(
  value: Record<string, unknown>,
  packet: ProjectMemoryPacket,
  itemId?: string,
): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  const evidenceRefs = Array.isArray(value.evidence_refs) ? value.evidence_refs : [];
  const repoCitations = Array.isArray(value.repo_citations) ? value.repo_citations : [];
  const inference = isRecord(value.inference) ? value.inference : null;
  if (evidenceRefs.length === 0) {
    findings.push(finding("blocker", "provenance", "apply_payload_evidence_required", "Apply payload requires evidence refs.", itemId));
  }
  for (const ref of evidenceRefs) {
    if (!validEvidenceRefShape(ref) || !resolvePacketRef(packet, ref)) {
      findings.push(
        finding(
          "blocker",
          "provenance",
          "apply_payload_evidence_invalid",
          `Invalid apply payload evidence ref: ${describeRef(ref)}`,
          itemId,
          validEvidenceRefShape(ref) ? [ref] : undefined,
        ),
      );
    }
  }
  if (repoCitations.length === 0 && !validInference(inference)) {
    findings.push(
      finding(
        "blocker",
        "repo_citation",
        "apply_payload_provenance_insufficient",
        "Apply payload requires repo citations or an explicit inference label.",
        itemId,
      ),
    );
  }
  if (itemId && repoCitations.length === 0 && isCreationApplyPayloadPage(value)) {
    findings.push(
      finding(
        "blocker",
        "repo_citation",
        "creation_apply_payload_repo_citation_required",
        "Creation apply payload pages require direct repo citations; packet-only inference is not enough to curate initial Project Memory.",
        itemId,
      ),
    );
  }
  return findings;
}

function isCreationApplyPayloadPage(value: Record<string, unknown>): boolean {
  return typeof value.page_path === "string";
}

function creationPublicationMinimumMet(pages: unknown[]): boolean {
  const pageRecords = pages.filter(isRecord);
  const hasIndex = pageRecords.some((page) => isRecord(page.target) && page.target.path === "index.md");
  const nonIndexPages = pageRecords.filter((page) => isRecord(page.target) && page.target.path !== "index.md");
  return hasIndex && nonIndexPages.length >= PROJECT_MEMORY_CREATION_MIN_PAGES - 1;
}

function result(
  packet: ProjectMemoryPacket,
  mode: ProjectMemoryCuratorMode,
  global_findings: ProjectMemoryValidationFinding[],
  item_results: ProjectMemoryItemValidation[],
  global_noop_refs: string[] = [],
): ProjectMemoryCuratorValidationResult {
  const eligible_item_ids = item_results.filter((item) => item.outcome === "eligible").map((item) => item.item_id);
  const rejected_item_ids = item_results.filter((item) => item.outcome === "rejected").map((item) => item.item_id);
  const quarantined_item_ids = item_results.filter((item) => item.outcome === "quarantined").map((item) => item.item_id);
  const noop_refs = [...global_noop_refs, ...item_results.filter((item) => item.outcome === "noop").map((item) => item.item_id)];
  const hasGlobalBlocker = global_findings.some((entry) => entry.severity === "blocker");
  const hasItemFailures = rejected_item_ids.length > 0 || quarantined_item_ids.length > 0;
  return {
    ok:
      !hasGlobalBlocker &&
      (mode === "create" ||
        ((eligible_item_ids.length > 0 || noop_refs.length > 0) && !hasItemFailures)),
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

function globalFailure(
  packet: ProjectMemoryPacket,
  mode: ProjectMemoryCuratorMode,
  category: ProjectMemoryValidatorIssueCategory,
  code: string,
  message: string,
): ProjectMemoryCuratorValidationResult {
  return result(packet, mode, [finding("blocker", category, code, message)], []);
}

function resolvePacketRef(packet: ProjectMemoryPacket, ref: ProjectMemoryEvidenceRef): boolean {
  if (!ref || typeof ref.ref !== "string" || ref.ref.length === 0) return false;
  if (ref.kind === "project_handoff") return packet.pending.project_handoffs.some((item) => item.id === ref.ref);
  if (ref.kind === "project_candidate") return packet.pending.project_candidates.some((item) => item.id === ref.ref);
  if (ref.kind === "session_memory") return packet.session_memory.selected.some((item) => item.id === ref.ref);
  if (ref.kind === "wiki_page") return packetHasWikiPage(packet, ref.ref);
  if (ref.kind === "lookup_result") {
    return packet.lookup.results.some((result, index) => ref.ref === result.id || ref.ref === `lookup:${index}`);
  }
  if (ref.kind === "project_state") return ["bootstrap_state", "project_memory", "freshness", "pages_manifest"].includes(ref.ref);
  return ref.kind === "repo_citation" || ref.kind === "inference";
}

function validEvidenceRefShape(ref: unknown): ref is ProjectMemoryEvidenceRef {
  return isRecord(ref) && typeof ref.kind === "string" && typeof ref.ref === "string" && ref.ref.length > 0;
}

function isAllowedOperation(operation: unknown): operation is ProjectMemoryMaintenanceOperation {
  return typeof operation === "string" && PROJECT_MEMORY_MAINTENANCE_OPERATIONS.includes(operation as ProjectMemoryMaintenanceOperation);
}

function isSafeWikiTarget(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.endsWith(".md") &&
    !path.startsWith("/") &&
    !path.startsWith("wiki/") &&
    !path.split("/").includes("..")
  );
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

function validInference(value: Record<string, unknown> | null): boolean {
  return Boolean(
    value &&
      typeof value.label === "string" &&
      value.label.length > 0 &&
      typeof value.why_direct_repo_evidence_is_unavailable === "string" &&
      value.why_direct_repo_evidence_is_unavailable.length > 0,
  );
}

function finding(
  severity: ProjectMemoryValidationFinding["severity"],
  category: ProjectMemoryValidatorIssueCategory,
  code: string,
  message: string,
  item_id?: string,
  evidence_refs?: ProjectMemoryEvidenceRef[],
): ProjectMemoryValidationFinding {
  return { severity, category, code, message, item_id, evidence_refs };
}

function describeRef(ref: unknown): string {
  if (!isRecord(ref)) return String(ref);
  return `${String(ref.kind)}:${String(ref.ref)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function packetHasInputs(packet: ProjectMemoryPacket): boolean {
  return (
    packet.pending.project_handoffs.length > 0 ||
    packet.pending.project_candidates.length > 0 ||
    packet.session_memory.selected.length > 0
  );
}

function packetUsedFallbackLookup(packet: ProjectMemoryPacket): boolean {
  return packet.lookup.results.some((entry) => entry.lookup_quality === "fallback");
}

function validateExplicitNoopDecisions(
  packet: ProjectMemoryPacket,
  decisions: unknown,
  hasWriteProposals: boolean,
  documentedNoopInputCount = 0,
): { findings: ProjectMemoryValidationFinding[]; noopRefs: string[] } {
  const findings: ProjectMemoryValidationFinding[] = [];
  const noopRefs: string[] = [];
  const values = Array.isArray(decisions) ? decisions : [];

  if (
    !hasWriteProposals &&
    packetHasInputs(packet) &&
    packetUsedFallbackLookup(packet) &&
    values.length === 0 &&
    documentedNoopInputCount === 0
  ) {
    findings.push(
      finding(
        "blocker",
        "explicit_noop",
        "noop_missing_explicit_decision",
        "Fallback lookup with zero write proposals requires an explicit no-op decision or documented noop_inputs.",
      ),
    );
  }

  for (const decision of values) {
    if (!isRecord(decision) || typeof decision.id !== "string") {
      findings.push(finding("blocker", "explicit_noop", "noop_invalid_shape", "Explicit no-op decision requires an id."));
      continue;
    }
    if (decision.reason === "insufficient_evidence") {
      findings.push(
        finding(
          "blocker",
          "explicit_noop",
          "noop_insufficient_evidence",
          "Insufficient-evidence no-op remains reviewable.",
          decision.id,
        ),
      );
    }
    const sourceRefs = Array.isArray(decision.source_packet_refs) ? decision.source_packet_refs : [];
    const checkedRefs = Array.isArray(decision.checked_existing_memory_refs) ? decision.checked_existing_memory_refs : [];
    if (sourceRefs.length === 0) {
      findings.push(
        finding("blocker", "explicit_noop", "noop_missing_source_refs", "Explicit no-op requires source packet refs.", decision.id),
      );
    }
    if (packetUsedFallbackLookup(packet) && checkedRefs.length === 0) {
      findings.push(
        finding(
          "blocker",
          "explicit_noop",
          "noop_missing_checked_memory_refs",
          "Fallback no-op requires checked existing memory refs.",
          decision.id,
        ),
      );
    }
    for (const ref of checkedRefs) {
      if (isRecord(ref) && ref.kind === "lookup_result" && typeof ref.ref === "string" && !lookupResult(packet, ref.ref)) {
        findings.push(
          finding("blocker", "explicit_noop", "noop_checked_lookup_missing", `Unknown checked lookup ref: ${ref.ref}`, decision.id),
        );
      }
    }
    noopRefs.push(decision.id);
  }

  return { findings, noopRefs };
}

function validateNoopInputs(
  packet: ProjectMemoryPacket,
  inputs: unknown,
): { findings: ProjectMemoryValidationFinding[]; validCount: number; noopRefs: string[] } {
  const findings: ProjectMemoryValidationFinding[] = [];
  const values = Array.isArray(inputs) ? inputs : [];
  let validCount = 0;
  const noopRefs: string[] = [];
  for (const input of values) {
    if (!isRecord(input) || !isRecord(input.source_packet_ref) || typeof input.reason !== "string") {
      findings.push(finding("blocker", "explicit_noop", "noop_input_invalid_shape", "noop_inputs require source_packet_ref and reason."));
      continue;
    }
    if (!validEvidenceRefShape(input.source_packet_ref) || !resolvePacketRef(packet, input.source_packet_ref)) {
      findings.push(
        finding(
          "blocker",
          "explicit_noop",
          "noop_input_source_ref_invalid",
          `Invalid noop_inputs source ref: ${describeRef(input.source_packet_ref)}`,
          undefined,
          validEvidenceRefShape(input.source_packet_ref) ? [input.source_packet_ref] : undefined,
        ),
      );
      continue;
    }
    validCount += 1;
    noopRefs.push(`noop_input:${input.source_packet_ref.kind}:${input.source_packet_ref.ref}`);
  }
  return { findings, validCount, noopRefs };
}

function validateEvidenceDependencies(
  packet: ProjectMemoryPacket,
  item: ProjectMemoryMaintenanceProposalItem,
  itemId: string,
): ProjectMemoryValidationFinding[] {
  const dependencies = Array.isArray(item.evidence_dependencies) ? item.evidence_dependencies : [];
  const findings: ProjectMemoryValidationFinding[] = [];
  for (const dependency of dependencies) {
    if (!isRecord(dependency) || dependency.kind !== "lookup_result" || typeof dependency.ref !== "string") continue;
    const lookup = lookupResult(packet, dependency.ref);
    if (!lookup) {
      findings.push(
        finding("blocker", "lookup_dependency", "lookup_dependency_missing", `Unknown lookup dependency: ${dependency.ref}`, itemId),
      );
      continue;
    }
    if (
      lookup.lookup_freshness === "stale" ||
      lookup.lookup_freshness === "orphaned" ||
      lookup.lookup_quality === "unavailable"
    ) {
      findings.push(
        finding(
          "blocker",
          "lookup_dependency",
          "lookup_dependency_stale",
          `Lookup dependency is ${lookup.lookup_freshness}.`,
          itemId,
        ),
      );
      continue;
    }
    if (packet.mode === "maintain" && lookup.lookup_quality === "fallback") {
      findings.push(
        finding(
          "warn",
          "lookup_dependency",
          "lookup_dependency_fallback_requires_review",
          "Maintenance writes depending on fallback lookup require review.",
          itemId,
        ),
      );
    }
  }
  return findings;
}

function lookupResult(packet: ProjectMemoryPacket, ref: string) {
  return packet.lookup.results.find((result, index) => ref === result.id || ref === `lookup:${index}`) ?? null;
}
