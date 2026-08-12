import type { Database } from "bun:sqlite";
import type { LeasedExperienceEvent } from "../memory/experience.ts";
import type { EmbeddingProviderClient } from "../memory/embedding-types.ts";
import type { SessionMemoryRow } from "../memory/ingest-types.ts";
import {
  querySessionMemory,
  type SessionMemoryQueryMatch,
  type SessionMemoryQueryVectorStore,
} from "../memory/session-memory-query.ts";
import { listSessionMemoryContexts, type SessionMemoryContextRow } from "../memory/session-memory-contexts.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";

export type ReconciliationMemoryContext = {
  id: string;
  memory_kind: string;
  title: string | null;
  summary: string;
  created_at: string;
  updated_at: string;
  contexts: SessionMemoryContextRow[];
  selection_reasons: string[];
  score: number;
};

export type ReconciliationContextInput = {
  db: Database;
  projectKey: string;
  leased: LeasedExperienceEvent[];
  documentContract?: ActiveEmbeddingContract;
  provider?: EmbeddingProviderClient;
  vectorStore?: SessionMemoryQueryVectorStore;
  limit?: number;
};

export async function selectSessionMemoryReconciliationContext(
  input: ReconciliationContextInput,
): Promise<ReconciliationMemoryContext[]> {
  const limit = input.limit ?? 20;
  const ranked = new Map<string, ReconciliationMemoryContext>();
  const branches = branchSet(input.leased);
  const repoPaths = repoPathSet(input.leased);

  const addRow = (row: SessionMemoryRow, reason: string, score: number): void => {
    const existing = ranked.get(row.id);
    if (existing) {
      existing.score += score;
      if (!existing.selection_reasons.includes(reason)) existing.selection_reasons.push(reason);
      return;
    }
    ranked.set(row.id, {
      id: row.id,
      memory_kind: row.memory_kind,
      title: row.title,
      summary: row.summary,
      created_at: row.created_at,
      updated_at: row.updated_at,
      contexts: listSessionMemoryContexts(input.db, row.id),
      selection_reasons: [reason],
      score,
    });
  };

  if (input.documentContract && input.provider) {
    for (const probe of searchProbes(input.projectKey, input.leased, branches)) {
      const result = await querySessionMemory(input.db, {
        project_key: input.projectKey,
        question: probe,
        document_contract: input.documentContract,
        provider: input.provider,
        limit: 8,
        filters: { status: ["active"] },
        vector_store: input.vectorStore,
      });
      if (result.degraded) continue;
      for (const match of result.matches) {
        addMatch(match, `semantic:${compactReason(probe)}`, Math.max(1, 100 - match.distance * 100), ranked);
      }
    }
  }

  for (const row of activeNextActionMemories(input.db, input.projectKey, 12)) {
    addRow(row, "active_next_action", 45);
  }

  for (const row of recentActiveMemories(input.db, input.projectKey, 12)) {
    addRow(row, "recent", 20);
  }

  for (const branch of branches) {
    for (const row of branchActiveMemories(input.db, input.projectKey, branch, 12)) {
      addRow(row, `branch:${branch}`, 30);
    }
  }

  for (const repoPath of repoPaths) {
    for (const row of repoPathActiveMemories(input.db, input.projectKey, repoPath, 12)) {
      addRow(row, `repo:${repoPath}`, 15);
    }
  }

  return [...ranked.values()]
    .sort((left, right) => right.score - left.score || right.updated_at.localeCompare(left.updated_at))
    .slice(0, limit);
}

function addMatch(
  match: SessionMemoryQueryMatch,
  reason: string,
  score: number,
  ranked: Map<string, ReconciliationMemoryContext>,
): void {
  const existing = ranked.get(match.id);
  if (existing) {
    existing.score += score;
    if (!existing.selection_reasons.includes(reason)) existing.selection_reasons.push(reason);
    return;
  }
  ranked.set(match.id, {
    id: match.id,
    memory_kind: match.memory_kind,
    title: match.title,
    summary: match.summary,
    created_at: match.created_at,
    updated_at: match.updated_at,
    contexts: match.contexts,
    selection_reasons: [reason],
    score,
  });
}

function recentActiveMemories(db: Database, projectKey: string, limit: number): SessionMemoryRow[] {
  return db
    .query(
      `SELECT *
       FROM session_memories
       WHERE project_key = ?
         AND status = 'active'
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(projectKey, limit) as SessionMemoryRow[];
}

function activeNextActionMemories(db: Database, projectKey: string, limit: number): SessionMemoryRow[] {
  return db
    .query(
      `SELECT *
       FROM session_memories
       WHERE project_key = ?
         AND status = 'active'
         AND memory_kind = 'next_action'
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(projectKey, limit) as SessionMemoryRow[];
}

function branchActiveMemories(db: Database, projectKey: string, branch: string, limit: number): SessionMemoryRow[] {
  return db
    .query(
      `SELECT DISTINCT sm.*
       FROM session_memories sm
       JOIN session_memory_contexts c ON c.session_memory_id = sm.id
       WHERE sm.project_key = ?
         AND sm.status = 'active'
         AND c.git_branch = ?
       ORDER BY sm.created_at DESC, sm.id DESC
       LIMIT ?`,
    )
    .all(projectKey, branch, limit) as SessionMemoryRow[];
}

function repoPathActiveMemories(db: Database, projectKey: string, repoPath: string, limit: number): SessionMemoryRow[] {
  return db
    .query(
      `SELECT DISTINCT sm.*
       FROM session_memories sm
       JOIN session_memory_contexts c ON c.session_memory_id = sm.id
       WHERE sm.project_key = ?
         AND sm.status = 'active'
         AND c.repo_path = ?
       ORDER BY sm.created_at DESC, sm.id DESC
       LIMIT ?`,
    )
    .all(projectKey, repoPath, limit) as SessionMemoryRow[];
}

function searchProbes(projectKey: string, leased: LeasedExperienceEvent[], branches: string[]): string[] {
  const text = leased.map((lease) => [lease.prompt_evidence.raw_text, lease.prompt_evidence.raw_payload_json].join(" ")).join(" ");
  const keywords = topKeywords(text, 18).join(" ");
  return [
    keywords,
    `${projectKey} implementation decisions ${keywords}`,
    `${projectKey} blockers changed assumptions ${keywords}`,
    ...branches.map((branch) => `${projectKey} latest work on branch ${branch} ${keywords}`),
  ].filter((probe) => probe.trim().length > 0).slice(0, 4);
}

function topKeywords(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const token of text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
    if (STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function branchSet(leased: LeasedExperienceEvent[]): string[] {
  return uniqueMetadataValues(leased, "git_branch");
}

function repoPathSet(leased: LeasedExperienceEvent[]): string[] {
  return uniqueMetadataValues(leased, "repo_path");
}

function uniqueMetadataValues(leased: LeasedExperienceEvent[], key: "git_branch" | "repo_path"): string[] {
  const values = new Set<string>();
  for (const lease of leased) {
    const metadata = parseMetadata(lease.source_metadata_json);
    const value = metadata[key];
    if (typeof value === "string" && value.trim() !== "") values.add(value);
  }
  return [...values].sort();
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function compactReason(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 77)}...`;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "have",
  "has",
  "was",
  "were",
  "are",
  "not",
  "you",
  "your",
  "but",
  "can",
  "will",
  "would",
  "should",
  "about",
  "there",
  "their",
  "they",
  "then",
  "than",
  "when",
  "what",
  "where",
  "which",
]);
