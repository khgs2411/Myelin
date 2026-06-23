import {
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
  };
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  if (packet.mode !== "create") {
    globalFindings.push(finding("blocker", "mode", "creation_mode_required", "Creation draft requires packet mode create."));
  }
  if (!Array.isArray(draft.pages) || draft.pages.length === 0) {
    globalFindings.push(
      finding("blocker", "schema", "creation_pages_required", "Creation draft must include at least one page draft."),
    );
  }
  if (!Array.isArray(draft.evidence_refs) || draft.evidence_refs.length === 0) {
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

  return result(packet, "create", globalFindings, []);
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
  if (globalFindings.length > 0) return result(packet, "maintain", globalFindings, []);

  const itemResults = proposal.items.map((item) => validateMaintenanceItem(packet, item));
  return result(packet, "maintain", globalFindings, itemResults);
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
      finding("warn", "degraded_context", "packet_degraded", `Packet is degraded: ${packet.degraded_reasons.join("; ")}`, itemId),
    );
  }

  const hasBlocker = findings.some((entry) => entry.severity === "blocker");
  const hasQuarantine = findings.some((entry) => entry.code === "risk_requires_quarantine" || entry.code === "packet_degraded");
  return {
    item_id: itemId,
    outcome: hasBlocker ? "rejected" : hasQuarantine ? "quarantined" : item.operation === "NOOP" ? "noop" : "eligible",
    findings,
  };
}

function result(
  packet: ProjectMemoryPacket,
  mode: ProjectMemoryCuratorMode,
  global_findings: ProjectMemoryValidationFinding[],
  item_results: ProjectMemoryItemValidation[],
): ProjectMemoryCuratorValidationResult {
  const eligible_item_ids = item_results.filter((item) => item.outcome === "eligible").map((item) => item.item_id);
  const rejected_item_ids = item_results.filter((item) => item.outcome === "rejected").map((item) => item.item_id);
  const quarantined_item_ids = item_results.filter((item) => item.outcome === "quarantined").map((item) => item.item_id);
  const noop_refs = item_results.filter((item) => item.outcome === "noop").map((item) => item.item_id);
  const hasGlobalBlocker = global_findings.some((entry) => entry.severity === "blocker");
  return {
    ok:
      !hasGlobalBlocker &&
      (mode === "create" ||
        (eligible_item_ids.length > 0 && rejected_item_ids.length === 0 && quarantined_item_ids.length === 0)),
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
  if (ref.kind === "lookup_result") return packet.lookup.results.some((_, index) => ref.ref === `lookup:${index}`);
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
