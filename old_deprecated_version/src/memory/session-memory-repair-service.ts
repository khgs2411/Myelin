import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openMemoryDb } from "./db.ts";
import type { SessionMemoryRow } from "./ingest-types.ts";
import { retractSessionMemory } from "./session-memories.ts";
import {
  advanceSessionMemoryRevisionInOpenTransaction,
  createSessionMemoryRevisionMutation,
} from "./session-memory-revisions.ts";
import { isSessionMemoryControlEventKind } from "./session-memory-policy.ts";
import { createRunDir, timestampRunId } from "../runtime/artifacts.ts";
import { writeJson } from "../runtime/json.ts";
import { createId } from "../runtime/ids.ts";
import {
  acquireProjectSessionMutationFence,
  inspectProjectSessionMutationFence,
  ProjectSessionMutationAuthorityError,
  readSessionMemoryMutationAuthorityMode,
  releaseProjectSessionMutationFence,
  transitionProjectSessionMutationFence,
  withLegacySessionMutationAuthority,
  type FencedSessionMutationAuthority,
  type ProjectSessionMutationAuthority,
} from "./project-session-mutation-fence.ts";
import type { ProcessLivenessChecker } from "../ingest/runtime.ts";
import { requireSessionMemoryAuthorityActivation } from "../session-maintenance/authority-activation-service.ts";

export const SESSION_MEMORY_REPAIR_POLICY = "session-control-events-v1";

export type SessionMemoryRepairCandidate = {
  id: string;
  title: string | null;
  summary: string;
  source_event_refs: string[];
  source_ref_hash: string;
  revision: number;
  state_digest: string;
  event_kinds: string[];
  disposition: "retract";
  reason: string;
};

export type SessionMemoryRepairResult = {
  schema_version: 1;
  policy: typeof SESSION_MEMORY_REPAIR_POLICY;
  project_key: string;
  mode: "preview" | "apply";
  status: "preview" | "prepared" | "completed";
  generated_at: string;
  report_path: string | null;
  proposed_retractions: number;
  applied_retractions: number;
  candidates: SessionMemoryRepairCandidate[];
};

export class SessionMemoryRepairService {
  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
    private readonly isProcessAlive?: ProcessLivenessChecker,
  ) {}

  preview(projectKey: string): SessionMemoryRepairResult {
    const db = openMemoryDb(this.root);
    try {
      return buildRepairResult(db, projectKey, this.now().toISOString());
    } finally {
      db.close();
    }
  }

  async apply(projectKey: string): Promise<SessionMemoryRepairResult> {
    const generatedAt = this.now();
    const db = openMemoryDb(this.root);
    let fencedAuthority: FencedSessionMutationAuthority | null = null;
    const repairOwnerId = `repair_${createId()}`;
    try {
      requireSessionMemoryAuthorityActivation(db, {
        now: this.now,
        isProcessAlive: this.isProcessAlive,
      });
      if (readSessionMemoryMutationAuthorityMode(db) === "smc_v1") {
        const acquired = acquireProjectSessionMutationFence(db, {
          projectKey,
          ownerId: repairOwnerId,
          ownerKind: "repair",
          phase: "running",
          now: generatedAt.toISOString(),
        });
        if (acquired.kind !== "acquired") {
          throw new ProjectSessionMutationAuthorityError(
            acquired.code,
            acquired.kind === "busy"
              ? `Session Memory mutation is already active for ${projectKey}: ${acquired.owner.owner_id}`
              : acquired.kind === "global_busy"
                ? `Session embedding lifecycle operation is already active: ${acquired.owner.operation_id}`
              : `Session Memory mutation authority is not active for ${projectKey}`,
          );
        }
        fencedAuthority = acquired.authority;
      }
      const preview = buildRepairResult(db, projectKey, generatedAt.toISOString());
      const absoluteRunDir = await createRunDir(
        this.root,
        projectKey,
        timestampRunId(generatedAt),
        "memory-session-repair",
      );
      const reportPath = join(absoluteRunDir, "report.json");
      const prepared: SessionMemoryRepairResult = {
        ...preview,
        mode: "apply",
        status: "prepared",
        report_path: reportPath,
      };
      await writeJson(reportPath, prepared);

      let appliedRetractions = 0;
      const applyWithAuthority = (authority: ProjectSessionMutationAuthority): void => {
        appliedRetractions = applySessionMemoryRepairCandidatesInOpenTransaction(db, {
          projectKey,
          candidates: preview.candidates,
          appliedAt: generatedAt.toISOString(),
          authority,
        });
      };
      if (fencedAuthority) {
        db.transaction(() => {
          applyWithAuthority(fencedAuthority!);
          const completed = transitionProjectSessionMutationFence(db, {
            authority: fencedAuthority!,
            expectedPhase: "running",
            nextPhase: "completed",
            now: generatedAt.toISOString(),
          });
          if (completed.kind !== "updated") {
            throw new ProjectSessionMutationAuthorityError(completed.code, "repair fence completion was rejected");
          }
          fencedAuthority = completed.authority;
          const released = releaseProjectSessionMutationFence(db, fencedAuthority);
          if (released.kind !== "released") {
            throw new ProjectSessionMutationAuthorityError(released.code, "repair fence release was rejected");
          }
        }).immediate();
      } else {
        withLegacySessionMutationAuthority(db, projectKey, applyWithAuthority);
      }

      const completed: SessionMemoryRepairResult = {
        ...prepared,
        status: "completed",
        applied_retractions: appliedRetractions,
      };
      await writeJson(reportPath, completed);
      return completed;
    } catch (error) {
      if (fencedAuthority && inspectProjectSessionMutationFence(db, projectKey)) {
        abandonRepairFence(db, fencedAuthority, generatedAt.toISOString());
      }
      throw error;
    } finally {
      db.close();
    }
  }
}

export function applySessionMemoryRepairCandidatesInOpenTransaction(
  db: Database,
  input: {
    projectKey: string;
    candidates: readonly SessionMemoryRepairCandidate[];
    appliedAt: string;
    authority: ProjectSessionMutationAuthority;
  },
): number {
  const revisionMutation = createSessionMemoryRevisionMutation();
  let appliedRetractions = 0;
  for (const candidate of input.candidates) {
    const current = db
      .query("SELECT * FROM session_memories WHERE id = ? AND project_key = ?")
      .get(candidate.id, input.projectKey) as SessionMemoryRow | null;
    if (!current) throw new Error(`Session Memory missing after repair preview: ${candidate.id}`);
    if (current.status !== "active") {
      throw new Error(`Session Memory is no longer active after repair preview: ${candidate.id}`);
    }
    const currentRefs = parseSourceRefs(current.source_event_refs_json);
    if (sourceRefHash(currentRefs) !== candidate.source_ref_hash) {
      throw new Error(`Session Memory changed after repair preview: ${candidate.id}`);
    }
    if (current.revision !== candidate.revision || current.state_digest !== candidate.state_digest) {
      throw new Error(`Session Memory revision changed after repair preview: ${candidate.id}`);
    }
    retractSessionMemory(db, {
      id: candidate.id,
      projectKey: input.projectKey,
      reason: `repair:${SESSION_MEMORY_REPAIR_POLICY}: control-only evidence cannot support trusted Session Memory`,
      now: input.appliedAt,
    }, input.authority, revisionMutation);
    appliedRetractions += 1;
  }
  advanceSessionMemoryRevisionInOpenTransaction(db, revisionMutation, input.authority);
  return appliedRetractions;
}

function abandonRepairFence(
  db: Database,
  authority: FencedSessionMutationAuthority,
  now: string,
): void {
  const abandoned = transitionProjectSessionMutationFence(db, {
    authority,
    expectedPhase: "running",
    nextPhase: "abandoned",
    now,
  });
  if (abandoned.kind === "updated") {
    releaseProjectSessionMutationFence(db, abandoned.authority);
  }
}

function buildRepairResult(db: Database, projectKey: string, generatedAt: string): SessionMemoryRepairResult {
  const rows = db
    .query("SELECT * FROM session_memories WHERE project_key = ? AND status = 'active' ORDER BY created_at, id")
    .all(projectKey) as SessionMemoryRow[];
  const candidates = rows.flatMap((row) => classifyMemory(db, row));
  return {
    schema_version: 1,
    policy: SESSION_MEMORY_REPAIR_POLICY,
    project_key: projectKey,
    mode: "preview",
    status: "preview",
    generated_at: generatedAt,
    report_path: null,
    proposed_retractions: candidates.length,
    applied_retractions: 0,
    candidates,
  };
}

function classifyMemory(db: Database, row: SessionMemoryRow): SessionMemoryRepairCandidate[] {
  const sourceEventRefs = parseSourceRefs(row.source_event_refs_json);
  if (sourceEventRefs.length === 0) return [];

  const eventKinds: string[] = [];
  for (const sourceEventRef of sourceEventRefs) {
    const tombstone = db
      .query("SELECT source_metadata_json FROM experience_event_tombstones WHERE id = ? AND project_key = ?")
      .get(sourceEventRef, row.project_key) as { source_metadata_json: string } | null;
    if (!tombstone) return [];
    const eventKind = parseEventKind(tombstone.source_metadata_json);
    if (!eventKind) return [];
    eventKinds.push(eventKind);
  }

  const uniqueKinds = [...new Set(eventKinds)].sort();
  const controlOnly = uniqueKinds.every(isSessionMemoryControlEventKind);
  if (!controlOnly) return [];
  return [{
    id: row.id,
    title: row.title,
    summary: row.summary,
    source_event_refs: sourceEventRefs,
    source_ref_hash: sourceRefHash(sourceEventRefs),
    revision: row.revision,
    state_digest: row.state_digest,
    event_kinds: uniqueKinds,
    disposition: "retract",
    reason: "All cited evidence is control-plane lifecycle activity.",
  }];
}

function parseEventKind(sourceMetadataJson: string): string | null {
  try {
    const value = JSON.parse(sourceMetadataJson) as Record<string, unknown>;
    return typeof value.event_kind === "string" && value.event_kind.trim() !== "" ? value.event_kind : null;
  } catch {
    return null;
  }
}

function parseSourceRefs(sourceEventRefsJson: string): string[] {
  try {
    const value = JSON.parse(sourceEventRefsJson) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function sourceRefHash(sourceEventRefs: string[]): string {
  return createHash("sha256").update([...sourceEventRefs].sort().join("\n")).digest("hex");
}
