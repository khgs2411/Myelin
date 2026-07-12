import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  ProjectMemoryApplyJournal,
  ProjectMemoryApplyResult,
  ProjectMemoryExpectedWrite,
  ProjectMemoryObservedPromotion,
} from "./project-memory-apply-contracts.ts";
import { ensureParentDir, resolveInside } from "../runtime/fs.ts";
import { readJson, readJsonIfExists, writeJson } from "../runtime/json.ts";
import { assertProjectMemoryApplyJournal } from "./project-memory-apply-journal-validator.ts";

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
    await readApplyJournal(this.root, journalPath);
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
        const journal = await readApplyJournalIfExists(this.root, journalPath, projectKey);
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

  private async promoteFromJournal(
    journalPath: string,
    options: {
      stopAfterPromotionsForTest?: number;
      recovered?: boolean;
      finalizeJournal: boolean;
      requireApplyArtifactsBeforeTerminal: boolean;
    },
  ): Promise<ProjectMemoryApplyResult> {
    const journal = await readApplyJournal(this.root, journalPath);
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

async function readApplyJournal(
  root: string,
  journalPath: string,
  expectedProjectKey?: string,
): Promise<ProjectMemoryApplyJournal> {
  const value = await readJson<unknown>(journalPath);
  const input = { root, journalPath, value, expectedProjectKey };
  assertProjectMemoryApplyJournal(input);
  return input.value;
}

async function readApplyJournalIfExists(
  root: string,
  journalPath: string,
  expectedProjectKey: string,
): Promise<ProjectMemoryApplyJournal | null> {
  const value = await readJsonIfExists<unknown>(journalPath);
  if (value === null) return null;
  const input = { root, journalPath, value, expectedProjectKey };
  assertProjectMemoryApplyJournal(input);
  return input.value;
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
