import { stat } from "node:fs/promises";
import { markProjectMemoryCandidateProcessed, type QueueLifecycleUpdateResult } from "../memory/candidates.ts";
import { memoryDbPath, openMemoryDb } from "../memory/db.ts";
import { markProjectHandoffInstructionProcessed } from "../memory/handoffs.ts";
import { projectStatePath } from "../runtime/fs.ts";
import { readJsonIfExists } from "../runtime/json.ts";
import { normalizeProjectMemoryAgentCandidateDisposition } from "./project-memory-agent-contracts.ts";
import type { ProjectMemorySourceConsumptionRecord } from "./project-memory-apply-contracts.ts";

const TERMINAL_PROJECT_MEMORY_DISPOSITIONS = new Set([
  "applied_to_project_memory",
  "already_covered",
  "not_durable",
  "belongs_to_other_layer",
  "insufficient_evidence",
]);

export type ProjectMemorySourceConsumptionState = {
  schema_version: 1;
  project_key: string;
  records: ProjectMemorySourceConsumptionRecord[];
};

export type ProjectMemorySourceConsumptionReconcileResult = {
  project_key: string;
  source_consumption_state_path: string;
  processed_candidates: string[];
  processed_project_handoffs: string[];
  already_terminal_refs: string[];
  missing_refs: string[];
  skipped_refs: string[];
  degraded: boolean;
  blocking: boolean;
  degraded_reasons: string[];
};

export class ProjectMemorySourceConsumptionReconciler {
  constructor(private readonly root: string) {}

  async reconcileProject(
    projectKey: string,
    input: { now?: Date } = {},
  ): Promise<ProjectMemorySourceConsumptionReconcileResult> {
    const statePath = projectStatePath(this.root, projectKey, "project-memory-source-consumptions.json");
    const base = emptyResult(projectKey, statePath);

    let state: ProjectMemorySourceConsumptionState | null;
    try {
      state = await readJsonIfExists<ProjectMemorySourceConsumptionState>(statePath);
    } catch (error) {
      return degradedResult(base, `invalid Project Memory source-consumption state: ${errorMessage(error)}`, true);
    }
    if (!state) return base;

    const validationError = validateState(projectKey, state);
    if (validationError) return degradedResult(base, validationError, true);

    const records = normalizeRecords(state);
    if (records.length === 0) return base;
    if (!(await exists(memoryDbPath(this.root)))) {
      return degradedResult(base, "state/memory/memory.db is missing; source-consumption reconciliation skipped", false);
    }

    const now = (input.now ?? new Date()).toISOString();
    const db = openMemoryDb(this.root);
    try {
      const result = db.transaction(() => {
        const next = { ...base };
        for (const record of records) {
          const update =
            record.source_kind === "project_candidate"
              ? markProjectMemoryCandidateProcessed(db, { project_key: projectKey, id: record.source_ref, now })
              : markProjectHandoffInstructionProcessed(db, { project_key: projectKey, id: record.source_ref, now });
          applyUpdateResult(next, record, update);
        }
        return next;
      })();
      return result;
    } finally {
      db.close();
    }
  }
}

function validateState(projectKey: string, state: ProjectMemorySourceConsumptionState): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return "invalid Project Memory source-consumption state: expected object";
  if (state.schema_version !== 1) return "invalid Project Memory source-consumption state: schema_version must be 1";
  if (state.project_key !== projectKey) {
    return `invalid Project Memory source-consumption state: project_key ${state.project_key} does not match ${projectKey}`;
  }
  if (!Array.isArray(state.records)) return "invalid Project Memory source-consumption state: records must be an array";
  return null;
}

function normalizeRecords(state: ProjectMemorySourceConsumptionState): ProjectMemorySourceConsumptionRecord[] {
  const byKey = new Map<string, ProjectMemorySourceConsumptionRecord>();
  for (const record of state.records) {
    if (!isSupportedRecord(state.project_key, record)) continue;
    const key = `${record.source_kind}:${record.source_ref}`;
    if (!byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function isSupportedRecord(projectKey: string, record: ProjectMemorySourceConsumptionRecord): boolean {
  const disposition = normalizeProjectMemoryAgentCandidateDisposition(record?.terminal_decision);
  return (
    record &&
    typeof record === "object" &&
    record.project_key === projectKey &&
    (record.source_kind === "project_candidate" || record.source_kind === "project_handoff") &&
    typeof record.source_ref === "string" &&
    record.source_ref.length > 0 &&
    disposition !== null &&
    TERMINAL_PROJECT_MEMORY_DISPOSITIONS.has(disposition)
  );
}

function applyUpdateResult(
  result: ProjectMemorySourceConsumptionReconcileResult,
  record: ProjectMemorySourceConsumptionRecord,
  update: QueueLifecycleUpdateResult,
): void {
  const ref = `${record.source_kind}:${record.source_ref}`;
  if (update.status === "processed") {
    if (record.source_kind === "project_candidate") result.processed_candidates.push(record.source_ref);
    else result.processed_project_handoffs.push(record.source_ref);
  } else if (update.status === "already_terminal") {
    result.already_terminal_refs.push(ref);
  } else if (update.status === "missing") {
    result.missing_refs.push(ref);
  } else {
    result.skipped_refs.push(ref);
  }
}

function emptyResult(projectKey: string, statePath: string): ProjectMemorySourceConsumptionReconcileResult {
  return {
    project_key: projectKey,
    source_consumption_state_path: statePath,
    processed_candidates: [],
    processed_project_handoffs: [],
    already_terminal_refs: [],
    missing_refs: [],
    skipped_refs: [],
    degraded: false,
    blocking: false,
    degraded_reasons: [],
  };
}

function degradedResult(
  result: ProjectMemorySourceConsumptionReconcileResult,
  reason: string,
  blocking: boolean,
): ProjectMemorySourceConsumptionReconcileResult {
  return { ...result, degraded: true, blocking, degraded_reasons: [reason] };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
