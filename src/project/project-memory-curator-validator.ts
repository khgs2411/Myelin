import {
  PROJECT_MEMORY_CREATION_MIN_PAGES,
  PROJECT_MEMORY_LEGACY_MAINTENANCE_OPERATIONS,
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
  type ProjectMemoryDocumentationContract,
  type ProjectMemoryValidationFinding,
  type ProjectMemoryValidatorIssueCategory,
} from "./project-memory-curator-contracts.ts";
import {
  evaluateProjectMemoryQuality,
  isTrustedProjectMemoryQuality,
  PROJECT_MEMORY_CANDIDATE_DISPOSITIONS,
  PROJECT_MEMORY_CONTENT_QUALITY_STATUSES,
  PROJECT_MEMORY_ANSWER_DOMAINS,
  PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES,
  type ProjectMemoryAnswerDomain,
  type ProjectMemoryQualityDiagnostics,
  type ProjectMemoryRetrievalReadinessStatus,
} from "./project-memory-quality-contract.ts";
import { missingRequiredOrientationSurfacesSync, orientationSurfaceSatisfied } from "./project-memory-orientation-contract.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";
import { resolveSectionTarget } from "./project-memory-section-targets.ts";
import { evaluateRenderedProjectMemoryQuality } from "./project-memory-rendered-quality.ts";
import type { ProjectMemoryEvidenceMap } from "./project-memory-evidence-map.ts";

const MAX_MAINTENANCE_ITEMS = 25;
const MAX_ITEM_CONTENT_CHARS = 4_000;
const REPO_GROUNDABLE_RE =
  /\b(command|cli|runtime|setup|test|file|path|import|export|function|class|api|schema|migration|build|typecheck|myelin|bun|npm)\b/i;

export type ProjectMemoryCuratorValidationOptions = {
  evidenceMap?: ProjectMemoryEvidenceMap;
};

export function validateCuratorOutput(
  packet: ProjectMemoryPacket,
  output: unknown,
  options: ProjectMemoryCuratorValidationOptions = {},
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

  const diagnostics = diagnosticsFromOutput(envelope, mode);
  if (!diagnostics) {
    globalFindings.push(
      finding("blocker", "schema", "quality_diagnostics_invalid", "Curator output must include valid quality_diagnostics."),
    );
  }
  if (globalFindings.length > 0) return result(packet, mode, globalFindings, [], [], diagnostics);
  if (mode === "maintain") return validateMaintenanceProposal(packet, output as ProjectMemoryMaintenanceProposal);
  return validateCreationDraft(packet, output as ProjectMemoryCreationDraft, options);
}

export function validateCreationDraft(
  packet: ProjectMemoryPacket,
  output: ProjectMemoryCuratorOutput,
  options: ProjectMemoryCuratorValidationOptions = {},
): ProjectMemoryCuratorValidationResult {
  const draft = output as ProjectMemoryCreationDraft & {
    pages?: unknown[];
    evidence_refs?: unknown[];
    state_intent?: unknown;
    explicit_noop_decisions?: unknown;
  };
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  const hasPages = Array.isArray(draft.pages) && draft.pages.length > 0;
  const diagnostics = diagnosticsFromCreationDraft(packet, draft, globalFindings, options);
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
  if (hasPages && !options.evidenceMap) {
    globalFindings.push(
      finding(
        "blocker",
        "evidence",
        "creation_evidence_map_required",
        "Create-mode validation requires the Project Memory evidence-map artifact before canonical writes.",
      ),
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
    } else {
      globalFindings.push(
        ...validateLinePreciseRepoCitations(
          item.repo_citations,
          "creation_page_repo_citation_line_required",
          "Creation page repo citations must include line_start for repo-grounded first-create claims.",
          typeof item.id === "string" ? item.id : undefined,
        ),
      );
    }
    const answerDomains = Array.isArray(item.answer_domains) ? item.answer_domains : [];
    if (
      answerDomains.length === 0 ||
      answerDomains.some((domain) => !PROJECT_MEMORY_ANSWER_DOMAINS.includes(domain as ProjectMemoryAnswerDomain))
    ) {
      globalFindings.push(
        finding("blocker", "schema", "creation_page_answer_domains_required", "Every creation page draft needs supported answer_domains.", typeof item.id === "string" ? item.id : undefined),
      );
    }
    for (const domain of answerDomains) {
      if (
        PROJECT_MEMORY_ANSWER_DOMAINS.includes(domain as ProjectMemoryAnswerDomain) &&
        options.evidenceMap &&
        evidenceRefsForDomain(options.evidenceMap, domain as ProjectMemoryAnswerDomain) === 0
      ) {
        globalFindings.push(
          finding(
            "blocker",
            "evidence",
            "creation_page_answer_domain_missing_evidence_map_support",
            `Creation page ${String(item.id ?? target.path ?? "unknown")} declares ${String(domain)} without supporting evidence-map refs.`,
            typeof item.id === "string" ? item.id : undefined,
          ),
        );
      }
    }
    if (!Array.isArray(item.required_topics) || item.required_topics.length === 0) {
      globalFindings.push(
        finding("blocker", "schema", "creation_page_required_topics_required", "Every creation page draft needs required_topics.", typeof item.id === "string" ? item.id : undefined),
      );
    }
    if (!Array.isArray(item.representative_questions) || item.representative_questions.length === 0) {
      globalFindings.push(
        finding("blocker", "schema", "creation_page_representative_questions_required", "Every creation page draft needs representative_questions.", typeof item.id === "string" ? item.id : undefined),
      );
    }
    if (!Array.isArray(item.inspected_surface_refs) || item.inspected_surface_refs.length === 0) {
      globalFindings.push(
        finding("blocker", "provenance", "creation_page_inspected_surfaces_required", "Every creation page draft needs inspected_surface_refs.", typeof item.id === "string" ? item.id : undefined),
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

  return result(packet, "create", globalFindings, [], noopValidation.noopRefs, diagnostics);
}

export function validateMaintenanceProposal(
  packet: ProjectMemoryPacket,
  proposal: ProjectMemoryMaintenanceProposal,
): ProjectMemoryCuratorValidationResult {
  const globalFindings: ProjectMemoryValidationFinding[] = [];
  const diagnostics = diagnosticsFromOutput(proposal, "maintain");
  if (!diagnostics) {
    globalFindings.push(
      finding("blocker", "schema", "quality_diagnostics_invalid", "Curator output must include valid quality_diagnostics."),
    );
  }
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
  if (
    diagnostics &&
    !isTrustedProjectMemoryQuality(diagnostics) &&
    (hasItems || noopValidation.noopRefs.length === 0 || diagnostics.content_quality.status === "blocked")
  ) {
    globalFindings.push(
      finding("blocker", "schema", "content_quality_not_trusted", "Project Memory content quality must be trusted before canonical writes."),
    );
  }
  if (globalFindings.length > 0) return result(packet, "maintain", globalFindings, [], noopRefs, diagnostics);

  const itemResults = proposal.items.map((item) => validateMaintenanceItem(packet, item));
  return result(packet, "maintain", globalFindings, itemResults, noopRefs, diagnostics);
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
  if (isLegacyOperation(item.operation)) {
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
  } else {
    findings.push(...validateSectionTarget(packet, item, itemId));
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
  if ((isLegacyOperation(item.operation) || !isAllowedOperation(item.operation)) && !lifecycleAllowed(item.operation, item.lifecycle_intent)) {
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
      targetPath: isLegacyOperation(item.operation) ? item.target_page?.path : item.target?.wiki_path,
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

function validateSectionTarget(
  packet: ProjectMemoryPacket,
  item: ProjectMemoryMaintenanceProposalItem,
  itemId: string,
): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  const target = isRecord(item.target) ? item.target : null;
  if (!target) return [finding("blocker", "schema", "section_target_required", "Maintenance item requires a section-first target.", itemId)];
  if (!isSafeWikiTarget(target.wiki_path)) {
    findings.push(finding("blocker", "path", "section_target_path_outside_wiki", "Section target wiki_path must be wiki-root relative markdown.", itemId));
    return findings;
  }
  if (typeof target.ownership_reason !== "string" || target.ownership_reason.length === 0) {
    findings.push(finding("blocker", "path", "section_target_ownership_required", "Section target requires ownership_reason.", itemId));
  }
  if (!["existing_section", "new_section_in_existing_page", "new_page"].includes(String(target.target_kind))) {
    findings.push(finding("blocker", "path", "section_target_kind_invalid", "Section target kind is unsupported.", itemId));
  }
  const expectedTargetKind = targetKindForOperation(item.operation);
  if (expectedTargetKind && target.target_kind !== expectedTargetKind) {
    findings.push(
      finding(
        "blocker",
        "path",
        "section_target_kind_mismatch",
        `Operation ${String(item.operation)} requires target_kind ${expectedTargetKind}.`,
        itemId,
      ),
    );
  }
  if ((item.candidate_disposition === "applied_to_project_memory") && (!Array.isArray(item.repo_citations) || item.repo_citations.length === 0) && !hasInferenceExplanation(item)) {
    findings.push(finding("blocker", "repo_citation", "applied_disposition_requires_evidence", "Applied Project Memory dispositions require repo citations or explicit inference.", itemId));
  }
  if ((target.target_kind === "existing_section" || mutatesExistingSection(item.operation)) && typeof target.section_id !== "string") {
    findings.push(finding("blocker", "path", "section_target_id_required", "Existing-section operations require section_id.", itemId));
  }
  if (mutatesExistingSection(item.operation) && !nonEmptyString(target.expected_section_hash)) {
    findings.push(
      finding(
        "blocker",
        "path",
        "section_target_hash_required",
        "Existing-section mutation operations require expected_section_hash.",
        itemId,
      ),
    );
  }
  if (target.target_kind === "existing_section" && typeof target.section_id === "string") {
    const resolved = resolveSectionTarget(packet.wiki.sections, {
      wiki_path: `wiki/${target.wiki_path}`,
      section_id: target.section_id,
      expected_section_hash: nonEmptyString(target.expected_section_hash) ? target.expected_section_hash : undefined,
    });
    if (resolved.status === "missing_section") {
      findings.push(finding("blocker", "path", "section_target_missing", "Section target must exist in packet wiki sections.", itemId));
    } else if (resolved.status === "stale_hash") {
      findings.push(finding("blocker", "path", "section_target_stale_hash", "Section target hash is stale.", itemId));
    }
  }
  if (target.target_kind === "new_section_in_existing_page" && !packetHasWikiPage(packet, target.wiki_path as string)) {
    findings.push(finding("blocker", "path", "section_target_page_missing", "CREATE_SECTION target page must exist in packet wiki pages.", itemId));
  }
  if (target.target_kind === "new_page" && !item.missing_coverage_diagnostic) {
    findings.push(finding("blocker", "path", "create_page_requires_missing_coverage", "CREATE_PAGE requires missing coverage justification.", itemId));
  }
  return findings;
}

function targetKindForOperation(operation: unknown): "existing_section" | "new_section_in_existing_page" | "new_page" | null {
  if (operation === "PATCH_SECTION" || operation === "ATTACH_EVIDENCE" || operation === "MARK_STALE" || operation === "MARK_DISPUTED") {
    return "existing_section";
  }
  if (operation === "CREATE_SECTION") return "new_section_in_existing_page";
  if (operation === "CREATE_PAGE") return "new_page";
  if (operation === "NOOP") return null;
  return null;
}

function mutatesExistingSection(operation: unknown): boolean {
  return targetKindForOperation(operation) === "existing_section";
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
    findings.push(...validatePageDraft(page, { ...input, requireLinePreciseRepoCitations: true }));
    return findings;
  }

  if (input.operation === "NOOP") return findings;
  if (!isLegacyOperation(input.operation)) {
    if (input.operation === "CREATE_PAGE") {
      if (!isRecord(payload.page)) {
        findings.push(finding("blocker", "schema", "apply_payload_page_required", "CREATE_PAGE requires apply_payload.page.", input.itemId));
        return findings;
      }
      findings.push(...validatePageDraft(payload.page, input));
      return findings;
    }
    if (!isRecord(payload.section)) {
      findings.push(finding("blocker", "schema", "apply_payload_section_required", "Section maintenance operations require apply_payload.section.", input.itemId));
      return findings;
    }
    findings.push(...validateSectionDraft(payload.section, input));
    return findings;
  }
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

function validateSectionDraft(
  section: Record<string, unknown>,
  input: { itemId?: string; packet: ProjectMemoryPacket; requireLinePreciseRepoCitations?: boolean },
): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (!nonEmptyString(section.heading) || typeof section.level !== "number") {
    findings.push(finding("blocker", "schema", "apply_payload_section_metadata_required", "Section drafts require heading and level.", input.itemId));
  }
  findings.push(...validateMarkdownLines(section.body, "apply_payload_section_body_invalid", input.itemId));
  findings.push(
    ...validateApplyProvenance(section, input.packet, input.itemId, {
      requireLinePreciseRepoCitations: input.requireLinePreciseRepoCitations,
    }),
  );
  return findings;
}

function validatePageDraft(
  page: Record<string, unknown>,
  input: { targetPath?: string; itemId?: string; packet: ProjectMemoryPacket; requireLinePreciseRepoCitations?: boolean },
): ProjectMemoryValidationFinding[] {
  const findings: ProjectMemoryValidationFinding[] = [];
  if (page.page_path !== input.targetPath || !isSafeWikiTarget(page.page_path)) {
    findings.push(finding("blocker", "path", "apply_payload_page_path_invalid", "Apply payload page_path must match a safe wiki target.", input.itemId));
  }
  if (!nonEmptyString(page.title) || !nonEmptyString(page.purpose)) {
    findings.push(finding("blocker", "schema", "apply_payload_page_metadata_required", "Page drafts require title and purpose.", input.itemId));
  }
  const sections = Array.isArray(page.sections) ? page.sections : [];
  if (sections.length === 0) {
    findings.push(finding("blocker", "schema", "apply_payload_page_sections_required", "Creation page payloads require rendered page sections.", input.itemId));
  }
  for (const section of sections) {
    if (!isRecord(section)) {
      findings.push(finding("blocker", "schema", "apply_payload_page_section_invalid", "Page sections must be objects.", input.itemId));
      continue;
    }
    findings.push(...validateSectionDraft(section, input));
  }
  findings.push(
    ...validateApplyProvenance(page, input.packet, input.itemId, {
      requireLinePreciseRepoCitations: input.requireLinePreciseRepoCitations,
    }),
  );
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
  options: { requireLinePreciseRepoCitations?: boolean } = {},
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
  if (options.requireLinePreciseRepoCitations) {
    findings.push(
      ...validateLinePreciseRepoCitations(
        repoCitations,
        "creation_apply_payload_repo_citation_line_required",
        "Create-mode apply payload repo citations must include line_start for repo-grounded first-create claims.",
        itemId,
      ),
    );
  }
  return findings;
}

function validateLinePreciseRepoCitations(
  repoCitations: unknown[],
  code: string,
  message: string,
  itemId?: string,
): ProjectMemoryValidationFinding[] {
  return repoCitations
    .filter((citation) => !isLinePreciseRepoCitation(citation))
    .map(() => finding("blocker", "repo_citation", code, message, itemId));
}

function isLinePreciseRepoCitation(citation: unknown): boolean {
  if (!isRecord(citation)) return false;
  if (typeof citation.line_start !== "number" || !Number.isInteger(citation.line_start) || citation.line_start < 1) return false;
  if (citation.line_end === undefined || citation.line_end === null) return true;
  return typeof citation.line_end === "number" && Number.isInteger(citation.line_end) && citation.line_end >= citation.line_start;
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
  quality_diagnostics?: ProjectMemoryQualityDiagnostics,
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
    quality_diagnostics,
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
  return (
    typeof operation === "string" &&
    (PROJECT_MEMORY_MAINTENANCE_OPERATIONS.includes(operation as (typeof PROJECT_MEMORY_MAINTENANCE_OPERATIONS)[number]) ||
      PROJECT_MEMORY_LEGACY_MAINTENANCE_OPERATIONS.includes(operation as (typeof PROJECT_MEMORY_LEGACY_MAINTENANCE_OPERATIONS)[number]))
  );
}

function isLegacyOperation(operation: unknown): boolean {
  return typeof operation === "string" && PROJECT_MEMORY_LEGACY_MAINTENANCE_OPERATIONS.includes(operation as (typeof PROJECT_MEMORY_LEGACY_MAINTENANCE_OPERATIONS)[number]);
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

function diagnosticsFromOutput(
  output: Record<string, unknown>,
  mode: ProjectMemoryCuratorMode,
): ProjectMemoryQualityDiagnostics | undefined {
  const parsed = parseQualityDiagnostics(output.quality_diagnostics);
  if (!parsed) return undefined;

  const reviewReasons = parsed.content_quality.status === "review_only" ? parsed.content_quality.reasons : [];
  const computed = evaluateProjectMemoryQuality({
    mode,
    domain_coverage: parsed.domain_coverage,
    role_coverage: parsed.role_coverage,
    candidate_dispositions: parsed.candidate_dispositions,
    missing_coverage: parsed.missing_coverage,
    shallow_summary_findings: parsed.shallow_summary_findings,
    answerability_findings: parsed.answerability_findings,
    blocked_reasons: [],
    review_reasons: reviewReasons,
  });
  const diagnostics = {
    ...computed,
    retrieval_readiness: parsed.retrieval_readiness,
  };

  if (parsed.content_quality.status !== diagnostics.content_quality.status) {
    diagnostics.content_quality.reasons = [
      ...diagnostics.content_quality.reasons,
      `curator quality status ${parsed.content_quality.status} contradicted computed status ${diagnostics.content_quality.status}`,
    ];
    if (parsed.content_quality.status !== "trusted") {
      diagnostics.content_quality = {
        status: parsed.content_quality.status,
        reasons: [...parsed.content_quality.reasons, ...diagnostics.content_quality.reasons],
      };
    }
  }
  return diagnostics;
}

function diagnosticsFromCreationDraft(
  packet: ProjectMemoryPacket,
  draft: ProjectMemoryCreationDraft & { documentation_contract?: unknown; pages?: unknown[] },
  globalFindings: ProjectMemoryValidationFinding[],
  options: ProjectMemoryCuratorValidationOptions,
): ProjectMemoryQualityDiagnostics | undefined {
  const parsed = parseQualityDiagnostics(draft.quality_diagnostics);
  if (!parsed) {
    globalFindings.push(
      finding("blocker", "schema", "quality_diagnostics_invalid", "Curator output must include valid quality_diagnostics."),
    );
    return undefined;
  }
  if ((!draft.pages || draft.pages.length === 0) && Array.isArray(draft.explicit_noop_decisions) && draft.explicit_noop_decisions.length > 0) {
    return parsed;
  }

  const contract = parseDocumentationContract(draft.documentation_contract);
  if (!contract) {
    globalFindings.push(
      finding("blocker", "schema", "documentation_contract_invalid", "Creation output must include valid documentation_contract."),
    );
  }

  const missingCoverage = [
    ...(contract?.missing_coverage ?? []),
    ...(contract ? orientationMissingCoverage(packet, contract) : ["documentation_contract missing"]),
    ...(options.evidenceMap
      ? options.evidenceMap.missing_domains.map((domain) => `evidence_map missing ${domain}`)
      : (draft.pages?.length ?? 0) > 0
        ? ["evidence_map missing"]
        : []),
  ];
  const reviewReasons = parsed.content_quality.status === "review_only" ? parsed.content_quality.reasons : [];
  const computed = evaluateRenderedProjectMemoryQuality({
    mode: "create",
    pages: (draft.pages ?? []) as ProjectMemoryCreationDraft["pages"],
    candidate_dispositions: parsed.candidate_dispositions,
    missing_coverage: missingCoverage,
    blocked_reasons: [],
    review_reasons: reviewReasons,
  });
  const diagnostics = {
    ...computed,
    retrieval_readiness: parsed.retrieval_readiness,
  };

  if (parsed.content_quality.status !== diagnostics.content_quality.status) {
    diagnostics.content_quality.reasons = [
      ...diagnostics.content_quality.reasons,
      `curator quality status ${parsed.content_quality.status} contradicted computed status ${diagnostics.content_quality.status}`,
    ];
    if (parsed.content_quality.status !== "trusted") {
      diagnostics.content_quality = {
        status: parsed.content_quality.status,
        reasons: [...parsed.content_quality.reasons, ...diagnostics.content_quality.reasons],
      };
    }
  }

  if (!isTrustedProjectMemoryQuality(diagnostics) || parsed.content_quality.status !== "trusted") {
    globalFindings.push(
      finding("blocker", "schema", "content_quality_not_trusted", "Project Memory content quality must be trusted before canonical writes."),
    );
  }
  return diagnostics;
}

function evidenceRefsForDomain(
  evidenceMap: ProjectMemoryEvidenceMap | undefined,
  domain: ProjectMemoryAnswerDomain,
): number {
  return evidenceMap?.domains.find((entry) => entry.domain === domain)?.evidence_refs.length ?? 0;
}

function parseDocumentationContract(value: unknown): ProjectMemoryDocumentationContract | null {
  if (!isRecord(value)) return null;
  const inspected = arrayOfStrings(value.inspected_default_surfaces);
  const curatorAdded = Array.isArray(value.curator_added_surfaces) ? value.curator_added_surfaces : null;
  const missingSurfaces = Array.isArray(value.missing_orientation_surfaces) ? value.missing_orientation_surfaces : null;
  const missingCoverage = arrayOfStrings(value.missing_coverage);
  const shallowFindings = arrayOfStrings(value.shallow_summary_findings);
  if (!inspected || !curatorAdded || !missingSurfaces || !missingCoverage || !shallowFindings) return null;

  const parsedAdded = curatorAdded.map((item) => {
    if (!isRecord(item) || typeof item.path !== "string" || typeof item.reason !== "string") return null;
    return { path: item.path, reason: item.reason };
  });
  const parsedMissing = missingSurfaces.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      (item.reason !== "not_present" && item.reason !== "present_not_inspected")
    ) {
      return null;
    }
    return { path: item.path, reason: item.reason };
  });
  if (parsedAdded.some((item) => item === null) || parsedMissing.some((item) => item === null)) return null;
  return {
    inspected_default_surfaces: inspected,
    curator_added_surfaces: parsedAdded as ProjectMemoryDocumentationContract["curator_added_surfaces"],
    missing_orientation_surfaces: parsedMissing as ProjectMemoryDocumentationContract["missing_orientation_surfaces"],
    missing_coverage: missingCoverage,
    shallow_summary_findings: shallowFindings,
  };
}

function orientationMissingCoverage(packet: ProjectMemoryPacket, contract: ProjectMemoryDocumentationContract): string[] {
  const root = packet.project.repo_paths[0];
  if (!root) return ["target repo root missing for orientation validation"];
  const inspectedSet = new Set(contract.inspected_default_surfaces);
  return [
    ...missingRequiredOrientationSurfacesSync({
      targetRepoRoot: root,
      inspected: contract.inspected_default_surfaces,
      missing: contract.missing_orientation_surfaces,
    }),
    ...contract.missing_orientation_surfaces
      .filter((item) => item.reason === "present_not_inspected" && !orientationSurfaceSatisfied(item.path, inspectedSet))
      .map((item) => `required orientation surface not inspected: ${item.path}`),
  ];
}

function arrayOfStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

function parseQualityDiagnostics(value: unknown): ProjectMemoryQualityDiagnostics | null {
  if (!isRecord(value) || value.schema_version !== 1) return null;
  const content = isRecord(value.content_quality) ? value.content_quality : null;
  const retrieval = isRecord(value.retrieval_readiness) ? value.retrieval_readiness : null;
  if (
    !content ||
    !PROJECT_MEMORY_CONTENT_QUALITY_STATUSES.includes(content.status as ProjectMemoryQualityDiagnostics["content_quality"]["status"]) ||
    !Array.isArray(content.reasons) ||
    content.reasons.some((reason) => typeof reason !== "string")
  ) {
    return null;
  }
  if (
    !retrieval ||
    !PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES.includes(retrieval.status as ProjectMemoryRetrievalReadinessStatus) ||
    (retrieval.reason !== undefined && retrieval.reason !== null && typeof retrieval.reason !== "string")
  ) {
    return null;
  }

  const domainCoverage = Array.isArray(value.domain_coverage) ? value.domain_coverage : null;
  const candidateDispositions = Array.isArray(value.candidate_dispositions) ? value.candidate_dispositions : null;
  const missingCoverage = Array.isArray(value.missing_coverage) ? value.missing_coverage : null;
  const shallowFindings = Array.isArray(value.shallow_summary_findings) ? value.shallow_summary_findings : null;
  const answerabilityFindings = Array.isArray(value.answerability_findings) ? value.answerability_findings : null;
  if (!domainCoverage || !candidateDispositions || !missingCoverage || !shallowFindings || !answerabilityFindings) return null;
  if (
    missingCoverage.some((item) => typeof item !== "string") ||
    shallowFindings.some((item) => typeof item !== "string") ||
    answerabilityFindings.some((item) => typeof item !== "string")
  ) return null;

  const parsedDomainCoverage = domainCoverage.map((item) => {
    if (
      !isRecord(item) ||
      !PROJECT_MEMORY_ANSWER_DOMAINS.includes(item.domain as ProjectMemoryAnswerDomain) ||
      !arrayOfStrings(item.page_refs) ||
      !arrayOfStrings(item.section_refs) ||
      !arrayOfStrings(item.representative_questions) ||
      typeof item.citations_seen !== "number" ||
      typeof item.body_chars_seen !== "number" ||
      !arrayOfStrings(item.missing_topics)
    ) {
      return null;
    }
    return {
      domain: item.domain,
      page_refs: item.page_refs,
      section_refs: item.section_refs,
      representative_questions: item.representative_questions,
      citations_seen: item.citations_seen,
      body_chars_seen: item.body_chars_seen,
      missing_topics: item.missing_topics,
    };
  });
  if (parsedDomainCoverage.some((item) => item === null)) return null;

  const parsedDispositions = candidateDispositions.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.source_ref !== "string" ||
      !PROJECT_MEMORY_CANDIDATE_DISPOSITIONS.includes(item.disposition as ProjectMemoryQualityDiagnostics["candidate_dispositions"][number]["disposition"]) ||
      typeof item.reason !== "string"
    ) {
      return null;
    }
    return { source_ref: item.source_ref, disposition: item.disposition, reason: item.reason };
  });
  if (parsedDispositions.some((item) => item === null)) return null;

  return {
    schema_version: 1,
    content_quality: {
      status: content.status as ProjectMemoryQualityDiagnostics["content_quality"]["status"],
      reasons: content.reasons,
    },
    retrieval_readiness: {
      status: retrieval.status as ProjectMemoryRetrievalReadinessStatus,
      reason: retrieval.reason as string | null | undefined,
    },
    domain_coverage: parsedDomainCoverage as ProjectMemoryQualityDiagnostics["domain_coverage"],
    candidate_dispositions: parsedDispositions as ProjectMemoryQualityDiagnostics["candidate_dispositions"],
    missing_coverage: missingCoverage,
    shallow_summary_findings: shallowFindings,
    answerability_findings: answerabilityFindings,
  };
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
