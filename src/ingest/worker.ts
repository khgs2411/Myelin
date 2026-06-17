import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { JsonObject, ProcessRunner } from "../runtime/llm-client.ts";
import { invokeLlm } from "../runtime/llm-client.ts";
import type { LeasedExperienceEvent } from "../memory/experience.ts";
import {
  finalizeLeasedExperienceEventsInOpenTransaction,
  finalizeRemainingLeasedExperienceEvents,
  leaseExperienceEvents,
} from "../memory/experience.ts";
import { openMemoryDb } from "../memory/db.ts";
import { createMemoryCandidate } from "../memory/candidates.ts";
import { createHandoffInstruction } from "../memory/handoffs.ts";
import {
  HANDOFF_SCOPES,
  MEMORY_SCOPES,
  SESSION_MEMORY_KINDS,
  SESSION_MEMORY_LINK_RELATIONSHIPS,
  type HandoffScope,
  type MemoryScope,
  type SessionMemoryLinkRelationship,
  type SessionMemoryKind,
} from "../memory/ingest-types.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { createSessionMemoryLink } from "../memory/session-memory-links.ts";
import {
  createSessionMemory,
  getActiveSessionMemory,
  retractSessionMemory,
  supersedeSessionMemory,
} from "../memory/session-memories.ts";
import {
  createSessionMemoryContexts,
  type SessionMemoryContextInput,
} from "../memory/session-memory-contexts.ts";
import { loadConfig, selectActiveEmbeddingContract } from "../runtime/config.ts";
import {
  selectSessionMemoryReconciliationContext,
  type ReconciliationMemoryContext,
} from "./reconciliation-context.ts";
import { updateIngestJobStatus } from "./jobs.ts";

const MAX_PROMPT_RETAINED_EVIDENCE_CHARS = 6_000;
const TRUNCATED_EVIDENCE_SUFFIX = "\n...[truncated for ingest prompt; full evidence is preserved in the tombstone audit row]";

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
  memory_supersessions?: Array<{
    superseded_memory_id: string;
    superseding_memory_id: string;
    relationship: SessionMemoryLinkRelationship;
    reason: string;
    source_event_refs: string[];
  }>;
  memory_retractions?: Array<{
    memory_id: string;
    reason: string;
    source_event_refs: string[];
  }>;
  memory_noops?: Array<{
    memory_id: string;
    reason: string;
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
  if (value.memory_supersessions !== undefined) {
    output.memory_supersessions = validateArray(value.memory_supersessions, "memory_supersessions").map((raw, index) => {
      const path = `memory_supersessions[${index}]`;
      const supersession = validateObject(raw, path);
      return {
        superseded_memory_id: validateString(supersession.superseded_memory_id, `${path}.superseded_memory_id`),
        superseding_memory_id: validateString(supersession.superseding_memory_id, `${path}.superseding_memory_id`),
        relationship: validateEnum(supersession.relationship ?? "supersedes", `${path}.relationship`, SESSION_MEMORY_LINK_RELATIONSHIPS),
        reason: validateString(supersession.reason, `${path}.reason`),
        source_event_refs: validateNonEmptyStringArray(supersession.source_event_refs, `${path}.source_event_refs`),
      };
    });
  }
  if (value.memory_retractions !== undefined) {
    output.memory_retractions = validateArray(value.memory_retractions, "memory_retractions").map((raw, index) => {
      const path = `memory_retractions[${index}]`;
      const retraction = validateObject(raw, path);
      return {
        memory_id: validateString(retraction.memory_id, `${path}.memory_id`),
        reason: validateString(retraction.reason, `${path}.reason`),
        source_event_refs: validateNonEmptyStringArray(retraction.source_event_refs, `${path}.source_event_refs`),
      };
    });
  }
  if (value.memory_noops !== undefined) {
    output.memory_noops = validateArray(value.memory_noops, "memory_noops").map((raw, index) => {
      const path = `memory_noops[${index}]`;
      const noop = validateObject(raw, path);
      return {
        memory_id: validateString(noop.memory_id, `${path}.memory_id`),
        reason: validateString(noop.reason, `${path}.reason`),
      };
    });
  }
  if (value.no_output_tombstone_ids !== undefined) {
    output.no_output_tombstone_ids = validateStringArray(value.no_output_tombstone_ids, "no_output_tombstone_ids");
  }
  if (value.terminal_summary !== undefined) {
    output.terminal_summary = validateOptionalNonEmptyString(value.terminal_summary, "terminal_summary");
  }
  return output;
}

export function buildIngestPrompt(input: {
  projectKey: string;
  jobId: string;
  leased: LeasedExperienceEvent[];
  reconciliationContext?: ReconciliationMemoryContext[];
  batchIndex?: number;
  batchCount?: number;
}): string {
  return [
    "You are the Myelin Session Memory ingest agent.",
    `Project key: ${input.projectKey}`,
    `Ingest job id: ${input.jobId}`,
    input.batchIndex && input.batchCount
      ? `Parallel batch: ${input.batchIndex} of ${input.batchCount}. Other ingest agents may be running for this project.`
      : null,
    "",
    "You are running from the target repository cwd. Use repo context when deciding what memory matters.",
    "Create only low-risk trusted Session Memory directly.",
    "Create Session Memory candidates for ambiguous, risky, conflicting, or privacy-sensitive outputs.",
    "Create Project/Practice/Personal handoff instructions only as one-hop downstream inputs.",
    "Do not mutate curated wiki pages.",
    "Return JSON only with keys: session_memories, memory_candidates, handoff_instructions, memory_supersessions, memory_retractions, memory_noops, no_output_tombstone_ids, terminal_summary.",
    "Return empty arrays for output categories with no items.",
    "Every session memory, memory candidate, and handoff instruction must include source_event_refs containing leased tombstone ids.",
    "Reconcile existing active Session Memory when new evidence makes old memory stale.",
    "Do not physically delete memory. To update an existing memory, create a replacement session memory and add a memory_supersessions operation.",
    "You may only supersede, retract, or noop existing memories listed in Existing active Session Memory context.",
    "Every memory_supersessions item must include: superseded_memory_id, superseding_memory_id, relationship, reason, source_event_refs.",
    "Allowed memory_supersessions relationship values: supersedes, refines, contradicts, duplicates.",
    "Every memory_retractions item must include: memory_id, reason, source_event_refs.",
    "Use memory_retractions only when the old memory should no longer be trusted and no replacement memory is created.",
    "Use memory_noops for supplied existing memory that is relevant and remains current.",
    "Allowed session memory memory_kind values: continuity, decision, blocker, next_action, verification.",
    "Allowed memory candidate scope values: session, project, practice, personal.",
    "Allowed handoff target_scope values: project, practice, personal.",
    "Allowed provider-created status values for candidates and handoffs: pending, needs_review.",
    "Every memory candidate must include: id, source_event_refs, scope, status, candidate_type, summary, evidence, proposed_payload, confidence, risk, reason.",
    "Use candidate_type as a stable dotted classifier, for example session.continuity, project.decision, practice.workflow, or personal.preference.",
    "Every handoff instruction must include: id, target_scope, status, objective, prompt_text, source_session_memory_ids, source_event_refs, suggested_actions, reason, confidence, risk.",
    "Example session memory: {\"id\":\"mem_<short-id>\",\"source_event_refs\":[\"tomb_<claimed-id>\"],\"memory_kind\":\"continuity\",\"summary\":\"Useful continuity.\",\"payload\":{},\"confidence\":\"high\",\"risk\":\"low\"}.",
    "Example supersession: {\"superseded_memory_id\":\"mem_old\",\"superseding_memory_id\":\"mem_new\",\"relationship\":\"supersedes\",\"reason\":\"New evidence changes the implementation truth.\",\"source_event_refs\":[\"tomb_<claimed-id>\"]}.",
    "Example retraction: {\"memory_id\":\"mem_old\",\"reason\":\"New evidence shows this memory is false and no replacement is appropriate.\",\"source_event_refs\":[\"tomb_<claimed-id>\"]}.",
    "Example memory candidate: {\"id\":\"cand_<short-id>\",\"source_event_refs\":[\"tomb_<claimed-id>\"],\"scope\":\"session\",\"status\":\"needs_review\",\"candidate_type\":\"session.continuity\",\"summary\":\"Possible useful continuity.\",\"evidence\":{},\"proposed_payload\":{},\"confidence\":\"medium\",\"risk\":\"medium\",\"reason\":\"Needs review before trust\"}.",
    "Example handoff instruction: {\"id\":\"handoff_<short-id>\",\"target_scope\":\"project\",\"status\":\"pending\",\"objective\":\"Verify a durable project fact\",\"prompt_text\":\"Review the cited tombstones and update project memory if valid.\",\"source_session_memory_ids\":[],\"source_event_refs\":[\"tomb_<claimed-id>\"],\"suggested_actions\":[\"review evidence\"],\"reason\":\"May belong in project memory\",\"confidence\":\"medium\",\"risk\":\"medium\"}.",
    "",
    "Existing active Session Memory context:",
    JSON.stringify((input.reconciliationContext ?? []).map(memoryForPrompt), null, 2),
    "",
    "Leased Experience Log rows:",
    JSON.stringify(input.leased.map(leaseForPrompt), null, 2),
  ].filter((line) => line !== null).join("\n");
}

function memoryForPrompt(memory: ReconciliationMemoryContext): JsonObject {
  return {
    id: memory.id,
    memory_kind: memory.memory_kind,
    title: memory.title,
    summary: memory.summary,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    selection_reasons: memory.selection_reasons,
    contexts: memory.contexts.map((context) => ({
      repo_path: context.repo_path,
      git_branch: context.git_branch,
      git_commit: context.git_commit,
      git_worktree_id: context.git_worktree_id,
      source_event_ref: context.source_event_ref,
    })),
  };
}

function leaseForPrompt(lease: LeasedExperienceEvent): JsonObject {
  const evidence = JSON.stringify(lease.prompt_evidence);
  const promptEvidence =
    evidence.length <= MAX_PROMPT_RETAINED_EVIDENCE_CHARS
      ? lease.prompt_evidence
      : {
          raw_text: lease.prompt_evidence.raw_text,
          raw_payload_json: `${lease.prompt_evidence.raw_payload_json.slice(0, MAX_PROMPT_RETAINED_EVIDENCE_CHARS)}${TRUNCATED_EVIDENCE_SUFFIX}`,
        };
  return {
    id: lease.id,
    original_event_id: lease.original_event_id,
    project_key: lease.project_key,
    ingest_job_id: lease.ingest_job_id,
    provider: lease.provider,
    provider_session_id: lease.provider_session_id,
    claimed_at: lease.claimed_at,
    state: lease.state,
    source_metadata_json: lease.source_metadata_json,
    prompt_evidence: promptEvidence,
  };
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

function validateOptionalNonEmptyString(value: unknown, _path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  return undefined;
}

function validateStringArray(value: unknown, path: string): string[] {
  if (typeof value === "string" && value.trim() !== "") return [value];
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
    allowedExistingMemoryIds?: string[];
  },
): { session_memories: number; memory_candidates: number; handoff_instructions: number } {
  const apply = db.transaction(() => {
    let sessionMemories = 0;
    let memoryCandidates = 0;
    let handoffs = 0;
    const outputRefsByTombstone = new Map<string, string[]>();
    const sessionMemoryIds = new Map<string, string>();
    const claimableTombstoneIds = new Set(
      (
        db.query("SELECT id FROM experience_event_tombstones WHERE ingest_job_id = ? AND state = 'claimed'").all(input.jobId) as
          Array<{ id: string }>
      ).map((row) => row.id),
    );

    const claimableRefs = (tombstoneIds: string[]) => tombstoneIds.filter((id) => claimableTombstoneIds.has(id));
    const allowedExistingMemoryIds = input.allowedExistingMemoryIds ? new Set(input.allowedExistingMemoryIds) : null;

    const addOutputRefs = (tombstoneIds: string[], outputRef: string): string[] => {
      if (tombstoneIds.length === 0) throw new Error(`Output ${outputRef} must reference at least one tombstone`);
      const validTombstoneIds = claimableRefs(tombstoneIds);
      if (validTombstoneIds.length === 0) return [];
      for (const tombstoneId of validTombstoneIds) {
        const refs = outputRefsByTombstone.get(tombstoneId) ?? [];
        refs.push(outputRef);
        outputRefsByTombstone.set(tombstoneId, refs);
      }
      return validTombstoneIds;
    };

    for (const memory of input.output.session_memories ?? []) {
      const memoryId = uniqueOutputId(db, "session_memories", memory.id, input.jobId);
      const sourceEventRefs = addOutputRefs(memory.source_event_refs, `session_memories/${memoryId}`);
      if (sourceEventRefs.length === 0) continue;
      createSessionMemory(db, {
        id: memoryId,
        project_key: input.projectKey,
        provider: input.provider,
        provider_session_id: input.providerSessionId,
        ingest_job_id: input.jobId,
        source_event_refs: sourceEventRefs,
        memory_kind: memory.memory_kind,
        title: memory.title ?? null,
        summary: memory.summary,
        payload: memory.payload,
        confidence: memory.confidence,
        risk: memory.risk,
        now: input.finalizedAt,
      });
      createSessionMemoryContexts(db, contextsForSessionMemory(db, {
        sessionMemoryId: memoryId,
        projectKey: input.projectKey,
        sourceEventRefs,
      }));
      sessionMemoryIds.set(memory.id, memoryId);
      sessionMemories += 1;
    }

    const activeAllowedExistingMemory = (memoryId: string): boolean => {
      if (allowedExistingMemoryIds && !allowedExistingMemoryIds.has(memoryId)) {
        throw new Error(`Reconciliation operation references memory outside supplied context: ${memoryId}`);
      }
      const memory = getActiveSessionMemory(db, { id: memoryId, projectKey: input.projectKey });
      return Boolean(memory);
    };

    for (const supersession of input.output.memory_supersessions ?? []) {
      if (!activeAllowedExistingMemory(supersession.superseded_memory_id)) continue;
      const supersedingMemoryId = sessionMemoryIds.get(supersession.superseding_memory_id) ?? supersession.superseding_memory_id;
      const supersedingMemory = getActiveSessionMemory(db, { id: supersedingMemoryId, projectKey: input.projectKey });
      if (!supersedingMemory) {
        throw new Error(`Supersession replacement memory is missing or inactive: ${supersession.superseding_memory_id}`);
      }
      const sourceEventRefs = addOutputRefs(
        supersession.source_event_refs,
        `session_memory_links/${supersession.superseded_memory_id}/${supersedingMemoryId}`,
      );
      if (sourceEventRefs.length === 0) continue;
      supersedeSessionMemory(db, {
        id: supersession.superseded_memory_id,
        projectKey: input.projectKey,
        supersededBy: supersedingMemoryId,
        reason: supersession.reason,
        now: input.finalizedAt,
      });
      createSessionMemoryLink(db, {
        source_memory_id: supersedingMemoryId,
        target_memory_id: supersession.superseded_memory_id,
        project_key: input.projectKey,
        relationship: supersession.relationship,
        reason: supersession.reason,
        source_event_refs: sourceEventRefs,
        created_at: input.finalizedAt,
      });
    }

    for (const retraction of input.output.memory_retractions ?? []) {
      if (!activeAllowedExistingMemory(retraction.memory_id)) continue;
      const sourceEventRefs = addOutputRefs(
        retraction.source_event_refs,
        `session_memory_retractions/${retraction.memory_id}`,
      );
      if (sourceEventRefs.length === 0) continue;
      retractSessionMemory(db, {
        id: retraction.memory_id,
        projectKey: input.projectKey,
        reason: retraction.reason,
        now: input.finalizedAt,
      });
    }

    for (const noop of input.output.memory_noops ?? []) {
      activeAllowedExistingMemory(noop.memory_id);
    }

    for (const candidate of input.output.memory_candidates ?? []) {
      const candidateId = uniqueOutputId(db, "memory_candidates", candidate.id, input.jobId);
      const sourceEventRefs = addOutputRefs(candidate.source_event_refs, `memory_candidates/${candidateId}`);
      if (sourceEventRefs.length === 0) continue;
      createMemoryCandidate(db, {
        id: candidateId,
        project_key: input.projectKey,
        scope: candidate.scope,
        status: candidate.status,
        candidate_type: candidate.candidate_type,
        title: candidate.title ?? null,
        summary: candidate.summary,
        source_event_refs: sourceEventRefs,
        evidence: candidate.evidence,
        proposed_payload: candidate.proposed_payload,
        confidence: candidate.confidence,
        risk: candidate.risk,
        reason: candidate.reason,
        now: input.finalizedAt,
      });
      memoryCandidates += 1;
    }

    for (const handoff of input.output.handoff_instructions ?? []) {
      const table = `${handoff.target_scope}_handoff_instructions`;
      const handoffId = uniqueOutputId(db, table, handoff.id, input.jobId);
      const sourceEventRefs = addOutputRefs(
        handoff.source_event_refs,
        `${table}/${handoffId}`,
      );
      if (sourceEventRefs.length === 0) continue;
      createHandoffInstruction(db, {
        id: handoffId,
        target_scope: handoff.target_scope,
        project_key: input.projectKey,
        status: handoff.status,
        objective: handoff.objective,
        prompt_text: handoff.prompt_text,
        source_session_memory_ids: handoff.source_session_memory_ids.map((id) => sessionMemoryIds.get(id) ?? id),
        source_event_refs: sourceEventRefs,
        suggested_actions: handoff.suggested_actions,
        reason: handoff.reason,
        confidence: handoff.confidence,
        risk: handoff.risk,
        now: input.finalizedAt,
      });
      handoffs += 1;
    }

    for (const [tombstoneId, outputRefs] of outputRefsByTombstone.entries()) {
      finalizeLeasedExperienceEventsInOpenTransaction(db, {
        ingest_job_id: input.jobId,
        tombstone_ids: [tombstoneId],
        finalized_at: input.finalizedAt,
        state: "output",
        terminal_decision: "output",
        output_references: [...new Set(outputRefs)],
      });
    }

    for (const tombstoneId of claimableRefs(input.output.no_output_tombstone_ids ?? [])) {
      if (outputRefsByTombstone.has(tombstoneId)) {
        continue;
      }
      finalizeLeasedExperienceEventsInOpenTransaction(db, {
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

function uniqueOutputId(db: Database, table: string, desiredId: string, jobId: string): string {
  if (!db.query(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`).get(desiredId)) return desiredId;
  const base = `${jobId}_${desiredId}`;
  let candidate = base;
  let suffix = 2;
  while (db.query(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`).get(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function contextsForSessionMemory(
  db: Database,
  input: { sessionMemoryId: string; projectKey: string; sourceEventRefs: string[] },
): SessionMemoryContextInput[] {
  const contexts: SessionMemoryContextInput[] = [];
  const query = db.query(
    "SELECT source_metadata_json FROM experience_event_tombstones WHERE id = ? AND project_key = ?",
  );
  for (const sourceEventRef of input.sourceEventRefs) {
    const row = query.get(sourceEventRef, input.projectKey) as { source_metadata_json: string } | null;
    const metadata = parseContextMetadata(row?.source_metadata_json);
    contexts.push({
      session_memory_id: input.sessionMemoryId,
      project_key: input.projectKey,
      repo_path: metadata.repo_path,
      git_branch: metadata.git_branch,
      git_commit: metadata.git_commit,
      git_worktree_id: metadata.git_worktree_id,
      source_event_ref: sourceEventRef,
    });
  }
  return contexts;
}

function parseContextMetadata(value: string | undefined): {
  repo_path: string | null;
  git_branch: string | null;
  git_commit: string | null;
  git_worktree_id: string | null;
} {
  if (!value) return { repo_path: null, git_branch: null, git_commit: null, git_worktree_id: null };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      repo_path: typeof parsed.repo_path === "string" ? parsed.repo_path : null,
      git_branch: typeof parsed.git_branch === "string" ? parsed.git_branch : null,
      git_commit: typeof parsed.git_commit === "string" ? parsed.git_commit : null,
      git_worktree_id: typeof parsed.git_worktree_id === "string" ? parsed.git_worktree_id : null,
    };
  } catch {
    return { repo_path: null, git_branch: null, git_commit: null, git_worktree_id: null };
  }
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
  batchIndex?: number;
  batchCount?: number;
  maxPromptChars?: number;
  now?: () => Date;
  runner?: ProcessRunner;
}): Promise<void> {
  const db = openMemoryDb(input.root);
  const config = await loadConfig(input.root);
  const embeddingContract = selectActiveEmbeddingContract(config, "retrieval_document");
  const embeddingProvider = new EmbeddingProviderFactory(config).create();
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
      const leased = leaseExperienceEvents(db, {
        ingest_job_id: input.jobId,
        project_key: input.projectKey,
        provider_session_id: input.providerSessionId ?? null,
        limit: remaining,
        max_prompt_chars: input.maxPromptChars ?? config.ingest.promptCharLimit,
        prompt_chars_for_lease: (lease) => JSON.stringify(leaseForPrompt(lease), null, 2).length,
        claimed_at: claimedAt,
        tombstone_id_for: (event) => `tomb_${input.jobId}_${event.id}`,
      });
      if (leased.length === 0) break;
      claimedCount += leased.length;
      const reconciliationContext = await selectSessionMemoryReconciliationContext({
        db,
        projectKey: input.projectKey,
        leased,
        documentContract: embeddingContract,
        provider: embeddingProvider,
      });

      const response = await invokeLlm({
        root: input.root,
        workload: "ingest",
        provider: input.provider,
        timeoutMs: config.ingest.llmTimeoutMs,
        outputSchema: join(input.root, "src", "ingest", "worker-output.schema.json"),
        prompt: buildIngestPrompt({
          projectKey: input.projectKey,
          jobId: input.jobId,
          leased,
          reconciliationContext,
          batchIndex: input.batchIndex,
          batchCount: input.batchCount,
        }),
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
        allowedExistingMemoryIds: reconciliationContext.map((memory) => memory.id),
      });
      terminalSummary = output.terminal_summary ?? terminalSummary;
      sessionMemories += counts.session_memories;
      memoryCandidates += counts.memory_candidates;
      handoffs += counts.handoff_instructions;
    }

    const finalized = finalizeRemainingLeasedExperienceEvents(db, {
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
      error: null,
    });
  } catch (error) {
    updateIngestJobStatus(db, {
      id: input.jobId,
      status: "failed",
      finished_at: now().toISOString(),
      updated_at: now().toISOString(),
      error: { message: compactIngestWorkerError(error), retryable: true },
    });
    throw error;
  } finally {
    db.close();
  }
}

function compactIngestWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.length <= 4_000) return message;

  const importantLines = message
    .split(/\r?\n/)
    .filter((line) => /\b(error|failed|exited|limit|quota|denied|unauthorized|forbidden)\b/i.test(line.trim()))
    .slice(-12);
  const compact = importantLines.length > 0 ? importantLines.join("\n") : message.slice(-2_000);
  return `${compact.slice(0, 4_000)}\n...[truncated provider error]`;
}
