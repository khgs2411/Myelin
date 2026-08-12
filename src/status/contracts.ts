import { relative } from "node:path";
import type { SessionCurrentContinuityV1 } from "../memory/session-current-continuity-types.ts";
import type { SMCStatusV1 } from "../session-maintenance/status-types.ts";

export type OperationalState = "healthy" | "attention" | "blocked";
export type StatusSectionName = "installation" | "session_memory" | "project_memory";

export type StatusEvidence = {
  id: string;
  kind: "file" | "sqlite" | "process" | "config";
  path: string;
};

export type StatusWarning = {
  code: string;
  severity: "attention" | "blocked";
  section: StatusSectionName;
  message: string;
  evidence_ids: string[];
};

export type StatusAction = { command: string; reason: string; section: StatusSectionName };

export type StatusSectionBase = {
  state: OperationalState;
  lifecycle: string;
  evidence_ids: string[];
};

export type InstallationStatusSection = StatusSectionBase & {
  myelin_root: string;
  launcher_path: string | null;
  locator_path: string | null;
  locator_schema_version: number | null;
  providers: Array<{ name: string; lifecycle: string; hooks_path: string | null; shim_path: string | null }>;
};

export type LockStatus = {
  lifecycle: "absent" | "active" | "stale";
  path: string;
  run_id: string | null;
  pid: number | null;
};

export type MaintenanceStatus = {
  enabled: boolean;
  lifecycle: string;
  lock: LockStatus;
  last_run_id: string | null;
  last_log_path: string | null;
};

export type EmbeddingContractStatus = {
  provider: string;
  model: string;
  dimensions: number;
  format_version: number;
};

export type RetrievalStatus = {
  active_contract: EmbeddingContractStatus | null;
  desired_contract: EmbeddingContractStatus | null;
  migration_required: boolean;
  provider_state: "not_checked" | "available" | "unreachable" | "unavailable";
  indexed_count: number;
  pending_count: number;
  failed_count: number;
  historical: { contract_count: number; row_count: number };
};

export type SessionMemoryStatusSection = StatusSectionBase & {
  capture: { queued_events: number; unleased_events: number; leased_events: number };
  ingest: { running_jobs: number; failed_jobs: number; terminal_tombstones: number; latest_log_path: string | null };
  maintenance: MaintenanceStatus;
  retrieval: RetrievalStatus;
  smc?: SMCStatusV1;
};

export type ProjectMemoryStatusSection = StatusSectionBase & {
  inbox: { pending_items: number };
  candidates: { pending: number; needs_review: number };
  maintenance: MaintenanceStatus;
  curation: { lifecycle: string; canonical_wiki_path: string; latest_run_path: string | null };
  retrieval: RetrievalStatus;
};

export type OperationalStatusResult = {
  generated_at: string;
  overall_state: OperationalState;
  project: { key: string; name: string; repo_paths: string[]; resolved_from: "argument" | "cwd" };
  installation: InstallationStatusSection;
  session_memory: SessionMemoryStatusSection;
  project_memory: ProjectMemoryStatusSection;
  session_continuity: SessionCurrentContinuityV1;
  warnings: StatusWarning[];
  actions: StatusAction[];
  evidence: StatusEvidence[];
};

export class EvidenceRegistry {
  private readonly items: StatusEvidence[] = [];
  private readonly keys = new Map<string, string>();

  constructor(private readonly root: string) {}

  add(kind: StatusEvidence["kind"], path: string, machineAbsolute = false): string {
    const rendered = machineAbsolute ? path : relative(this.root, path) || ".";
    const key = `${kind}:${rendered}`;
    const existing = this.keys.get(key);
    if (existing) return existing;
    const id = `e${this.items.length + 1}`;
    this.items.push({ id, kind, path: rendered });
    this.keys.set(key, id);
    return id;
  }

  all(): StatusEvidence[] {
    return [...this.items];
  }
}

export type StatusInspection = {
  warnings: StatusWarning[];
  actions: StatusAction[];
};
