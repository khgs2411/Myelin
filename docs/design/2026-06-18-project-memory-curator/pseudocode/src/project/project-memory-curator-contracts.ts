// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-curator-contracts.ts
// Owns Project Memory Curator contract types and shared primitives.
// Does not invoke providers, read files, write artifacts, or validate filesystem state.

import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

type ProjectMemoryCuratorMode = "create" | "maintain";

type ProjectMemoryEvidenceRef = {
  // Packet-scoped evidence identity.
  // Examples: handoff id, candidate id, session memory id, wiki page path,
  // lookup result ref, project state field, repo citation ref.
  kind:
    | "project_handoff"
    | "project_candidate"
    | "session_memory"
    | "wiki_page"
    | "lookup_result"
    | "project_state"
    | "repo_citation"
    | "inference";
  ref: string;
  note?: string;
};

type ProjectMemoryRepoCitation = {
  path: string;
  line_start?: number;
  line_end?: number;
  reason: string;
};

type ProjectMemoryPathRef = {
  // Always project-relative. Validator resolves it under projects/<key>/wiki.
  path: string;
  path_kind: "existing_wiki_page" | "new_wiki_page" | "project_state" | "run_artifact";
};

type ProjectMemoryRisk = {
  level: "low" | "medium" | "high";
  reasons: string[];
  requires_quarantine: boolean;
};

type ProjectMemoryValidationFinding = {
  severity: "info" | "warn" | "blocker";
  code: string;
  item_id?: string;
  message: string;
  evidence_refs?: ProjectMemoryEvidenceRef[];
};

type ProjectMemoryCuratorEnvelope = {
  schema_version: 1;
  project_key: string;
  mode: ProjectMemoryCuratorMode;
  packet_ref: {
    // Points at run artifact, usually input-packet.json.
    run_dir: string;
    artifact: "input-packet.json";
    packet_schema_version: ProjectMemoryPacket["schema_version"];
  };
  summary: string;
};

type ProjectMemoryCreationDraft = ProjectMemoryCuratorEnvelope & {
  mode: "create";
  // Broad first-brain output. It may describe full page drafts because no
  // trusted curated Project Memory exists yet.
  brain_intent: {
    name: string;
    first_brain_summary: string;
    untrusted_existing_markdown_policy: "adopt" | "rewrite" | "ignore" | "quarantine_mixed";
  };
  pages: ProjectMemoryCreationPageDraft[];
  state_intent: {
    mark_project_memory_curated: boolean;
    freshness_intent: "initialize" | "leave_degraded";
  };
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  risk: ProjectMemoryRisk;
};

type ProjectMemoryCreationPageDraft = {
  id: string;
  target: ProjectMemoryPathRef;
  title: string;
  purpose: string;
  content_intent: string;
  required_sections: string[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  notes_for_apply: string[];
};

type ProjectMemoryMaintenanceProposal = ProjectMemoryCuratorEnvelope & {
  mode: "maintain";
  items: ProjectMemoryMaintenanceProposalItem[];
  noop_inputs: ProjectMemoryNoopInput[];
  risk: ProjectMemoryRisk;
};

type ProjectMemoryMaintenanceProposalItem = {
  id: string;
  operation:
    | "CREATE_ENTRY"
    | "PATCH_ENTRY"
    | "ATTACH_EVIDENCE"
    | "MARK_STALE"
    | "MARK_DISPUTED"
    | "SUPERSEDE_ENTRY"
    | "RETRACT_ENTRY"
    | "NOOP";
  target_page: ProjectMemoryPathRef;
  target_entry_id?: string;
  proposed_entry_id?: string;
  content_intent: string;
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
  lifecycle_intent: "active" | "stale_pending" | "disputed" | "superseded" | "retracted";
  risk: ProjectMemoryRisk;
  preconditions: string[];
  expected_outcome: string;
};

type ProjectMemoryNoopInput = {
  source_packet_ref: ProjectMemoryEvidenceRef;
  reason: "already_trusted" | "not_durable" | "belongs_to_other_layer" | "insufficient_evidence";
  notes: string;
};

type ProjectMemoryCuratorOutput =
  | ProjectMemoryCreationDraft
  | ProjectMemoryMaintenanceProposal;

export type {
  ProjectMemoryCuratorMode,
  ProjectMemoryEvidenceRef,
  ProjectMemoryRepoCitation,
  ProjectMemoryPathRef,
  ProjectMemoryRisk,
  ProjectMemoryValidationFinding,
  ProjectMemoryCreationDraft,
  ProjectMemoryCreationPageDraft,
  ProjectMemoryMaintenanceProposal,
  ProjectMemoryMaintenanceProposalItem,
  ProjectMemoryCuratorOutput,
};
