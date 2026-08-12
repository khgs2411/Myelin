import type { Database } from "bun:sqlite";
import {
  withLegacySessionMutationAuthority,
  type LegacySessionMutationAuthority,
} from "../../src/memory/project-session-mutation-fence.ts";
import {
  createSessionMemory as createSessionMemoryImpl,
  retractSessionMemory as retractSessionMemoryImpl,
  supersedeSessionMemory as supersedeSessionMemoryImpl,
  type CreateSessionMemoryInput,
} from "../../src/memory/session-memories.ts";
import {
  createSessionMemoryContexts as createSessionMemoryContextsImpl,
  type SessionMemoryContextInput,
} from "../../src/memory/session-memory-contexts.ts";
import {
  createSessionMemoryLink as createSessionMemoryLinkImpl,
  type SessionMemoryLinkInput,
} from "../../src/memory/session-memory-links.ts";
import {
  advanceSessionMemoryRevisionInOpenTransaction as advanceSessionMemoryRevisionInOpenTransactionImpl,
  type SessionMemoryRevisionMutation,
} from "../../src/memory/session-memory-revisions.ts";
import {
  applySessionMemoryRepairCandidatesInOpenTransaction as applySessionMemoryRepairCandidatesInOpenTransactionImpl,
} from "../../src/memory/session-memory-repair-service.ts";

export function withSessionMutationAuthority<T>(
  db: Database,
  projectKey: string,
  callback: (authority: LegacySessionMutationAuthority) => T,
): T {
  return withLegacySessionMutationAuthority(db, projectKey, callback);
}

export function createSessionMemory(
  db: Database,
  input: CreateSessionMemoryInput,
  revisionMutation?: SessionMemoryRevisionMutation,
) {
  return withSessionMutationAuthority(db, input.project_key, (authority) =>
    createSessionMemoryImpl(db, input, authority, revisionMutation));
}

export function createSessionMemoryContexts(
  db: Database,
  contexts: SessionMemoryContextInput[],
  revisionMutation?: SessionMemoryRevisionMutation,
): void {
  if (contexts.length === 0) return;
  const projectKey = contexts[0]!.project_key;
  return withSessionMutationAuthority(db, projectKey, (authority) =>
    createSessionMemoryContextsImpl(db, contexts, authority, revisionMutation));
}

export function createSessionMemoryLink(
  db: Database,
  input: SessionMemoryLinkInput,
  revisionMutation?: SessionMemoryRevisionMutation,
) {
  return withSessionMutationAuthority(db, input.project_key, (authority) =>
    createSessionMemoryLinkImpl(db, input, authority, revisionMutation));
}

export function supersedeSessionMemory(
  db: Database,
  input: Parameters<typeof supersedeSessionMemoryImpl>[1],
  revisionMutation?: SessionMemoryRevisionMutation,
) {
  return withSessionMutationAuthority(db, input.projectKey, (authority) =>
    supersedeSessionMemoryImpl(db, input, authority, revisionMutation));
}

export function retractSessionMemory(
  db: Database,
  input: Parameters<typeof retractSessionMemoryImpl>[1],
  revisionMutation?: SessionMemoryRevisionMutation,
) {
  return withSessionMutationAuthority(db, input.projectKey, (authority) =>
    retractSessionMemoryImpl(db, input, authority, revisionMutation));
}

export function applySessionMemoryRepairCandidatesInOpenTransaction(
  db: Database,
  input: Omit<Parameters<typeof applySessionMemoryRepairCandidatesInOpenTransactionImpl>[1], "authority">,
) {
  return withSessionMutationAuthority(db, input.projectKey, (authority) =>
    applySessionMemoryRepairCandidatesInOpenTransactionImpl(db, { ...input, authority }));
}

export function advanceSessionMemoryRevisionInOpenTransaction(
  db: Database,
  mutation: SessionMemoryRevisionMutation,
) {
  const firstMemoryId = mutation.affectedMemoryIds.values().next().value as string | undefined;
  if (!firstMemoryId) return [];
  const row = db.query("SELECT project_key FROM session_memories WHERE id = ?").get(firstMemoryId) as {
    project_key: string;
  } | null;
  if (!row) throw new Error(`Session Memory not found for revision identity: ${firstMemoryId}`);
  return withSessionMutationAuthority(db, row.project_key, (authority) =>
    advanceSessionMemoryRevisionInOpenTransactionImpl(db, mutation, authority));
}
