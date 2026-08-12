import type { Database } from "bun:sqlite";
import { createMemoryCandidate } from "../memory/candidates.ts";
import { createHandoffInstruction } from "../memory/handoffs.ts";
import { finalizeLeasedExperienceEventsInOpenTransaction } from "../memory/experience.ts";
import { createSessionMemoryContexts, type SessionMemoryContextInput } from "../memory/session-memory-contexts.ts";
import { createSessionMemoryLink } from "../memory/session-memory-links.ts";
import { createSessionMemory, retractSessionMemory, supersedeSessionMemory } from "../memory/session-memories.ts";
import {
  advanceSessionMemoryRevisionInOpenTransaction,
  createSessionMemoryRevisionMutation,
} from "../memory/session-memory-revisions.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { ProjectSessionMutationAuthority } from "../memory/project-session-mutation-fence.ts";
import type { SessionMaintenanceOutput, SessionMaintenanceProjection } from "./output-contract.ts";
import { readAuditInheritedSourceRefs } from "./audit-provenance.ts";

export type SessionMaintenanceCommitCounts = {
  session_memories: number;
  rejected_session_memories: number;
  memory_candidates: number;
  project_memory_candidates: number;
  handoff_instructions: number;
};

function applyTrustedProjectionPayloadInOpenTransaction(
  db: Database,
  input: {
    projectKey: string;
    jobId: string;
    provider: string;
    providerSessionId: string | null;
    output: SessionMaintenanceOutput;
    finalizedAt: string;
    activeMemoryIds: readonly string[];
    embeddingContract?: ActiveEmbeddingContract;
    authority: ProjectSessionMutationAuthority;
    finalizeSourceEvents?: boolean;
    additionalAllowedSourceRefs?: readonly string[];
  },
): SessionMaintenanceCommitCounts {
  preflightOutputIds(db, input.output);
  const revisionMutation = createSessionMemoryRevisionMutation();
  const activeMemoryIds = new Set(input.activeMemoryIds);
  const claimedIds = new Set(
    (db
      .query("SELECT id, original_event_id FROM experience_event_tombstones WHERE ingest_job_id = ? AND state = 'claimed'")
      .all(input.jobId) as Array<{ id: string; original_event_id: string }>).map((row) =>
        input.finalizeSourceEvents === false ? row.original_event_id : row.id),
  );
  const allowedSourceRefs = new Set([...claimedIds, ...(input.additionalAllowedSourceRefs ?? [])]);

  for (const memory of input.output.session_memories) {
    assertClaimedRefs(memory.source_event_refs, allowedSourceRefs, `session_memories/${memory.id}`);
  }
  for (const candidate of input.output.memory_candidates) {
    assertClaimedRefs(candidate.source_event_refs, allowedSourceRefs, `memory_candidates/${candidate.id}`);
  }
  for (const handoff of input.output.handoff_instructions) {
    assertClaimedRefs(handoff.source_event_refs, allowedSourceRefs, `handoff_instructions/${handoff.id}`);
  }
  for (const disposition of input.output.memory_dispositions) {
    if (!activeMemoryIds.has(disposition.memory_id)) {
      throw new Error(`Session maintenance lifecycle target is outside the active snapshot: ${disposition.memory_id}`);
    }
    assertClaimedRefs(disposition.source_event_refs, allowedSourceRefs, `memory_dispositions/${disposition.memory_id}`);
  }

  for (const memory of input.output.session_memories) {
    createSessionMemory(db, {
      id: memory.id,
      project_key: input.projectKey,
      provider: input.provider,
      provider_session_id: input.providerSessionId,
      ingest_job_id: input.jobId,
      source_event_refs: memory.source_event_refs,
      memory_kind: memory.memory_kind,
      title: memory.title,
      summary: memory.summary,
      payload: memory.payload,
      confidence: memory.confidence,
      risk: memory.risk,
      now: input.finalizedAt,
      embedding_contract: input.embeddingContract,
    }, input.authority, revisionMutation);
    createSessionMemoryContexts(db, contextsForSessionMemory(db, {
      sessionMemoryId: memory.id,
      projectKey: input.projectKey,
      sourceEventRefs: memory.source_event_refs,
    }, input.jobId), input.authority, revisionMutation);
  }

  for (const disposition of input.output.memory_dispositions) {
    if (disposition.disposition === "keep") continue;
    if (disposition.disposition === "retract") {
      retractSessionMemory(db, {
        id: disposition.memory_id,
        projectKey: input.projectKey,
        reason: disposition.reason,
        now: input.finalizedAt,
      }, input.authority, revisionMutation);
      continue;
    }
    supersedeSessionMemory(db, {
      id: disposition.memory_id,
      projectKey: input.projectKey,
      supersededBy: disposition.replacement_memory_id,
      reason: disposition.reason,
      now: input.finalizedAt,
    }, input.authority, revisionMutation);
    createSessionMemoryLink(db, {
      source_memory_id: disposition.replacement_memory_id,
      target_memory_id: disposition.memory_id,
      project_key: input.projectKey,
      relationship: disposition.relationship,
      reason: disposition.reason,
      source_event_refs: disposition.source_event_refs,
      created_at: input.finalizedAt,
    }, input.authority, revisionMutation);
  }

  let projectMemoryCandidates = 0;
  for (const candidate of input.output.memory_candidates) {
    createMemoryCandidate(db, {
      id: candidate.id,
      project_key: input.projectKey,
      scope: candidate.scope,
      status: candidate.status,
      candidate_type: candidate.candidate_type,
      title: candidate.title,
      summary: candidate.summary,
      source_event_refs: candidate.source_event_refs,
      evidence: candidate.evidence,
      proposed_payload: candidate.proposed_payload,
      confidence: candidate.confidence,
      risk: candidate.risk,
      reason: candidate.reason,
      now: input.finalizedAt,
    });
    if (candidate.scope === "project") projectMemoryCandidates += 1;
  }

  for (const handoff of input.output.handoff_instructions) {
    createHandoffInstruction(db, {
      id: handoff.id,
      target_scope: handoff.target_scope,
      project_key: input.projectKey,
      status: handoff.status,
      objective: handoff.objective,
      prompt_text: handoff.prompt_text,
      source_session_memory_ids: handoff.source_session_memory_ids,
      source_event_refs: handoff.source_event_refs,
      suggested_actions: handoff.suggested_actions,
      reason: handoff.reason,
      confidence: handoff.confidence,
      risk: handoff.risk,
      now: input.finalizedAt,
    });
  }

  if (input.finalizeSourceEvents !== false) {
    for (const disposition of input.output.source_event_dispositions) {
      if (!claimedIds.has(disposition.source_event_id)) {
        throw new Error(`Session maintenance source disposition is outside the selected lease: ${disposition.source_event_id}`);
      }
      finalizeLeasedExperienceEventsInOpenTransaction(db, {
        ingest_job_id: input.jobId,
        tombstone_ids: [disposition.source_event_id],
        finalized_at: input.finalizedAt,
        state: disposition.disposition === "used" ? "output" : "no_output",
        terminal_decision: disposition.disposition,
        output_references: disposition.disposition === "used" ? disposition.output_refs : [],
      });
    }
  }

  advanceSessionMemoryRevisionInOpenTransaction(db, revisionMutation, input.authority);

  return {
    session_memories: input.output.session_memories.length,
    rejected_session_memories: 0,
    memory_candidates: input.output.memory_candidates.length,
    project_memory_candidates: projectMemoryCandidates,
    handoff_instructions: input.output.handoff_instructions.length,
  };
}

export function applySessionMaintenanceProjectionInOpenTransaction(
  db: Database,
  input: Omit<Parameters<typeof applyTrustedProjectionPayloadInOpenTransaction>[1], "output" | "activeMemoryIds" | "finalizeSourceEvents"> & {
    projection: SessionMaintenanceProjection;
  },
): SessionMaintenanceCommitCounts {
  return applyTrustedProjectionPayloadInOpenTransaction(db, {
    ...input,
    output: {
      schema_version: 1,
      session_memories: input.projection.session_memories,
      memory_candidates: input.projection.memory_candidates,
      handoff_instructions: input.projection.handoff_instructions,
      memory_dispositions: input.projection.memory_dispositions.map(({ revision_identity: _revision, work_kind: _kind, ...item }) => item),
      source_event_dispositions: input.projection.source_event_dispositions,
      terminal_summary: null,
    },
    activeMemoryIds: input.projection.memory_dispositions.map((item) => item.memory_id),
    finalizeSourceEvents: false,
    additionalAllowedSourceRefs: [...readAuditInheritedSourceRefs(db, input.jobId)],
  });
}

function preflightOutputIds(db: Database, output: SessionMaintenanceOutput): void {
  assertAvailable(db, "session_memories", output.session_memories.map((item) => item.id));
  assertAvailable(db, "memory_candidates", output.memory_candidates.map((item) => item.id));
  for (const scope of ["project", "practice", "personal"] as const) {
    assertAvailable(
      db,
      `${scope}_handoff_instructions`,
      output.handoff_instructions.filter((item) => item.target_scope === scope).map((item) => item.id),
    );
  }
}

function assertAvailable(db: Database, table: string, ids: readonly string[]): void {
  for (const id of ids) {
    if (db.query(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`).get(id)) {
      throw new Error(`Session maintenance output id already exists in ${table}: ${id}`);
    }
  }
}

function assertClaimedRefs(refs: readonly string[], claimedIds: ReadonlySet<string>, outputRef: string): void {
  for (const ref of refs) {
    if (!claimedIds.has(ref)) throw new Error(`${outputRef} references an unclaimed source event: ${ref}`);
  }
}

function contextsForSessionMemory(
  db: Database,
  input: { sessionMemoryId: string; projectKey: string; sourceEventRefs: string[] },
  jobId?: string,
): SessionMemoryContextInput[] {
  const query = db.query(
    `SELECT source_metadata_json FROM experience_event_tombstones
     WHERE project_key = ? AND (id = ? OR original_event_id = ?)`,
  );
  return input.sourceEventRefs.map((sourceEventRef) => {
    const row = query.get(input.projectKey, sourceEventRef, sourceEventRef) as { source_metadata_json: string } | null;
    const frozen = row || !jobId ? null : db.query(
      `SELECT repo_path, git_branch, git_commit, git_worktree_id
       FROM smc_memory_snapshot_contexts
       WHERE job_id = ? AND source_event_ref = ? ORDER BY ordinal LIMIT 1`,
    ).get(jobId, sourceEventRef) as {
      repo_path: string | null; git_branch: string | null; git_commit: string | null; git_worktree_id: string | null;
    } | null;
    const metadata = row ? parseMetadata(row.source_metadata_json) : (frozen ?? {});
    return {
      session_memory_id: input.sessionMemoryId,
      project_key: input.projectKey,
      repo_path: stringOrNull(metadata.repo_path),
      git_branch: stringOrNull(metadata.git_branch),
      git_commit: stringOrNull(metadata.git_commit),
      git_worktree_id: stringOrNull(metadata.git_worktree_id),
      source_event_ref: sourceEventRef,
    };
  });
}

function parseMetadata(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
