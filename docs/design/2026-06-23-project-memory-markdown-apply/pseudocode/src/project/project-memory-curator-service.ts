// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: existing src/project/project-memory-curator-service.ts
// Owns the project learn application flow after the pre-write gate grows an apply phase.
// Does not own deterministic markdown rendering details.

import { ProjectMemoryMarkdownApplier } from "./project-memory-markdown-applier.ts";

class ProjectMemoryCuratorService {
  constructor(private readonly root: string) {}

  async runProjectLearn(input: RunProjectMemoryCuratorInput): Promise<ProjectMemoryCuratorRunResult> {
    // Recovery preflight before any new curator work:
    //   incompleteJournal = findIncompleteProjectMemoryApplyJournal(input.projectKey)
    //   if incompleteJournal is recoverable:
    //     recoveryResult = ProjectMemoryMarkdownApplier.recoverFromJournal(incompleteJournal)
    //     write recovered curator-run-result.json and summary.md
    //     return without invoking the curator
    //   if incompleteJournal is not safely recoverable:
    //     write failed run result with exact recovery guidance
    //     return without invoking the curator

    // Existing pre-write sequence:
    //   resolve project
    //   repair shell unless dry_run
    //   create run dir
    //   ensure schema context
    //   build ProjectMemoryPacket
    //   write input-packet.json
    //   invoke mode-scoped curator
    //   write curator output artifact
    //   validate curator output
    //   write curator-validation.json

    // New apply decision:
    //   applyDecision = decideProjectMemoryApply({
    //     dryRun: input.dryRun,
    //     review: input.review,
    //     validation,
    //     packet,
    //     curatorOutput,
    //     projectMemoryState,
    //   })

    // If applyDecision is "skip":
    //   write curator-run-result.json with:
    //     status = validation.ok ? "needs_review" or "completed" according to reason
    //     stopped_before_writes = true
    //     stopped_reason = applyDecision.reason
    //   write summary.md
    //   return

    // If applyDecision is "apply":
    //   applyResult = ProjectMemoryMarkdownApplier.apply(...)
    //   write/update project-memory-apply-journal.json during staged promotion
    //   write project-memory-apply-result.json
    //   write project-memory-changeset.json with bounded before/after snippets
    //   write project-level source-consumption state and mirror refs in run artifacts
    //   write curator-run-result.json with:
    //     status = applyResult.status === "applied" ? "completed" : "failed" or "needs_review"
    //     stopped_before_writes = false when at least one canonical write succeeded
    //     applied_item_ids and changed file refs if run result contract grows those fields
    //   write summary.md with validation and apply evidence
    //   return
  }

  private decideProjectMemoryApply(input: ProjectMemoryApplyDecisionInput): ProjectMemoryApplyDecision {
    // Return skip when:
    // - input.dryRun is true
    // - input.review is true
    // - validation.ok is false
    // - create mode has no concrete page drafts selected for publication
    // - create mode lacks trusted index plus one meaningful domain page or explicit no-domain-pages rationale
    // - maintain mode has no eligible_item_ids
    // - maintain mode is requested but projects/<key>/state/project-memory.json.status is not curated
    // - validation.rejected_item_ids is non-empty
    // - validation.quarantined_item_ids is non-empty
    // - packet.degraded caused validation quarantine
    // - curator output lacks concrete apply payload required by this slice
    //
    // Return apply when:
    // - validation.ok is true
    // - create mode has concrete publishable page drafts and curated-state intent
    // - maintain mode has project-memory.json status curated and only eligible items selected for apply
    // - concrete page/item apply payload validates
    // - risk does not require quarantine
    // - mode is create or maintain
  }
}

type ProjectMemoryApplyDecisionInput = {
  dryRun: boolean;
  review: boolean;
  validation: unknown;
  packet: unknown;
  curatorOutput: unknown;
};

type ProjectMemoryApplyDecision =
  | { action: "apply"; selection: { mode: "create"; page_ids: string[] } | { mode: "maintain"; item_ids: string[] } }
  | { action: "skip"; reason: string; status: "completed" | "needs_review" | "failed" };

type RunProjectMemoryCuratorInput = unknown;
type ProjectMemoryCuratorRunResult = unknown;
