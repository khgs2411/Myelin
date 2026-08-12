// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-curator-validator.ts
// Owns deterministic validation of Project Memory Curator outputs.
// Does not invoke LLMs, mutate markdown, or decide semantic writing quality.

import type { ProjectMemoryPacket } from "./project-memory-packet.ts";
import type {
  ProjectMemoryCreationDraft,
  ProjectMemoryCuratorOutput,
  ProjectMemoryEvidenceRef,
  ProjectMemoryMaintenanceProposal,
  ProjectMemoryMaintenanceProposalItem,
  ProjectMemoryRepoCitation,
  ProjectMemoryValidationFinding,
} from "./project-memory-curator-contracts.ts";

type ProjectMemoryValidationOutcome = "eligible" | "rejected" | "quarantined" | "noop";

type ProjectMemoryItemValidation = {
  item_id: string;
  outcome: ProjectMemoryValidationOutcome;
  findings: ProjectMemoryValidationFinding[];
};

type ProjectMemoryCuratorValidationResult = {
  ok: boolean;
  mode: "create" | "maintain";
  project_key: string;
  global_findings: ProjectMemoryValidationFinding[];
  item_results: ProjectMemoryItemValidation[];
  eligible_item_ids: string[];
  rejected_item_ids: string[];
  quarantined_item_ids: string[];
  noop_refs: string[];
};

function validateCuratorOutput(
  packet: ProjectMemoryPacket,
  output: unknown,
): ProjectMemoryCuratorValidationResult {
  // 1. Parse envelope shape.
  // 2. Reject globally if schema_version, project_key, or mode mismatches packet.
  // 3. Dispatch by output.mode.
  // 4. Return structured findings; do not throw for item-level validation failures.
}

function validateCreationDraft(
  packet: ProjectMemoryPacket,
  draft: ProjectMemoryCreationDraft,
): ProjectMemoryCuratorValidationResult {
  // Creation is broad, but not unconstrained.
  // Global checks:
  // - packet.mode must be "create"
  // - project has no trusted curated Project Memory
  // - every target path stays inside projects/<key>/wiki or allowed project state artifacts
  // - untrusted existing markdown is treated as context, not automatically trusted
  // - secrets/sensitive-content scan is required before later publication
  //
  // Page checks:
  // - every page has a target path, purpose, content intent, evidence refs
  // - repo citations are required when page claims repo behavior
  // - page set includes required navigation/index intent
  // - state intent cannot self-assign protected metadata beyond allowed creation fields
}

function validateMaintenanceProposal(
  packet: ProjectMemoryPacket,
  proposal: ProjectMemoryMaintenanceProposal,
): ProjectMemoryCuratorValidationResult {
  // Maintenance is itemized.
  // Global checks:
  // - packet.mode must be "maintain"
  // - trusted curated Project Memory must exist
  // - proposal cannot contain creation-draft pages
  // - proposal-level risk cannot bypass item validation
  //
  // Item checks:
  // - validate each item independently
  // - a global hard error can make ok=false even if individual items look valid
}

function validateMaintenanceItem(
  packet: ProjectMemoryPacket,
  item: ProjectMemoryMaintenanceProposalItem,
): ProjectMemoryItemValidation {
  // Mechanical checks only:
  // - operation is allowed for maintenance
  // - target_page is under wiki and exists when operation requires existing page
  // - source_packet_refs resolve to packet handoffs/candidates/session memories/pages/lookups/state
  // - evidence_refs are present
  // - repo citations exist when the item claims code/runtime/setup/test behavior
  // - inference label exists when direct evidence is unavailable
  // - broad rewrite/delete/split/merge gets quarantined or rejected
  // - lifecycle transition is legal
  // - risk level and degraded packet state may quarantine otherwise valid shape
}

function resolvePacketRef(packet: ProjectMemoryPacket, ref: ProjectMemoryEvidenceRef): boolean {
  // Search packet sources:
  // - pending.project_handoffs[].id
  // - pending.project_candidates[].id
  // - session_memory.selected[].id
  // - wiki.pages[].path
  // - lookup queries/results by stable synthesized ref
  // - state fields by known path-like key
}

function validateRepoCitation(citation: ProjectMemoryRepoCitation): boolean {
  // Shape validation only in this module.
  // Filesystem existence and line ranges may be delegated to a helper that
  // uses the registered repo path from the packet/project state.
}

export type {
  ProjectMemoryValidationOutcome,
  ProjectMemoryItemValidation,
  ProjectMemoryCuratorValidationResult,
};

export {
  validateCuratorOutput,
  validateCreationDraft,
  validateMaintenanceProposal,
};
