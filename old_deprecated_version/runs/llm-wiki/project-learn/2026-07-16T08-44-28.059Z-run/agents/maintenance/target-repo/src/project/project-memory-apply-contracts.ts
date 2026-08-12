import type { ProjectMemoryAgentCandidateDisposition } from "./project-memory-agent-contracts.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

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
  risk: {
    level: "low" | "medium" | "high";
    reasons: string[];
    requires_quarantine: boolean;
  };
  file_changes: ProjectMemoryAppliedFileChange[];
  page_changes: unknown[];
  item_changes: unknown[];
  source_consumptions: ProjectMemorySourceConsumptionRecord[];
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
  write_kind: "wiki_page" | "project_state" | "repository_identity_state" | "page_state" | "source_consumption_state" | "log";
  page_ids?: string[];
  item_ids?: string[];
};

export type ProjectMemoryObservedPromotion = {
  canonical_path: string;
  after_sha256: string;
  promoted_at: string;
};

export type ProjectMemorySourceConsumptionRecord = {
  source_kind: "project_candidate" | "project_handoff";
  source_ref: string;
  project_key: string;
  consumed_by_run: string;
  consumed_at: string;
  terminal_decision: ProjectMemoryAgentCandidateDisposition;
  output_refs: string[];
};
