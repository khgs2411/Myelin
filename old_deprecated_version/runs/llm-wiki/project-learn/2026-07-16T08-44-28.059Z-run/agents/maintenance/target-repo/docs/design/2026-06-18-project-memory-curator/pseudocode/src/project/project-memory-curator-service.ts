// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-curator-service.ts
// Owns the Project Memory Curator application service for project learn.
// Owns Project Memory source/inbox intake as packet input.
// Does not own CLI parsing or low-level provider implementation.

import { buildProjectMemoryPacket } from "./project-memory-packet.ts";
import { validateCuratorOutput } from "./project-memory-curator-validator.ts";

type RunProjectMemoryCuratorInput = {
  projectKey: string;
  dryRun: boolean;
  review: boolean;
  provider?: "codex" | "claude";
  modelOverride?: string;
  now: Date;
};

type ProjectMemoryCuratorRunResult = {
  status: "completed" | "failed" | "needs_review";
  project_key: string;
  mode: "create" | "maintain";
  run_dir: string;
  artifacts: {
    input_packet: string;
    curator_output: string;
    curator_validation: string;
    curator_run_result: string;
    summary: string;
  };
  validation_ok: boolean;
  stopped_before_writes: boolean;
};

class ProjectMemoryCuratorService {
  constructor(private readonly root: string) {}

  async runProjectLearn(input: RunProjectMemoryCuratorInput): Promise<ProjectMemoryCuratorRunResult> {
    // 1. Resolve project and create run directory.
    // 2. Ensure schema context using existing schema compiler behavior.
    // 3. Repair/verify bootstrap shell shape.
    // 4. Gather pending Project Memory source/inbox material for packet input.
    // 5. Build ProjectMemoryPacket.
    // 6. Determine mode from packet.mode.
    // 7. Invoke mode-specific curator prompt.
    // 8. Persist raw curator output as curator-creation-draft.json or curator-maintenance-proposal.json.
    // 9. Validate with validateCuratorOutput(packet, output).
    // 10. Persist curator-validation.json.
    // 11. Stop before markdown writes for this slice.
    // 12. Return result with explicit stopped_before_writes=true when no apply stage ran.
  }

  private async gatherProjectMemoryPacketInputs() {
    // Reads queued Project Memory source/inbox material and makes it available
    // to ProjectMemoryPacket construction.
    // This replaces the old separate project ingest command path.
    // Does not perform wiki writes.
  }

  private async invokeCreationCurator() {
    // Uses strong model/reasoning profile by default or configured override.
    // Prompt asks for ProjectMemoryCreationDraft.
    // Agent can create first-brain structure, but must cite packet/repo evidence.
  }

  private async invokeMaintenanceCurator() {
    // Uses bounded packet and asks for ProjectMemoryMaintenanceProposal.
    // Agent proposes itemized changes only.
    // Broad structural changes become quarantined proposal items, not writes.
  }

  private async writeCuratorArtifacts() {
    // Writes:
    // - input-packet.json
    // - curator-creation-draft.json OR curator-maintenance-proposal.json
    // - curator-validation.json
    // - curator-run-result.json
    // - summary.md
    //
    // Artifact names should be curator-specific, not generic propose/apply names.
  }
}

export { ProjectMemoryCuratorService };
export type { RunProjectMemoryCuratorInput, ProjectMemoryCuratorRunResult };
