import type {
  ProjectMemoryAgentCandidateDisposition,
  ProjectMemoryMaintenanceDisposition,
} from "../project/project-memory-agent-contracts.ts";

export type MemoryReviewItem =
  | {
      kind: "project_memory_disposition";
      project_key: string;
      run_dir: string;
      json_path: string;
      source_kind: ProjectMemoryMaintenanceDisposition["source_kind"];
      source_ref: string;
      status: ProjectMemoryAgentCandidateDisposition;
      reason: string;
      output_refs: string[];
    }
  | { kind: "project_memory_run"; project_key: string; run_dir: string; json_path: string; status: "degraded"; reason: string }
  | { kind: "ingest_job"; project_key: string; sqlite_table: "ingest_jobs"; id: string; status: "needs_followup"; reason: string | null; created_at: string; updated_at: string }
  | { kind: "experience_tombstone"; project_key: string; sqlite_table: "experience_event_tombstones"; id: string; original_event_id: string; ingest_job_id: string | null; status: "no_output"; terminal_decision: string | null; claimed_at: string; finalized_at: string | null }
  | { kind: "memory_candidate"; project_key: string; sqlite_table: "memory_candidates"; id: string; scope: string; status: "rejected"; title: string | null; summary: string; reason: string; updated_at: string }
  | { kind: "handoff_instruction"; project_key: string; sqlite_table: "project_handoff_instructions" | "practice_handoff_instructions" | "personal_handoff_instructions"; id: string; scope: "project" | "practice" | "personal"; status: "rejected"; objective: string; reason: string; updated_at: string };

export type MemoryReviewReport = {
  project_key: string;
  reviewable_count: number;
  returned_count: number;
  items: MemoryReviewItem[];
};
