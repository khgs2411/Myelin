// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-source-consumption-reconciler.ts
// Owns deterministic reconciliation from Project Memory Source Consumption state
// to root SQLite queue lifecycle statuses.
//
// This service is not apply. It does not write markdown, render pages, invoke
// providers, or decide whether a source should become Project Memory. It only
// trusts source-consumption records already written by successful Project Memory
// apply.

type ReconcileProjectMemorySourceConsumptionsInput = {
  projectKey: string
  now?: Date
}

type ProjectMemorySourceConsumptionState = {
  schema_version: 1
  project_key: string
  records: ProjectMemorySourceConsumptionRecord[]
}

type ProjectMemorySourceConsumptionRecord = {
  source_kind: "project_candidate" | "project_handoff"
  source_ref: string
  project_key: string
  consumed_by_run: string
  consumed_at: string
  terminal_decision: "applied_to_project_memory"
  output_refs: string[]
}

type ProjectMemorySourceConsumptionReconcileResult = {
  project_key: string
  source_consumption_state_path: string
  processed_candidates: string[]
  processed_project_handoffs: string[]
  already_terminal_refs: string[]
  missing_refs: string[]
  skipped_refs: string[]
  degraded: boolean
  degraded_reasons: string[]
}

class ProjectMemorySourceConsumptionReconciler {
  constructor(root: string) {
    // root is the Myelin repo root.
  }

  reconcileProject(projectKey: string, input?: ReconcileProjectMemorySourceConsumptionsInput)
    : ProjectMemorySourceConsumptionReconcileResult {
    // 1. Resolve project state path:
    //    projects/<projectKey>/state/project-memory-source-consumptions.json
    //
    // 2. If the file is missing:
    //    return an empty successful result.
    //    Missing source-consumption state means there is nothing to reconcile,
    //    not that Project Memory is degraded.
    //
    // 3. Parse state with the narrow expected shape:
    //    - schema_version must be 1
    //    - project_key must match input projectKey
    //    - records must be an array
    //
    // 4. If the state file is malformed:
    //    return degraded with no SQLite mutations.
    //    Do not guess from malformed lifecycle evidence.
    //
    // 5. Deduplicate records by source_kind + source_ref.
    //    Prefer first-consumed timing as the lifecycle origin.
    //
    // 6. Open root SQLite memory DB.
    //    If state/memory.db is missing, return degraded with no mutation.
    //    Do not create a new memory DB just to reconcile old source evidence.
    //
    // 7. In one transaction:
    //    - for each project_candidate record:
    //      call markProjectCandidateProcessedFromSourceConsumption(...)
    //    - for each project_handoff record:
    //      call markProjectHandoffProcessedFromSourceConsumption(...)
    //
    // 8. Build a result that separates:
    //    - rows newly moved to processed
    //    - rows that were already processed
    //    - source refs missing from SQLite
    //    - records skipped because kind/project/decision was unsupported
    //
    // 9. Close DB and return result.
  }

  private readSourceConsumptionState(projectKey: string): ProjectMemorySourceConsumptionState | null {
    // Read only project-owned state JSON.
    // Do not scan historical run directories in this first slice.
  }

  private normalizeRecords(state: ProjectMemorySourceConsumptionState): ProjectMemorySourceConsumptionRecord[] {
    // Keep only records where:
    // - record.project_key equals state.project_key
    // - source_kind is project_candidate or project_handoff
    // - terminal_decision is applied_to_project_memory
    //
    // Deduplicate stable key: `${source_kind}:${source_ref}`.
  }
}

