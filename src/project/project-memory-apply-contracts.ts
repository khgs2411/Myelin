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
  section?: ProjectMemorySectionDraft | null;
  page?: ProjectMemoryPageDraft | null;
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
  sections: ProjectMemorySectionDraft[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: ProjectMemoryInferenceLabel;
};

export type ProjectMemorySectionDraft = {
  heading: string;
  level: number;
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
  mode: "create" | "maintain";
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
  page_ids?: string[];
  item_ids?: string[];
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
  source_kind: "project_candidate" | "project_handoff";
  source_ref: string;
  project_key: string;
  consumed_by_run: string;
  consumed_at: string;
  terminal_decision:
    | "applied_to_project_memory"
    | "already_trusted"
    | "not_durable"
    | "belongs_to_other_layer"
    | "insufficient_evidence"
    | "duplicate_or_superseded"
    | "missing_coverage_no_grounded_write"
    | "blocked_by_quality";
  output_refs: string[];
};
