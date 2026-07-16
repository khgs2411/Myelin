import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { SessionMemoryRow } from "./ingest-types.ts";
import { ensureSessionMemoryVectorStorage } from "./session-memory-embeddings.ts";
import {
  createSqliteVecAdapter,
  searchSessionMemoryVectors,
  type SessionMemoryVectorMatch,
  type SqliteVecAdapter,
} from "./sqlite-vec.ts";
import { getOrCreateQueryEmbedding } from "./query-embedding-cache.ts";
import { recordMemoryQueryLog } from "./query-logs.ts";
import {
  listSessionMemoryContexts,
  sessionMemoryHasBranchContext,
} from "./session-memory-contexts.ts";
import type {
  SessionMemoryQueryFilters,
  SessionMemoryQueryInput,
  SessionMemoryQueryMatch,
  SessionMemoryQueryResult,
  SessionMemoryQueryVectorStore,
} from "./session-memory-query-types.ts";
export type {
  SessionMemoryQueryFilters,
  SessionMemoryQueryInput,
  SessionMemoryQueryMatch,
  SessionMemoryQueryResult,
  SessionMemoryQueryVectorStore,
} from "./session-memory-query-types.ts";

export async function querySessionMemory(
  db: Database,
  input: SessionMemoryQueryInput,
): Promise<SessionMemoryQueryResult> {
  const vectorStore = input.vector_store ?? defaultSessionMemoryQueryVectorStore(
    createSqliteVecAdapter(),
    input.vector_table,
  );
  const counts = indexCounts(db, {
    project_key: input.project_key,
    contract: input.document_contract,
  });

  const availability = vectorStore.ensure(db, { contract: input.document_contract });
  if (!availability.available) {
    return withSessionQueryLog(db, degraded(input, counts, `sqlite-vec unavailable: ${availability.reason ?? "unknown reason"}`), input);
  }

  if (counts.indexed_count === 0) {
    const reason =
      counts.pending_count > 0
        ? "session memory vector index has pending rows; run myelin memory index session"
        : "session memory vector index has no indexed rows";
    return withSessionQueryLog(db, degraded(input, counts, reason), input);
  }

  try {
    const queryContract: ActiveEmbeddingContract = {
      ...input.document_contract,
      purpose: "retrieval_query",
    };
    const queryEmbedding = await getOrCreateQueryEmbedding(db, {
      project_key: input.project_key,
      question: input.question,
      contract: queryContract,
      provider: input.provider,
      now: input.now,
    });
    const matches = vectorStore.search(db, {
      project_key: input.project_key,
      contract: input.document_contract,
      embedding: queryEmbedding.embedding,
      limit: searchLimit(input.limit, input.filters),
    });
    const hydrated = hydrateMatches(db, matches, input.filters);
    const recencyIntent = hasRecencyIntent(input.question);
    return withSessionQueryLog(db, {
      project_key: input.project_key,
      question: input.question,
      degraded: false,
      indexed_count: counts.indexed_count,
      pending_count: counts.pending_count,
      query_embedding_cache_hit: queryEmbedding.cache_hit,
      query_embedding_cache_id: queryEmbedding.cache_id,
      normalized_question: queryEmbedding.normalized_question,
      matches: (recencyIntent ? rerankForRecency(hydrated) : hydrated).slice(0, input.limit),
      source_tools: [
        "query-embedding-cache",
        "session-memory-vector-index",
        ...(recencyIntent ? ["session-memory-recency-rerank"] : []),
      ],
    }, input);
  } catch (error) {
    return withSessionQueryLog(db, degraded(input, counts, error instanceof Error ? error.message : String(error)), input);
  }
}

export function defaultSessionMemoryQueryVectorStore(
  adapter: SqliteVecAdapter = createSqliteVecAdapter(),
  vectorTable = "session_memory_vec",
): SessionMemoryQueryVectorStore {
  return {
    ensure(db, input) {
      return ensureSessionMemoryVectorStorage(db, {
        contract: input.contract,
        adapter,
        vector_table: vectorTable,
      });
    },
    search(db, input) {
      return searchSessionMemoryVectors(db, {
        project_key: input.project_key,
        embedding_model: input.contract.model,
        embedding_dimensions: input.contract.dimensions,
        embedding_purpose: input.contract.purpose,
        format_version: input.contract.formatVersion,
        embedding: input.embedding,
        limit: input.limit,
      }, vectorTable);
    },
  };
}

function indexCounts(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
  },
): { indexed_count: number; pending_count: number } {
  const row = db
    .query(
      `SELECT
         sum(CASE WHEN e.status = 'indexed' THEN 1 ELSE 0 END) AS indexed_count,
         sum(CASE WHEN e.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
       FROM session_memory_embeddings e
       JOIN session_memories sm ON sm.id = e.session_memory_id
       WHERE e.project_key = ?
         AND sm.status = 'active'
         AND e.embedding_provider = ?
         AND e.embedding_model = ?
         AND e.embedding_dimensions = ?
         AND e.embedding_purpose = ?
         AND e.format_version = ?`,
    )
    .get(
      input.project_key,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.purpose,
      input.contract.formatVersion,
    ) as { indexed_count: number | null; pending_count: number | null };
  return {
    indexed_count: row.indexed_count ?? 0,
    pending_count: row.pending_count ?? 0,
  };
}

function degraded(
  input: {
    project_key: string;
    question: string;
  },
  counts: { indexed_count: number; pending_count: number },
  reason: string,
): SessionMemoryQueryResult {
  return {
    project_key: input.project_key,
    question: input.question,
    degraded: true,
    degraded_reason: reason,
    indexed_count: counts.indexed_count,
    pending_count: counts.pending_count,
    matches: [],
    source_tools: ["query-embedding-cache", "session-memory-vector-index"],
  };
}

function withSessionQueryLog(
  db: Database,
  result: SessionMemoryQueryResult,
  input: { now?: () => string },
): SessionMemoryQueryResult {
  const queryLogId = recordMemoryQueryLog(db, {
    layer: "session",
    project_key: result.project_key,
    question: result.question,
    normalized_question: result.normalized_question,
    query_embedding_cache_id: result.query_embedding_cache_id,
    result,
    match_count: result.matches.length,
    degraded: result.degraded,
    degraded_reason: result.degraded_reason,
    now: input.now,
  });
  return { ...result, query_log_id: queryLogId };
}

function hydrateMatches(
  db: Database,
  matches: SessionMemoryVectorMatch[],
  filters?: SessionMemoryQueryFilters,
): SessionMemoryQueryMatch[] {
  const hydrated: SessionMemoryQueryMatch[] = [];
  for (const match of matches) {
    const row = db.query("SELECT * FROM session_memories WHERE id = ?").get(match.memory_id) as
      | SessionMemoryRow
      | null;
    if (!row) continue;
    const allowedStatuses = filters?.status ?? ["active"];
    if (!allowedStatuses.includes(row.status)) continue;
    if (filters?.memory_kind && !filters.memory_kind.includes(row.memory_kind)) continue;
    if (filters?.git_branch && !sessionMemoryHasBranchContext(db, { sessionMemoryId: row.id, gitBranch: filters.git_branch })) {
      continue;
    }
    hydrated.push({
      id: row.id,
      memory_kind: row.memory_kind,
      title: row.title,
      summary: row.summary,
      payload: parseJsonObject(row.payload_json),
      source_event_refs: parseJsonArray(row.source_event_refs_json),
      contexts: listSessionMemoryContexts(db, row.id),
      created_at: row.created_at,
      updated_at: row.updated_at,
      distance: match.distance,
    });
  }
  return hydrated;
}

function searchLimit(limit: number, filters?: SessionMemoryQueryFilters): number {
  return (filters?.memory_kind && filters.memory_kind.length > 0) || filters?.git_branch || (filters?.status ?? ["active"]).length > 0
    ? limit * 10
    : limit;
}

function hasRecencyIntent(question: string): boolean {
  return /\b(most recent|recently|recent work|latest|newest|last session|last work)\b/i.test(question);
}

function rerankForRecency(matches: SessionMemoryQueryMatch[]): SessionMemoryQueryMatch[] {
  return [...matches]
    .map((match, semanticRank) => ({ match, semanticRank }))
    .sort((left, right) =>
      right.match.created_at.localeCompare(left.match.created_at) || left.semanticRank - right.semanticRank
    )
    .map(({ match }) => match);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function parseJsonArray(text: string): string[] {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}
