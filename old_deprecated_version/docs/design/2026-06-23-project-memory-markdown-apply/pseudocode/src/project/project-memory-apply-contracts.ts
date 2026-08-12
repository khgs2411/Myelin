// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-apply-contracts.ts
// Owns concrete apply payload and apply-result shapes for Project Memory markdown mutation.
// May be merged into project-memory-curator-contracts.ts if implementation keeps one contract file.
// Does not read files, write markdown, invoke providers, or decide whether a run is allowed to apply.

import type {
  ProjectMemoryCuratorOutput,
  ProjectMemoryEvidenceRef,
  ProjectMemoryLifecycleIntent,
  ProjectMemoryMaintenanceProposalItem,
  ProjectMemoryRepoCitation,
  ProjectMemoryRisk,
} from "./project-memory-curator-contracts.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

type ProjectMemoryApplyPayload = {
  // Concrete versioned content payload supplied by the curator and validated before apply.
  // This is intentionally stronger than content_intent.
  schema_version: 1;
  entries?: ProjectMemoryEntryDraft[];
  pages?: ProjectMemoryPageDraft[];
};

type ProjectMemoryEntryDraft = {
  entry_id: string;
  title: string;
  body: ProjectMemoryMarkdownLines;
  lifecycle: ProjectMemoryLifecycleIntent;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
  applicability?: ProjectMemoryApplicability;
};

type ProjectMemoryPageDraft = {
  page_path: string;
  title: string;
  purpose: string;
  body: ProjectMemoryMarkdownLines;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
};

type ProjectMemoryMarkdownLines = {
  // Curator supplies markdown paragraphs or bullets, but not file-level patch syntax.
  // Applier owns final block markers, headings, provenance rendering, and newline normalization.
  paragraphs: string[];
  bullets?: string[];
  warnings?: string[];
};

type ProjectMemoryInferenceLabel = {
  label: string;
  basis: string;
  why_direct_repo_evidence_is_unavailable: string;
};

type ProjectMemoryApplicability = {
  branches?: string[];
  repo_paths?: string[];
  commands?: string[];
  notes?: string;
};

type ProjectMemoryApplicableMaintenanceItem = ProjectMemoryMaintenanceProposalItem & {
  apply_payload: ProjectMemoryApplyPayload;
};

type ProjectMemoryApplyInput = {
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
  journal_path: string;
  staged_outputs_dir: string;
  dry_run: false;
  review: false;
};

type ProjectMemoryApplyResult = {
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

type ProjectMemoryAppliedFileChange = {
  path: string;
  before_sha256: string | null;
  after_sha256: string;
  operation: "create" | "update";
  page_ids: string[];
  item_ids: string[];
  staged_output_ref: string;
};

type ProjectMemoryStateUpdate = {
  path: string;
  before_sha256: string | null;
  after_sha256: string;
  reason: string;
};

type ProjectMemoryChangeset = {
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

type ProjectMemoryAppliedPageChange = {
  page_id: string;
  operation: "create" | "adopt" | "rewrite";
  target_page: string;
  before_snippet?: ProjectMemoryBoundedSnippet;
  after_snippet: ProjectMemoryBoundedSnippet;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
};

type ProjectMemoryAppliedItemChange = {
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

type ProjectMemoryApplyJournal = {
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

type ProjectMemoryExpectedWrite = {
  canonical_path: string;
  staged_output_ref: string;
  before_sha256: string | null;
  write_order: number;
  write_kind: "wiki_page" | "project_state" | "page_state" | "source_consumption_state" | "log";
};

type ProjectMemoryObservedPromotion = {
  canonical_path: string;
  after_sha256: string;
  promoted_at: string;
};

type ProjectMemoryBoundedSnippet = {
  path: string;
  anchor: string;
  sha256: string;
  text: string;
  truncated: boolean;
};

type ProjectMemorySourceConsumptionRecord = {
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

export type {
  ProjectMemoryApplyInput,
  ProjectMemoryApplyJournal,
  ProjectMemoryApplyPayload,
  ProjectMemoryApplyResult,
  ProjectMemoryApplicableMaintenanceItem,
  ProjectMemoryAppliedFileChange,
  ProjectMemoryAppliedPageChange,
  ProjectMemoryBoundedSnippet,
  ProjectMemoryChangeset,
  ProjectMemoryEntryDraft,
  ProjectMemoryPageDraft,
  ProjectMemorySourceConsumptionRecord,
};
