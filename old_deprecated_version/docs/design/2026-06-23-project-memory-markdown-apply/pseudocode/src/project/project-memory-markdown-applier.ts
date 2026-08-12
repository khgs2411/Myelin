// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-markdown-applier.ts
// Owns deterministic canonical Project Memory markdown mutation for both creation and maintenance modes.
// Consumes validated curator artifacts and concrete apply payloads.
// Does not invoke providers, build packets, validate semantic truth, or parse CLI args.

import type {
  ProjectMemoryApplyInput,
  ProjectMemoryApplyJournal,
  ProjectMemoryApplyResult,
  ProjectMemoryEntryDraft,
  ProjectMemoryPageDraft,
} from "./project-memory-apply-contracts.ts";

class ProjectMemoryMarkdownApplier {
  constructor(private readonly root: string) {}

  async apply(input: ProjectMemoryApplyInput): Promise<ProjectMemoryApplyResult> {
    // Guard again even though caller should already gate.
    // If validation is not ok, dry_run is true, review is true, or the mode-specific
    // selection is empty:
    //   return skipped with a reason and no markdown writes.

    // Resolve every creation page target or maintenance target page using safe project path helpers.
    // Reject or fail closed if any target path escapes wiki root.
    // Reject or fail closed if maintenance apply is requested without
    // projects/<key>/state/project-memory.json.status === "curated".

    // For create mode:
    //   require concrete page drafts from the validated ProjectMemoryCreationDraft
    //   require a trusted index plus one meaningful domain page or explicit no-domain-pages rationale
    //   render page drafts into the first trusted wiki page set
    //   honor untrusted_existing_markdown_policy:
    //     adopt -> replace/normalize target pages with rendered trusted content and provenance
    //     rewrite -> overwrite target pages with rendered trusted content and provenance
    //     ignore -> leave non-target old pages untouched and untrusted
    //     quarantine_mixed -> stop before writes or route to review, depending on validator result
    //   initialize project-memory state only after page writes succeed
    //   record page and state changes in the changeset

    // For maintain mode:
    //   for each eligible item:
    //     read concrete item.apply_payload
    //     route by operation:
    //       CREATE_ENTRY -> append new entry block if entry id does not already exist
    //       PATCH_ENTRY -> replace existing entry block by target_entry_id
    //       ATTACH_EVIDENCE -> update provenance section for existing entry block
    //       MARK_STALE -> update lifecycle marker and append stale reason/provenance
    //       MARK_DISPUTED -> update lifecycle marker and append dispute reason/provenance
    //       SUPERSEDE_ENTRY -> update old entry lifecycle and link replacement entry if supplied
    //       RETRACT_ENTRY -> update lifecycle marker and preserve retraction provenance
    //       NOOP -> do not mutate page
    // Creation and maintenance are both required responsibilities of this applier boundary.
    // Implementation may share render/write/hash helpers, but should not defer one mode solely
    // to reduce workload.
    //
    // For each file:
    //   compute before hash
    //   compute bounded before snippets for changed entry blocks or page sections
    //   normalize markdown newline formatting
    //   write rendered output to staged_outputs_dir first
    //   record the expected canonical write in project-memory-apply-journal.json
    //
    // After the whole staged set validates:
    //   promote wiki pages first
    //   promote page manifest/log files if used
    //   promote projects/<key>/state/project-memory-source-consumptions.json or equivalent
    //   promote projects/<key>/state/project-memory.json last
    //   update observed promotions in the apply journal
    //
    // For each promoted file:
    //   compute after hash
    //   compute bounded after snippets for changed entry blocks or page sections
    //
    // Write project-memory-apply-result.json and project-memory-changeset.json, including
    // source-consumption records mirrored from project-level state.
    // Mark the apply journal terminal.
    // Return applied with changed_files plus page ids, item ids, and source-consumption refs.
  }

  async recoverFromJournal(journal: ProjectMemoryApplyJournal): Promise<ProjectMemoryApplyResult> {
    // Used by project learn before a new curator invocation.
    // Load saved packet, curator output, validation, staged outputs or renderable apply payloads.
    // Compare expected writes with observed promotions and current canonical hashes.
    // Complete any safe remaining promotions in the recorded write order.
    // If hashes or artifacts do not match the journal, fail closed with exact recovery guidance.
    // Do not invoke a provider and do not ask the curator to redo the run.
  }

  private renderEntryBlock(entry: ProjectMemoryEntryDraft): string {
    // Build stable markdown block:
    //   <!-- myelin-entry id="..." lifecycle="active" -->
    //   ### Entry Title
    //   body paragraphs/bullets/warnings
    //   Provenance subsection with packet refs, repo citations, inference label if present
    //   Applicability subsection when branches, repo paths, commands, or notes exist
    //   <!-- /myelin-entry -->
    //
    // Escape or reject marker-breaking content before rendering.
    // Do not preserve arbitrary curator block markers.
  }

  private renderPageDraft(page: ProjectMemoryPageDraft): string {
    // Build a complete page:
    //   # Title
    //   One-sentence purpose or description.
    //   Body sections from concrete payload.
    //   Page-level provenance.
    //
    // Page rendering is required for creation mode and may also support explicit new-page
    // maintenance operations if the contract adds them.
  }

  private upsertEntryBlock(pageText: string, entryId: string, renderedBlock: string): string {
    // If a myelin-entry block with entryId exists:
    //   replace exactly that block.
    // Else:
    //   append under a stable Project Memory Updates section.
    // Do not use fuzzy text patching.
  }

  private updateEntryLifecycle(pageText: string, entryId: string, lifecycle: string, reasonBlock: string): string {
    // Find the exact myelin-entry block.
    // Update lifecycle marker and append a lifecycle/provenance note inside the block.
    // If the entry is missing, fail this item without mutating the page.
  }

  private renderProvenance() {
    // Convert evidence refs and repo citations into durable markdown:
    // - Evidence: kind:ref plus optional note
    // - Repo citation: path:line_start-line_end with reason
    // - Inference: label and why direct evidence is unavailable
    //
    // The rendered markdown should be compact but traceable.
  }

  private writeStateUpdatesAfterApply() {
    // Update only narrow project-memory state owned by apply:
    // - projects/<key>/state/project-memory.json status/timestamps/run refs
    // - projects/<key>/state/pages.json manifest/hash updates if existing convention supports it
    // - projects/<key>/state/project-memory-source-consumptions.json or equivalent source-consumption state
    // - projects/<key>/log/changelog.md or log entry if current project shell expects it
    //
    // Do not update derived retrieval indexes in this slice.
    // Do not update candidate or handoff status directly; later reconciliation consumes
    // Project Memory Source Consumption records.
  }
}

export { ProjectMemoryMarkdownApplier };
