import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  ProjectMemoryAppliedFileChange,
  ProjectMemoryAppliedItemChange,
  ProjectMemoryAppliedPageChange,
  ProjectMemoryApplyJournal,
  ProjectMemoryApplyResult,
  ProjectMemoryChangeset,
  ProjectMemoryExpectedWrite,
  ProjectMemoryObservedPromotion,
  ProjectMemorySourceConsumptionRecord,
} from "./project-memory-apply-contracts.ts";
import type {
  ProjectMemoryCreationDraft,
  ProjectMemoryMaintenanceProposal,
  ProjectMemoryMaintenanceProposalItem,
  ProjectMemoryRisk,
} from "./project-memory-curator-contracts.ts";
import type { ExplicitNoOpDecision } from "./project-memory-retrieval-contracts.ts";
import { PROJECT_MEMORY_CREATION_MIN_PAGES } from "./project-memory-curator-contracts.ts";
import { isTrustedProjectMemoryQuality } from "./project-memory-quality-contract.ts";
import {
  boundedSnippetForText,
  findEntryBlock,
  renderEntryBlock,
  renderPageDraft,
  updateEntryLifecycle,
  upsertEntryBlock,
} from "./project-memory-markdown-renderer.ts";
import {
  extractProjectMemorySections,
  extractProjectMemorySectionsFromMarkdown,
  type ProjectMemoryMarkdownSection,
} from "./project-memory-markdown-sections.ts";
import {
  insertMarkdownSection,
  patchMarkdownSection,
  renderSectionBody,
} from "./project-memory-section-renderer.ts";
import { resolveSectionTarget } from "./project-memory-section-targets.ts";
import { ensureParentDir, resolveInside } from "../runtime/fs.ts";
import { readJson, readJsonIfExists, writeJson } from "../runtime/json.ts";

type StagedWriteKind = ProjectMemoryExpectedWrite["write_kind"];

export type ProjectMemoryStagedWrite = {
  canonical_project_path: string;
  content: string;
  write_kind: StagedWriteKind;
  page_ids?: string[];
  item_ids?: string[];
};

export type PromoteStagedWritesInput = {
  project_key: string;
  run_dir: string;
  mode: "create" | "maintain";
  absolute_run_dir: string;
  curator_output_ref: string;
  staged_outputs_dir: string;
  writes: ProjectMemoryStagedWrite[];
  stop_after_promotions_for_test?: number;
  finalize_journal_after_promotion?: boolean;
  require_apply_artifacts_before_terminal?: boolean;
};

export type ApplyCreationDraftInput = {
  project_key: string;
  run_dir: string;
  absolute_run_dir: string;
  draft: ProjectMemoryCreationDraft;
};

export type ApplyMaintenanceProposalInput = {
  project_key: string;
  run_dir: string;
  absolute_run_dir: string;
  proposal: ProjectMemoryMaintenanceProposal;
  eligible_item_ids: string[];
};

export class ProjectMemoryMarkdownApplier {
  constructor(private readonly root: string) {}

  async promoteStagedWrites(input: PromoteStagedWritesInput): Promise<ProjectMemoryApplyResult> {
    const ordered = orderWrites(input.writes);
    await mkdir(input.staged_outputs_dir, { recursive: true });
    const expected: ProjectMemoryExpectedWrite[] = [];

    for (let index = 0; index < ordered.length; index += 1) {
      const write = ordered[index];
      const canonical = resolveInside(this.root, write.canonical_project_path);
      const stagedRef = `staged/${String(index + 1).padStart(3, "0")}-${write.write_kind}-${safeBasename(write.canonical_project_path)}`;
      const stagedPath = resolveInside(input.absolute_run_dir, stagedRef);
      await ensureParentDir(stagedPath);
      await writeFile(stagedPath, write.content, "utf8");
      expected.push({
        canonical_path: write.canonical_project_path,
        staged_output_ref: stagedRef,
        before_sha256: await sha256FileIfExists(canonical),
        write_order: index + 1,
        write_kind: write.write_kind,
        page_ids: write.page_ids,
        item_ids: write.item_ids,
      });
    }

    const journalPath = join(input.absolute_run_dir, "project-memory-apply-journal.json");
    const journal: ProjectMemoryApplyJournal = {
      schema_version: 1,
      project_key: input.project_key,
      run_dir: input.run_dir,
      mode: input.mode,
      status: "staged",
      packet_ref: "input-packet.json",
      curator_output_ref: input.curator_output_ref,
      validation_ref: "curator-validation.json",
      staged_outputs_dir: "staged",
      expected_writes: expected,
      observed_promotions: [],
      recovery: { required_before_new_curator: true },
    };
    await writeJson(journalPath, journal);
    return await this.promoteFromJournal(journalPath, {
      stopAfterPromotionsForTest: input.stop_after_promotions_for_test,
      finalizeJournal: input.finalize_journal_after_promotion ?? true,
      requireApplyArtifactsBeforeTerminal: input.require_apply_artifacts_before_terminal ?? false,
    });
  }

  async recoverFromJournal(journalPath: string): Promise<ProjectMemoryApplyResult> {
    if (!(await applyArtifactsExist(dirname(journalPath)))) {
      return failedResult("apply recovery blocked: apply result or changeset artifact is missing");
    }
    return await this.promoteFromJournal(journalPath, {
      recovered: true,
      finalizeJournal: true,
      requireApplyArtifactsBeforeTerminal: true,
    });
  }

  async findIncompleteApplyJournals(projectKey: string): Promise<string[]> {
    const runsRoot = resolveInside(this.root, "projects", projectKey, "runs", "project-learn");
    try {
      const entries = await readdir(runsRoot, { withFileTypes: true });
      const journals: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const journalPath = join(runsRoot, entry.name, "project-memory-apply-journal.json");
        const journal = await readJsonIfExists<ProjectMemoryApplyJournal>(journalPath);
        if (journal && (journal.status !== "applied" && journal.status !== "recovered" && journal.status !== "failed")) {
          journals.push(journalPath);
        } else if (journal && (journal.status === "applied" || journal.status === "recovered") && !(await applyArtifactsExist(dirname(journalPath)))) {
          journals.push(journalPath);
        }
      }
      return journals.sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async applyCreationDraft(input: ApplyCreationDraftInput): Promise<ProjectMemoryApplyResult> {
    const existingState = await readJsonIfExists<{ status?: string }>(
      resolveInside(this.root, "projects", input.project_key, "state", "project-memory.json"),
    );
    if (existingState?.status === "curated") return skippedResult("creation apply skipped: project memory is already curated");
    if (!isTrustedProjectMemoryQuality(input.draft.quality_diagnostics)) {
      return skippedResult("creation apply skipped: Project Memory content quality is not trusted");
    }
    if (!creationPublicationMinimumMet(input.draft)) return skippedResult("creation apply skipped: publication minimum not met");
    if (!input.draft.state_intent.mark_project_memory_curated) return skippedResult("creation apply skipped: curated state intent missing");

    const writes: ProjectMemoryStagedWrite[] = [];
    const pageChanges: ProjectMemoryAppliedPageChange[] = [];
    for (const page of input.draft.pages) {
      const payloadPage = page.apply_payload?.pages?.find((draftPage) => draftPage.page_path === page.target.path);
      if (!payloadPage) return skippedResult(`creation apply skipped: missing page payload for ${page.id}`);
      const rendered = renderPageDraft(payloadPage);
      writes.push({
        canonical_project_path: `projects/${input.project_key}/wiki/${page.target.path}`,
        content: rendered,
        write_kind: "wiki_page",
        page_ids: [page.id],
      });
      pageChanges.push({
        page_id: page.id,
        operation: page.target.path_kind === "existing_wiki_page" ? "adopt" : "create",
        target_page: page.target.path,
        after_snippet: boundedSnippetForText(`wiki/${page.target.path}`, page.id, rendered),
        evidence_refs: page.evidence_refs,
        repo_citations: page.repo_citations,
        inference: payloadPage.inference,
      });
    }

    writes.push({
      canonical_project_path: `projects/${input.project_key}/state/project-memory.json`,
      content: `${JSON.stringify(
        {
          project_key: input.project_key,
          source_run_dir: input.run_dir,
          status: "curated",
          updated_at: new Date().toISOString(),
          content_quality: {
            status: "trusted",
            checked_at: new Date().toISOString(),
            contract_version: 1,
          },
          retrieval_readiness: {
            status: "pending",
            checked_at: new Date().toISOString(),
          },
        },
        null,
        2,
      )}\n`,
      write_kind: "project_state",
    });

    const promoted = await this.promoteStagedWrites({
      project_key: input.project_key,
      run_dir: input.run_dir,
      mode: "create",
      absolute_run_dir: input.absolute_run_dir,
      curator_output_ref: "curator-creation-draft.json",
      staged_outputs_dir: join(input.absolute_run_dir, "staged"),
      writes,
      finalize_journal_after_promotion: false,
      require_apply_artifacts_before_terminal: true,
    });
    return await this.writeApplyArtifacts({
      absolute_run_dir: input.absolute_run_dir,
      project_key: input.project_key,
      run_dir: input.run_dir,
      curator_output_ref: "curator-creation-draft.json",
      risk: input.draft.risk,
      result: { ...promoted, applied_page_ids: input.draft.pages.map((page) => page.id) },
      page_changes: pageChanges,
      item_changes: [],
    });
  }

  async applyMaintenanceProposal(input: ApplyMaintenanceProposalInput): Promise<ProjectMemoryApplyResult> {
    const projectMemory = await readJsonIfExists<{ status?: string }>(
      resolveInside(this.root, "projects", input.project_key, "state", "project-memory.json"),
    );
    if (projectMemory?.status !== "curated") {
      return skippedResult("maintenance apply skipped: trusted Project Memory state is required");
    }

    const pageUpdates = new Map<string, string>();
    const itemChanges: ProjectMemoryAppliedItemChange[] = [];
    const sourceConsumptions: ProjectMemorySourceConsumptionRecord[] = [];
    const appliedItemIds: string[] = [];

    sourceConsumptions.push(...sourceConsumptionsForExplicitNoops({
      projectKey: input.project_key,
      runDir: input.run_dir,
      decisions: input.proposal.explicit_noop_decisions ?? [],
    }));

    for (const item of input.proposal.items.filter((candidate) => input.eligible_item_ids.includes(candidate.id))) {
      if (item.operation === "NOOP") continue;
      const applied = isLegacyOperation(item.operation)
        ? await applyLegacyMaintenanceItem(this.root, input.project_key, item, pageUpdates)
        : await applySectionMaintenanceItem(this.root, input.project_key, item, pageUpdates);
      if (applied.status === "skipped") return skippedResult(applied.reason);
      const { pagePath, nextPage, beforeSnippet, afterSnippet, entryId, inference } = applied;
      pageUpdates.set(pagePath, nextPage);
      itemChanges.push({
        item_id: item.id,
        operation: item.operation,
        target_page: pagePath,
        entry_id: entryId,
        before_snippet: beforeSnippet,
        after_snippet: afterSnippet,
        evidence_refs: item.evidence_refs,
        repo_citations: item.repo_citations,
        inference,
      });
      sourceConsumptions.push(...sourceConsumptionsForMaintenance({ projectKey: input.project_key, runDir: input.run_dir, item }));
      appliedItemIds.push(item.id);
    }

    if (appliedItemIds.length === 0 && sourceConsumptions.length === 0) {
      return skippedResult("maintenance apply skipped: no eligible mutation items");
    }

    const writes: ProjectMemoryStagedWrite[] = [...pageUpdates.entries()].map(([pagePath, content]) => ({
      canonical_project_path: `projects/${input.project_key}/wiki/${pagePath}`,
      content,
      write_kind: "wiki_page",
      item_ids: appliedItemIds,
    }));
    const sourceState = await nextSourceConsumptionState(input.project_key, sourceConsumptions, this.root);
    writes.push({
      canonical_project_path: `projects/${input.project_key}/state/project-memory-source-consumptions.json`,
      content: `${JSON.stringify(sourceState, null, 2)}\n`,
      write_kind: "source_consumption_state",
      item_ids: appliedItemIds,
    });

    const promoted = await this.promoteStagedWrites({
      project_key: input.project_key,
      run_dir: input.run_dir,
      mode: "maintain",
      absolute_run_dir: input.absolute_run_dir,
      curator_output_ref: "curator-maintenance-proposal.json",
      staged_outputs_dir: join(input.absolute_run_dir, "staged"),
      writes,
      finalize_journal_after_promotion: false,
      require_apply_artifacts_before_terminal: true,
    });
    return await this.writeApplyArtifacts({
      absolute_run_dir: input.absolute_run_dir,
      project_key: input.project_key,
      run_dir: input.run_dir,
      curator_output_ref: "curator-maintenance-proposal.json",
      risk: input.proposal.risk,
      result: { ...promoted, applied_item_ids: appliedItemIds, source_consumptions: sourceConsumptions },
      page_changes: [],
      item_changes: itemChanges,
    });
  }

  private async promoteFromJournal(
    journalPath: string,
    options: {
      stopAfterPromotionsForTest?: number;
      recovered?: boolean;
      finalizeJournal: boolean;
      requireApplyArtifactsBeforeTerminal: boolean;
    },
  ): Promise<ProjectMemoryApplyResult> {
    const journal = await readJson<ProjectMemoryApplyJournal>(journalPath);
    const runAbs = dirname(journalPath);
    const observed: ProjectMemoryObservedPromotion[] = [...journal.observed_promotions];
    const observedDrift = await observedPromotionDrift(this.root, observed);
    if (observedDrift) {
      const reason = `apply recovery blocked: observed canonical file changed after promotion: ${observedDrift}`;
      await writeJson(journalPath, {
        ...journal,
        status: "failed",
        observed_promotions: observed,
        recovery: { required_before_new_curator: true, last_attempt_at: new Date().toISOString(), guidance: reason },
      });
      return failedResult(reason);
    }
    await writeJson(journalPath, { ...journal, status: "promoting", observed_promotions: observed });

    for (const expected of [...journal.expected_writes].sort((a, b) => a.write_order - b.write_order)) {
      if (observed.some((promotion) => promotion.canonical_path === expected.canonical_path)) continue;
      const canonicalPath = resolveInside(this.root, expected.canonical_path);
      const stagedPath = resolveInside(runAbs, expected.staged_output_ref);
      const currentHash = await sha256FileIfExists(canonicalPath);
      if (currentHash !== expected.before_sha256) {
        const reason = `apply recovery blocked: canonical file changed before promotion: ${expected.canonical_path}`;
        await writeJson(journalPath, {
          ...journal,
          status: "failed",
          observed_promotions: observed,
          recovery: { required_before_new_curator: true, last_attempt_at: new Date().toISOString(), guidance: reason },
        });
        return failedResult(reason);
      }
      await ensureParentDir(canonicalPath);
      const tmpPath = `${canonicalPath}.tmp-${process.pid}-${Date.now()}`;
      await copyFile(stagedPath, tmpPath);
      await rename(tmpPath, canonicalPath);
      observed.push({
        canonical_path: expected.canonical_path,
        after_sha256: await sha256File(canonicalPath),
        promoted_at: new Date().toISOString(),
      });
      await writeJson(journalPath, { ...journal, status: "promoting", observed_promotions: observed });
      if (options.stopAfterPromotionsForTest && observed.length >= options.stopAfterPromotionsForTest) {
        return failedResult("stopped after requested test promotions");
      }
    }

    if (options.finalizeJournal) {
      await finalizeJournal(journalPath, journal, observed, options.recovered ? "recovered" : "applied", {
        requireApplyArtifacts: options.requireApplyArtifactsBeforeTerminal,
      });
    } else {
      await writeJson(journalPath, {
        ...journal,
        status: "promoting",
        observed_promotions: observed,
        recovery: {
          required_before_new_curator: true,
          last_attempt_at: new Date().toISOString(),
          guidance: "apply artifacts must be written before this journal is terminal",
        },
      });
    }
    return {
      ...emptyApplyResult("applied"),
      changed_files: journal.expected_writes.map((write) => {
        const observedPromotion = observed.find((promotion) => promotion.canonical_path === write.canonical_path);
        return {
          path: write.canonical_path,
          before_sha256: write.before_sha256,
          after_sha256: observedPromotion?.after_sha256 ?? "",
          operation: write.before_sha256 ? "update" : "create",
          page_ids: write.page_ids ?? [],
          item_ids: write.item_ids ?? [],
          staged_output_ref: write.staged_output_ref,
        };
      }),
      state_updates: journal.expected_writes
        .filter((write) => write.write_kind !== "wiki_page")
        .map((write) => ({
          path: write.canonical_path,
          before_sha256: write.before_sha256,
          after_sha256: observed.find((promotion) => promotion.canonical_path === write.canonical_path)?.after_sha256 ?? "",
          reason: write.write_kind,
        })),
    };
  }

  private async writeApplyArtifacts(input: {
    absolute_run_dir: string;
    project_key: string;
    run_dir: string;
    curator_output_ref: string;
    risk: ProjectMemoryRisk;
    result: ProjectMemoryApplyResult;
    page_changes: ProjectMemoryAppliedPageChange[];
    item_changes: ProjectMemoryAppliedItemChange[];
  }): Promise<ProjectMemoryApplyResult> {
    const changeset: ProjectMemoryChangeset = {
      schema_version: 1,
      project_key: input.project_key,
      run_dir: input.run_dir,
      packet_ref: { artifact: "input-packet.json", packet_schema_version: 1 },
      curator_output_ref: input.curator_output_ref,
      validation_ref: "curator-validation.json",
      applied_at: new Date().toISOString(),
      risk: input.risk,
      file_changes: input.result.changed_files,
      page_changes: input.page_changes,
      item_changes: input.item_changes,
      source_consumptions: input.result.source_consumptions,
    };
    await writeJson(resolveInside(input.absolute_run_dir, "project-memory-apply-result.json"), input.result);
    await writeJson(resolveInside(input.absolute_run_dir, "project-memory-changeset.json"), changeset);
    await finalizeJournal(
      resolveInside(input.absolute_run_dir, "project-memory-apply-journal.json"),
      await readJson<ProjectMemoryApplyJournal>(resolveInside(input.absolute_run_dir, "project-memory-apply-journal.json")),
      await observedPromotionsFromJournal(resolveInside(input.absolute_run_dir, "project-memory-apply-journal.json")),
      "applied",
      { requireApplyArtifacts: true },
    );
    return input.result;
  }
}

type AppliedMaintenancePageUpdate = {
  status: "applied";
  pagePath: string;
  nextPage: string;
  beforeSnippet?: ProjectMemoryAppliedItemChange["before_snippet"];
  afterSnippet?: ProjectMemoryAppliedItemChange["after_snippet"];
  entryId?: string;
  inference?: ProjectMemoryAppliedItemChange["inference"];
} | {
  status: "skipped";
  reason: string;
};

async function applyLegacyMaintenanceItem(
  root: string,
  projectKey: string,
  item: ProjectMemoryMaintenanceProposalItem,
  pageUpdates: Map<string, string>,
): Promise<AppliedMaintenancePageUpdate> {
  const pagePath = item.target_page?.path;
  if (!pagePath) return { status: "skipped", reason: `maintenance apply skipped: missing legacy target page for ${item.id}` };
  const absolutePagePath = resolveInside(root, "projects", projectKey, "wiki", pagePath);
  const pageText = pageUpdates.get(pagePath) ?? (await readFileIfExists(absolutePagePath));
  if (pageText === null) return { status: "skipped", reason: `maintenance apply skipped: target page is missing: ${pagePath}` };
  const entry = item.apply_payload?.entries?.[0];
  if (!entry) return { status: "skipped", reason: `maintenance apply skipped: missing entry payload for ${item.id}` };
  const entryId = item.target_entry_id ?? item.proposed_entry_id ?? entry.entry_id;
  const beforeSnippet = snippetFromPage(pagePath, entryId, pageText);
  const nextPage = applyMaintenanceItem(pageText, item, renderEntryBlock(entry), entryId);
  const afterSnippet = snippetFromPage(pagePath, entryId, nextPage);
  return { status: "applied", pagePath, nextPage, beforeSnippet, afterSnippet, entryId, inference: entry.inference };
}

async function applySectionMaintenanceItem(
  root: string,
  projectKey: string,
  item: ProjectMemoryMaintenanceProposalItem,
  pageUpdates: Map<string, string>,
): Promise<AppliedMaintenancePageUpdate> {
  const target = item.target;
  if (!target) return { status: "skipped", reason: `maintenance apply skipped: missing section target for ${item.id}` };
  const pagePath = target.wiki_path;
  const absolutePagePath = resolveInside(root, "projects", projectKey, "wiki", pagePath);
  if (item.operation === "CREATE_PAGE") {
    const page = item.apply_payload?.page;
    if (!page) return { status: "skipped", reason: `maintenance apply skipped: missing page payload for ${item.id}` };
    const existingPage = pageUpdates.get(pagePath) ?? (await readFileIfExists(absolutePagePath));
    if (existingPage !== null) return { status: "skipped", reason: `maintenance apply skipped: CREATE_PAGE target already exists: ${pagePath}` };
    const rendered = renderPageDraft(page);
    return {
      status: "applied",
      pagePath,
      nextPage: rendered,
      afterSnippet: boundedSnippetForText(`wiki/${pagePath}`, item.id, rendered),
      inference: page.inference,
    };
  }

  const pageText = pageUpdates.get(pagePath) ?? (await readFileIfExists(absolutePagePath));
  if (pageText === null) return { status: "skipped", reason: `maintenance apply skipped: target page is missing: ${pagePath}` };
  const section = item.apply_payload?.section;
  if (!section) return { status: "skipped", reason: `maintenance apply skipped: missing section payload for ${item.id}` };
  const renderedBody = renderSectionBody({
    body: section.body,
    evidence_refs: section.evidence_refs,
    repo_citations: section.repo_citations,
  });

  if (item.operation === "CREATE_SECTION") {
    const nextPage = insertMarkdownSection(pageText, { heading: section.heading, level: section.level, body: renderedBody });
    return {
      status: "applied",
      pagePath,
      nextPage,
      beforeSnippet: boundedSnippetForText(`wiki/${pagePath}`, item.id, ""),
      afterSnippet: boundedSnippetForText(`wiki/${pagePath}`, item.id, renderedBody),
      inference: section.inference,
    };
  }

  if (!target.expected_section_hash) {
    return { status: "skipped", reason: `maintenance apply skipped: missing expected section hash for ${item.id}` };
  }
  const sectionRef = await resolveCurrentSectionTarget(root, projectKey, pageUpdates, target);
  if (!sectionRef) return { status: "skipped", reason: `maintenance apply skipped: unresolved section target for ${item.id}` };
  const beforeSnippet = boundedSnippetForText(`wiki/${pagePath}`, sectionRef.section_id, sectionRef.body_text);
  const nextPage = patchMarkdownSection(pageText, {
    section: sectionRef,
    expected_section_hash: target.expected_section_hash,
    body: renderedBody,
  });
  return {
    status: "applied",
    pagePath,
    nextPage,
    beforeSnippet,
    afterSnippet: boundedSnippetForText(`wiki/${pagePath}`, sectionRef.section_id, renderedBody),
    inference: section.inference,
  };
}

async function resolveCurrentSectionTarget(
  root: string,
  projectKey: string,
  pageUpdates: Map<string, string>,
  target: NonNullable<ProjectMemoryMaintenanceProposalItem["target"]>,
): Promise<ProjectMemoryMarkdownSection | null> {
  const manifest = await extractProjectMemorySections(root, projectKey);
  const sections = [...manifest.sections];
  for (const [pagePath, updatedText] of pageUpdates) {
    const wikiPath = `wiki/${pagePath}`;
    const page = manifest.pages.find((candidate) => candidate.wiki_path === wikiPath);
    const updatedSections = extractProjectMemorySectionsFromMarkdown({
      projectKey,
      wikiPath,
      text: updatedText,
      category: page?.category,
      title: page?.title,
    });
    const firstIndex = sections.findIndex((section) => section.wiki_path === wikiPath);
    sections.splice(firstIndex < 0 ? sections.length : firstIndex, sections.filter((section) => section.wiki_path === wikiPath).length, ...updatedSections);
  }
  const resolved = resolveSectionTarget(sections, {
    wiki_path: `wiki/${target.wiki_path}`,
    section_id: target.section_id ?? "",
    expected_section_hash: target.expected_section_hash,
  });
  return resolved.status === "resolved" ? resolved.section : null;
}

function applyMaintenanceItem(pageText: string, item: ProjectMemoryMaintenanceProposalItem, renderedEntry: string, entryId: string): string {
  if (item.operation === "CREATE_ENTRY" || item.operation === "PATCH_ENTRY" || item.operation === "ATTACH_EVIDENCE") {
    return upsertEntryBlock(pageText, entryId, renderedEntry);
  }
  return updateEntryLifecycle(pageText, entryId, item.lifecycle_intent, item.expected_outcome);
}

function creationPublicationMinimumMet(draft: ProjectMemoryCreationDraft): boolean {
  const hasIndex = draft.pages.some((page) => page.target.path === "index.md");
  const nonIndexPages = draft.pages.filter((page) => page.target.path !== "index.md");
  return hasIndex && nonIndexPages.length >= PROJECT_MEMORY_CREATION_MIN_PAGES - 1;
}

function snippetFromPage(pagePath: string, entryId: string, pageText: string) {
  const block = findEntryBlock(pageText, entryId);
  return block ? boundedSnippetForText(`wiki/${pagePath}`, entryId, block.text) : undefined;
}

function sourceConsumptionsForExplicitNoops(input: {
  projectKey: string;
  runDir: string;
  decisions: ExplicitNoOpDecision[];
}): ProjectMemorySourceConsumptionRecord[] {
  return input.decisions.flatMap((decision) =>
    decision.source_packet_refs
      .filter((ref): ref is typeof ref & { kind: "project_candidate" | "project_handoff" } => ref.kind === "project_candidate" || ref.kind === "project_handoff")
      .map((ref) => ({
        source_kind: ref.kind,
        source_ref: ref.ref,
        project_key: input.projectKey,
        consumed_by_run: input.runDir,
        consumed_at: new Date().toISOString(),
        terminal_decision: decision.reason,
        output_refs: ["project-memory-changeset.json"],
      })),
  );
}

function sourceConsumptionsForMaintenance(input: {
  projectKey: string;
  runDir: string;
  item: ProjectMemoryMaintenanceProposalItem;
}): ProjectMemorySourceConsumptionRecord[] {
  return input.item.source_packet_refs
    .filter((ref): ref is typeof ref & { kind: "project_candidate" | "project_handoff" } => ref.kind === "project_candidate" || ref.kind === "project_handoff")
    .map((ref) => ({
      source_kind: ref.kind,
      source_ref: ref.ref,
      project_key: input.projectKey,
      consumed_by_run: input.runDir,
      consumed_at: new Date().toISOString(),
      terminal_decision: input.item.candidate_disposition ?? "applied_to_project_memory",
      output_refs: ["project-memory-changeset.json"],
    }));
}

function isLegacyOperation(operation: unknown): boolean {
  return operation === "CREATE_ENTRY" || operation === "PATCH_ENTRY" || operation === "SUPERSEDE_ENTRY" || operation === "RETRACT_ENTRY";
}

async function nextSourceConsumptionState(
  projectKey: string,
  records: ProjectMemorySourceConsumptionRecord[],
  root: string,
): Promise<{ schema_version: 1; project_key: string; records: ProjectMemorySourceConsumptionRecord[] }> {
  const path = resolveInside(root, "projects", projectKey, "state", "project-memory-source-consumptions.json");
  const existing = await readJsonIfExists<{ records?: ProjectMemorySourceConsumptionRecord[] }>(path);
  return { schema_version: 1, project_key: projectKey, records: [...(existing?.records ?? []), ...records] };
}

async function applyArtifactsExist(runDir: string): Promise<boolean> {
  return (await exists(join(runDir, "project-memory-apply-result.json"))) && (await exists(join(runDir, "project-memory-changeset.json")));
}

async function finalizeJournal(
  journalPath: string,
  journal: ProjectMemoryApplyJournal,
  observed: ProjectMemoryObservedPromotion[],
  status: "applied" | "recovered",
  options: { requireApplyArtifacts: boolean },
): Promise<void> {
  if (options.requireApplyArtifacts && !(await applyArtifactsExist(dirname(journalPath)))) {
    await writeJson(journalPath, {
      ...journal,
      status: "promoting",
      observed_promotions: observed,
      recovery: {
        required_before_new_curator: true,
        last_attempt_at: new Date().toISOString(),
        guidance: "apply result and changeset artifacts must exist before terminal journal status",
      },
    });
    return;
  }
  await writeJson(journalPath, {
    ...journal,
    status,
    observed_promotions: observed,
    recovery: { required_before_new_curator: false, last_attempt_at: new Date().toISOString() },
  });
}

async function observedPromotionsFromJournal(journalPath: string): Promise<ProjectMemoryObservedPromotion[]> {
  return (await readJson<ProjectMemoryApplyJournal>(journalPath)).observed_promotions;
}

async function observedPromotionDrift(root: string, observed: ProjectMemoryObservedPromotion[]): Promise<string | null> {
  for (const promotion of observed) {
    const canonicalPath = resolveInside(root, promotion.canonical_path);
    const currentHash = await sha256FileIfExists(canonicalPath);
    if (currentHash !== promotion.after_sha256) return promotion.canonical_path;
  }
  return null;
}

function orderWrites(writes: ProjectMemoryStagedWrite[]): ProjectMemoryStagedWrite[] {
  const rank: Record<StagedWriteKind, number> = {
    wiki_page: 1,
    page_state: 2,
    log: 3,
    source_consumption_state: 4,
    project_state: 5,
  };
  return [...writes].sort((a, b) => rank[a.write_kind] - rank[b.write_kind] || a.canonical_project_path.localeCompare(b.canonical_project_path));
}

function emptyApplyResult(status: ProjectMemoryApplyResult["status"]): ProjectMemoryApplyResult {
  return {
    status,
    applied_page_ids: [],
    applied_item_ids: [],
    skipped_page_ids: [],
    skipped_item_ids: [],
    failed_page_ids: [],
    failed_item_ids: [],
    changed_files: [],
    state_updates: [],
    source_consumptions: [],
    artifacts: {
      apply_journal: "project-memory-apply-journal.json",
      apply_result: "project-memory-apply-result.json",
      changeset: "project-memory-changeset.json",
    },
  };
}

function skippedResult(reason: string): ProjectMemoryApplyResult {
  return { ...emptyApplyResult("skipped"), reason };
}

function failedResult(reason: string): ProjectMemoryApplyResult {
  return { ...emptyApplyResult("failed"), reason };
}

function safeBasename(path: string): string {
  return basename(path).replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function sha256FileIfExists(path: string): Promise<string | null> {
  try {
    return await sha256File(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    await stat(path);
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
