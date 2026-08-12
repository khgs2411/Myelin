import type { Database } from "bun:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  runtimeInboxDir,
  runtimeInboxSourceRef,
  validateRuntimeInboxFilename,
  validateRuntimeInboxItem,
  type RuntimeInboxItem,
} from "../inbox/runtime-inbox-items.ts";
import { createMemoryCandidate, getMemoryCandidate } from "../memory/candidates.ts";
import { openMemoryDb } from "../memory/db.ts";
import { findProject } from "../runtime/projects.ts";

export type ProjectInboxIntakeSummary = {
  project_key: string;
  created_candidate_ids: string[];
  existing_candidate_ids: string[];
  terminal_duplicate_candidate_ids: string[];
  skipped_source_refs: string[];
  unsupported_source_refs: string[];
  invalid_source_refs: string[];
  degraded: boolean;
  blocking: boolean;
  degraded_reasons: string[];
};

export type ProjectInboxIntakeItemResult =
  | { status: "created"; candidate_id: string; source_ref: string }
  | { status: "existing"; candidate_id: string; source_ref: string; current_status: "pending" | "needs_review" }
  | { status: "terminal_duplicate"; candidate_id: string; source_ref: string; current_status: "processed" | "rejected" }
  | { status: "skipped"; source_ref: string; reason: string }
  | { status: "unsupported_layer"; source_ref: string; layer: string }
  | { status: "invalid_item"; source_ref: string; reason: string }
  | { status: "blocked"; reason: string };

export class ProjectMemoryCandidateIntakeService {
  constructor(private readonly root: string) {}

  async intakeProjectInbox(projectKey: string, now: Date = new Date()): Promise<ProjectInboxIntakeSummary> {
    const summary: ProjectInboxIntakeSummary = {
      project_key: projectKey,
      created_candidate_ids: [],
      existing_candidate_ids: [],
      terminal_duplicate_candidate_ids: [],
      skipped_source_refs: [],
      unsupported_source_refs: [],
      invalid_source_refs: [],
      degraded: false,
      blocking: false,
      degraded_reasons: [],
    };

    try {
      await findProject(this.root, projectKey);
    } catch (error) {
      return {
        ...summary,
        degraded: true,
        blocking: true,
        degraded_reasons: [errorMessage(error)],
      };
    }

    let entries: string[];
    try {
      entries = (await readdir(runtimeInboxDir(this.root, projectKey))).filter((entry) => entry.endsWith(".json")).sort();
    } catch (error) {
      if (isEnoent(error)) return summary;
      return { ...summary, degraded: true, blocking: true, degraded_reasons: [errorMessage(error)] };
    }

    const db = openMemoryDb(this.root);
    try {
      for (const entry of entries) {
        const result = await this.intakeFile(db, projectKey, entry, now);
        applyItemResult(summary, result);
      }
    } finally {
      db.close();
    }

    summary.degraded = summary.degraded_reasons.length > 0;
    return summary;
  }

  intakeInboxItem(db: Database, projectKey: string, item: RuntimeInboxItem, now: Date = new Date()): ProjectInboxIntakeItemResult {
    const sourceRef = runtimeInboxSourceRef(item.id);
    if (item.target_layer !== "project") return { status: "unsupported_layer", source_ref: sourceRef, layer: item.target_layer };
    if (item.project_key !== projectKey || item.target_scope !== projectKey) {
      return { status: "invalid_item", source_ref: sourceRef, reason: "runtime inbox item project scope does not match intake project" };
    }

    const candidateId = this.candidateIdFor(projectKey, item);
    const existing = getMemoryCandidate(db, candidateId);
    if (existing) {
      if (existing.status === "pending" || existing.status === "needs_review") {
        return { status: "existing", candidate_id: candidateId, source_ref: sourceRef, current_status: existing.status };
      }
      if (existing.status === "processed" || existing.status === "rejected") {
        return { status: "terminal_duplicate", candidate_id: candidateId, source_ref: sourceRef, current_status: existing.status };
      }
      return { status: "skipped", source_ref: sourceRef, reason: `unsupported existing candidate status: ${existing.status}` };
    }

    createMemoryCandidate(db, {
      id: candidateId,
      project_key: projectKey,
      scope: "project",
      status: "needs_review",
      candidate_type: "project.inbox",
      title: item.title,
      summary: item.body,
      source_event_refs: [sourceRef],
      evidence: {
        source_ref: sourceRef,
        evidence_refs: item.evidence_refs,
        target_hint: item.target_hint,
        created_at: item.created_at,
        creator: item.creator,
      },
      proposed_payload: {
        layer: item.target_layer,
        scope: item.target_scope,
        title: item.title,
        body: item.body,
        rationale: item.rationale,
        evidence_refs: item.evidence_refs,
        target_hint: item.target_hint,
        creator: item.creator,
        confidence: item.confidence,
        risk: item.risk,
        created_at: item.created_at,
        tags: item.tags,
      },
      confidence: item.confidence,
      risk: item.risk,
      reason: item.rationale,
      now: now.toISOString(),
    });

    return { status: "created", candidate_id: candidateId, source_ref: sourceRef };
  }

  candidateIdFor(projectKey: string, item: RuntimeInboxItem): string {
    return `project_inbox:${projectKey}:${item.id}`;
  }

  private async intakeFile(db: Database, projectKey: string, entry: string, now: Date): Promise<ProjectInboxIntakeItemResult> {
    let itemId = entry;
    try {
      itemId = validateRuntimeInboxFilename(entry);
    } catch (error) {
      return { status: "invalid_item", source_ref: `inbox:${basename(entry, ".json")}`, reason: errorMessage(error) };
    }

    const sourceRef = runtimeInboxSourceRef(itemId);
    try {
      const parsed = JSON.parse(await readFile(join(runtimeInboxDir(this.root, projectKey), entry), "utf8"));
      const item = validateRuntimeInboxItem(parsed, entry);
      return this.intakeInboxItem(db, projectKey, item, now);
    } catch (error) {
      return { status: "invalid_item", source_ref: sourceRef, reason: errorMessage(error) };
    }
  }
}

function applyItemResult(summary: ProjectInboxIntakeSummary, result: ProjectInboxIntakeItemResult): void {
  if (result.status === "created") summary.created_candidate_ids.push(result.candidate_id);
  else if (result.status === "existing") summary.existing_candidate_ids.push(result.candidate_id);
  else if (result.status === "terminal_duplicate") summary.terminal_duplicate_candidate_ids.push(result.candidate_id);
  else if (result.status === "skipped") {
    summary.skipped_source_refs.push(result.source_ref);
    summary.degraded_reasons.push(`${result.source_ref}: ${result.reason}`);
  } else if (result.status === "unsupported_layer") {
    summary.unsupported_source_refs.push(result.source_ref);
    summary.degraded_reasons.push(`${result.source_ref}: unsupported layer ${result.layer}`);
  } else if (result.status === "invalid_item") {
    summary.invalid_source_refs.push(result.source_ref);
    summary.degraded_reasons.push(`${result.source_ref}: ${result.reason}`);
  } else {
    summary.blocking = true;
    summary.degraded_reasons.push(result.reason);
  }
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
