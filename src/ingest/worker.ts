import type { Database } from "bun:sqlite";
import type { JsonObject, ProcessRunner } from "../runtime/llm-client.ts";
import { invokeLlm } from "../runtime/llm-client.ts";
import type { ClaimedExperienceTombstone } from "../memory/experience.ts";
import {
  claimExperienceEvents,
  finalizeClaimedExperienceEventsInOpenTransaction,
  finalizeRemainingClaimedExperienceEvents,
} from "../memory/experience.ts";
import { openMemoryDb } from "../memory/db.ts";
import { createMemoryCandidate } from "../memory/candidates.ts";
import { createHandoffInstruction } from "../memory/handoffs.ts";
import {
  HANDOFF_SCOPES,
  MEMORY_SCOPES,
  SESSION_MEMORY_KINDS,
  type HandoffScope,
  type MemoryScope,
  type SessionMemoryKind,
} from "../memory/ingest-types.ts";
import { createSessionMemory } from "../memory/session-memories.ts";
import { updateIngestJobStatus } from "./jobs.ts";

export type IngestWorkerOutput = {
  session_memories?: Array<{
    id: string;
    source_event_refs: string[];
    memory_kind: SessionMemoryKind;
    title?: string | null;
    summary: string;
    payload: JsonObject;
    confidence: string;
    risk: string;
  }>;
  memory_candidates?: Array<{
    id: string;
    source_event_refs: string[];
    scope: MemoryScope;
    status: "pending" | "needs_review";
    candidate_type: string;
    title?: string | null;
    summary: string;
    evidence: JsonObject;
    proposed_payload: JsonObject;
    confidence: string;
    risk: string;
    reason: string;
  }>;
  handoff_instructions?: Array<{
    id: string;
    target_scope: HandoffScope;
    status: "pending" | "needs_review";
    objective: string;
    prompt_text: string;
    source_session_memory_ids: string[];
    source_event_refs: string[];
    suggested_actions: string[];
    reason: string;
    confidence: string;
    risk: string;
  }>;
  no_output_tombstone_ids?: string[];
  terminal_summary?: string;
};

export function parseIngestWorkerOutput(value: JsonObject): IngestWorkerOutput {
  const output: IngestWorkerOutput = {};
  if (value.session_memories !== undefined) {
    output.session_memories = validateArray(value.session_memories, "session_memories").map((raw, index) => {
      const path = `session_memories[${index}]`;
      const memory = validateObject(raw, path);
      return {
        id: validateString(memory.id, `${path}.id`),
        source_event_refs: validateNonEmptyStringArray(memory.source_event_refs, `${path}.source_event_refs`),
        memory_kind: validateEnum(memory.memory_kind, `${path}.memory_kind`, SESSION_MEMORY_KINDS),
        title: validateOptionalStringOrNull(memory.title, `${path}.title`),
        summary: validateString(memory.summary, `${path}.summary`),
        payload: validateObject(memory.payload, `${path}.payload`),
        confidence: validateString(memory.confidence, `${path}.confidence`),
        risk: validateString(memory.risk, `${path}.risk`),
      };
    });
  }
  if (value.memory_candidates !== undefined) {
    output.memory_candidates = validateArray(value.memory_candidates, "memory_candidates").map((raw, index) => {
      const path = `memory_candidates[${index}]`;
      const candidate = validateObject(raw, path);
      return {
        id: validateString(candidate.id, `${path}.id`),
        source_event_refs: validateNonEmptyStringArray(candidate.source_event_refs, `${path}.source_event_refs`),
        scope: validateEnum(candidate.scope, `${path}.scope`, MEMORY_SCOPES),
        status: validateEnum(candidate.status, `${path}.status`, ["pending", "needs_review"] as const),
        candidate_type: validateString(candidate.candidate_type, `${path}.candidate_type`),
        title: validateOptionalStringOrNull(candidate.title, `${path}.title`),
        summary: validateString(candidate.summary, `${path}.summary`),
        evidence: validateObject(candidate.evidence, `${path}.evidence`),
        proposed_payload: validateObject(candidate.proposed_payload, `${path}.proposed_payload`),
        confidence: validateString(candidate.confidence, `${path}.confidence`),
        risk: validateString(candidate.risk, `${path}.risk`),
        reason: validateString(candidate.reason, `${path}.reason`),
      };
    });
  }
  if (value.handoff_instructions !== undefined) {
    output.handoff_instructions = validateArray(value.handoff_instructions, "handoff_instructions").map((raw, index) => {
      const path = `handoff_instructions[${index}]`;
      const handoff = validateObject(raw, path);
      return {
        id: validateString(handoff.id, `${path}.id`),
        target_scope: validateEnum(handoff.target_scope, `${path}.target_scope`, HANDOFF_SCOPES),
        status: validateEnum(handoff.status, `${path}.status`, ["pending", "needs_review"] as const),
        objective: validateString(handoff.objective, `${path}.objective`),
        prompt_text: validateString(handoff.prompt_text, `${path}.prompt_text`),
        source_session_memory_ids: validateStringArray(handoff.source_session_memory_ids, `${path}.source_session_memory_ids`),
        source_event_refs: validateNonEmptyStringArray(handoff.source_event_refs, `${path}.source_event_refs`),
        suggested_actions: validateStringArray(handoff.suggested_actions, `${path}.suggested_actions`),
        reason: validateString(handoff.reason, `${path}.reason`),
        confidence: validateString(handoff.confidence, `${path}.confidence`),
        risk: validateString(handoff.risk, `${path}.risk`),
      };
    });
  }
  if (value.no_output_tombstone_ids !== undefined) {
    output.no_output_tombstone_ids = validateStringArray(value.no_output_tombstone_ids, "no_output_tombstone_ids");
  }
  if (value.terminal_summary !== undefined) {
    output.terminal_summary = validateString(value.terminal_summary, "terminal_summary");
  }
  return output;
}

export function buildIngestPrompt(input: {
  projectKey: string;
  jobId: string;
  claimed: ClaimedExperienceTombstone[];
}): string {
  return [
    "You are the Myelin Session Memory ingest agent.",
    `Project key: ${input.projectKey}`,
    `Ingest job id: ${input.jobId}`,
    "",
    "You are running from the target repository cwd. Use repo context when deciding what memory matters.",
    "Create only low-risk trusted Session Memory directly.",
    "Create Session Memory candidates for ambiguous, risky, conflicting, or privacy-sensitive outputs.",
    "Create Project/Practice/Personal handoff instructions only as one-hop downstream inputs.",
    "Do not mutate curated wiki pages.",
    "Return JSON only with keys: session_memories, memory_candidates, handoff_instructions, no_output_tombstone_ids, terminal_summary.",
    "Every session memory, memory candidate, and handoff instruction must include source_event_refs containing claimed tombstone ids.",
    "Allowed session memory memory_kind values: continuity, decision, blocker, next_action, verification.",
    "Allowed memory candidate scope values: session, project, practice, personal.",
    "Allowed handoff target_scope values: project, practice, personal.",
    "Allowed provider-created status values for candidates and handoffs: pending, needs_review.",
    "Example session memory: {\"id\":\"mem_<short-id>\",\"source_event_refs\":[\"tomb_<claimed-id>\"],\"memory_kind\":\"continuity\",\"summary\":\"Useful continuity.\",\"payload\":{},\"confidence\":\"high\",\"risk\":\"low\"}.",
    "",
    "Claimed Experience Log tombstones:",
    JSON.stringify(input.claimed, null, 2),
  ].join("\n");
}

function validateArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`IngestWorkerOutput contract violation: ${path} must be an array`);
}

function validateObject(value: unknown, path: string): JsonObject {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  throw new Error(`IngestWorkerOutput contract violation: ${path} must be an object`);
}

function validateString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new Error(`IngestWorkerOutput contract violation: ${path} must be a non-empty string`);
}

function validateOptionalStringOrNull(value: unknown, path: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return value;
  throw new Error(`IngestWorkerOutput contract violation: ${path} must be a string or null`);
}

function validateStringArray(value: unknown, path: string): string[] {
  const items = validateArray(value, path);
  for (let index = 0; index < items.length; index += 1) {
    validateString(items[index], `${path}[${index}]`);
  }
  return items as string[];
}

function validateNonEmptyStringArray(value: unknown, path: string): string[] {
  const items = validateStringArray(value, path);
  if (items.length > 0) return items;
  throw new Error(`IngestWorkerOutput contract violation: ${path} must contain at least one tombstone id`);
}

function validateEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(
    `IngestWorkerOutput contract violation: ${path} must be one of ${allowed.join(", ")}`,
  );
}

export function applyIngestWorkerOutput(
  db: Database,
  input: {
    projectKey: string;
    jobId: string;
    provider: string;
    providerSessionId: string | null;
    output: IngestWorkerOutput;
    finalizedAt: string;
  },
): { session_memories: number; memory_candidates: number; handoff_instructions: number } {
  const apply = db.transaction(() => {
    let sessionMemories = 0;
    let memoryCandidates = 0;
    let handoffs = 0;
    const outputRefsByTombstone = new Map<string, string[]>();

    const addOutputRefs = (tombstoneIds: string[], outputRef: string) => {
      if (tombstoneIds.length === 0) throw new Error(`Output ${outputRef} must reference at least one tombstone`);
      for (const tombstoneId of tombstoneIds) {
        const refs = outputRefsByTombstone.get(tombstoneId) ?? [];
        refs.push(outputRef);
        outputRefsByTombstone.set(tombstoneId, refs);
      }
    };

    for (const memory of input.output.session_memories ?? []) {
      createSessionMemory(db, {
        id: memory.id,
        project_key: input.projectKey,
        provider: input.provider,
        provider_session_id: input.providerSessionId,
        ingest_job_id: input.jobId,
        source_event_refs: memory.source_event_refs,
        memory_kind: memory.memory_kind,
        title: memory.title ?? null,
        summary: memory.summary,
        payload: memory.payload,
        confidence: memory.confidence,
        risk: memory.risk,
        now: input.finalizedAt,
      });
      addOutputRefs(memory.source_event_refs, `session_memories/${memory.id}`);
      sessionMemories += 1;
    }

    for (const candidate of input.output.memory_candidates ?? []) {
      createMemoryCandidate(db, {
        id: candidate.id,
        project_key: input.projectKey,
        scope: candidate.scope,
        status: candidate.status,
        candidate_type: candidate.candidate_type,
        title: candidate.title ?? null,
        summary: candidate.summary,
        source_event_refs: candidate.source_event_refs,
        evidence: candidate.evidence,
        proposed_payload: candidate.proposed_payload,
        confidence: candidate.confidence,
        risk: candidate.risk,
        reason: candidate.reason,
        now: input.finalizedAt,
      });
      addOutputRefs(candidate.source_event_refs, `memory_candidates/${candidate.id}`);
      memoryCandidates += 1;
    }

    for (const handoff of input.output.handoff_instructions ?? []) {
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
      addOutputRefs(handoff.source_event_refs, `${handoff.target_scope}_handoff_instructions/${handoff.id}`);
      handoffs += 1;
    }

    for (const [tombstoneId, outputRefs] of outputRefsByTombstone.entries()) {
      finalizeClaimedExperienceEventsInOpenTransaction(db, {
        ingest_job_id: input.jobId,
        tombstone_ids: [tombstoneId],
        finalized_at: input.finalizedAt,
        state: "output",
        terminal_decision: "output",
        output_references: [...new Set(outputRefs)],
      });
    }

    for (const tombstoneId of input.output.no_output_tombstone_ids ?? []) {
      if (outputRefsByTombstone.has(tombstoneId)) {
        throw new Error(`Tombstone ${tombstoneId} cannot be both output and no_output`);
      }
      finalizeClaimedExperienceEventsInOpenTransaction(db, {
        ingest_job_id: input.jobId,
        tombstone_ids: [tombstoneId],
        finalized_at: input.finalizedAt,
        state: "no_output",
        terminal_decision: "no_output",
        output_references: [],
      });
    }

    return { session_memories: sessionMemories, memory_candidates: memoryCandidates, handoff_instructions: handoffs };
  });

  return apply();
}

export async function runIngestWorker(input: {
  root: string;
  projectKey: string;
  jobId: string;
  targetRepo: string;
  provider: "codex" | "claude";
  providerSessionId?: string | null;
  limit?: number;
  batchSize?: number;
  now?: () => Date;
  runner?: ProcessRunner;
}): Promise<void> {
  const db = openMemoryDb(input.root);
  const now = input.now ?? (() => new Date());
  let claimedCount = 0;
  let sessionMemories = 0;
  let memoryCandidates = 0;
  let handoffs = 0;
  let terminalSummary: string | null = null;

  try {
    updateIngestJobStatus(db, {
      id: input.jobId,
      status: "running",
      started_at: now().toISOString(),
      updated_at: now().toISOString(),
      provider_session_id: input.providerSessionId ?? null,
    });

    while (input.limit === undefined || claimedCount < input.limit) {
      const remaining =
        input.limit === undefined ? (input.batchSize ?? 50) : Math.min(input.batchSize ?? 50, input.limit - claimedCount);
      if (remaining <= 0) break;

      const claimedAt = now().toISOString();
      const claimed = claimExperienceEvents(db, {
        ingest_job_id: input.jobId,
        project_key: input.projectKey,
        provider_session_id: input.providerSessionId ?? null,
        limit: remaining,
        claimed_at: claimedAt,
        tombstone_id_for: (event) => `tomb_${input.jobId}_${event.id}`,
      });
      if (claimed.length === 0) break;
      claimedCount += claimed.length;

      const response = await invokeLlm({
        root: input.root,
        workload: "pipeline",
        provider: input.provider,
        prompt: buildIngestPrompt({ projectKey: input.projectKey, jobId: input.jobId, claimed }),
        cwd: input.targetRepo,
        runner: input.runner,
      });
      const output = parseIngestWorkerOutput(response.response);
      const counts = applyIngestWorkerOutput(db, {
        projectKey: input.projectKey,
        jobId: input.jobId,
        provider: input.provider,
        providerSessionId: input.providerSessionId ?? null,
        output,
        finalizedAt: now().toISOString(),
      });
      terminalSummary = output.terminal_summary ?? terminalSummary;
      sessionMemories += counts.session_memories;
      memoryCandidates += counts.memory_candidates;
      handoffs += counts.handoff_instructions;
    }

    const finalized = finalizeRemainingClaimedExperienceEvents(db, {
      ingest_job_id: input.jobId,
      finalized_at: now().toISOString(),
      state: "no_output",
      terminal_decision: "no_output",
    });
    updateIngestJobStatus(db, {
      id: input.jobId,
      status: "completed",
      finished_at: now().toISOString(),
      updated_at: now().toISOString(),
      output_counts: {
        claimed: claimedCount,
        auto_no_output: finalized,
        session_memories: sessionMemories,
        memory_candidates: memoryCandidates,
        handoff_instructions: handoffs,
      },
      terminal_summary: terminalSummary,
    });
  } catch (error) {
    finalizeRemainingClaimedExperienceEvents(db, {
      ingest_job_id: input.jobId,
      finalized_at: now().toISOString(),
      state: "failed",
      terminal_decision: "provider_failed",
    });
    updateIngestJobStatus(db, {
      id: input.jobId,
      status: "failed",
      finished_at: now().toISOString(),
      updated_at: now().toISOString(),
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  } finally {
    db.close();
  }
}
