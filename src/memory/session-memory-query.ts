import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingProviderClient } from "./embedding-provider.ts";
import type { SessionMemoryKind, SessionMemoryRow, SessionMemoryStatus } from "./ingest-types.ts";
import { ensureSessionMemoryVectorStorage } from "./session-memory-embeddings.ts";
import {
  createSqliteVecAdapter,
  searchSessionMemoryVectors,
  type SessionMemoryVectorMatch,
  type SqliteVecAdapter,
} from "./sqlite-vec.ts";
import { getOrCreateQueryEmbedding } from "./query-embedding-cache.ts";
import {
  listSessionMemoryContexts,
  sessionMemoryHasBranchContext,
  type SessionMemoryContextRow,
} from "./session-memory-contexts.ts";

export type SessionMemoryQueryFilters = {
  memory_kind?: SessionMemoryKind[];
  git_branch?: string;
  status?: SessionMemoryStatus[];
};

export type SessionMemoryQueryMatch = {
  id: string;
  memory_kind: SessionMemoryKind;
  title: string | null;
  summary: string;
  payload: Record<string, unknown>;
  source_event_refs: string[];
  contexts: SessionMemoryContextRow[];
  created_at: string;
  updated_at: string;
  distance: number;
};

export type SessionMemoryQueryResult = {
  project_key: string;
  question: string;
  degraded: boolean;
  degraded_reason?: string;
  indexed_count: number;
  pending_count: number;
  query_embedding_cache_hit?: boolean;
  query_embedding_cache_id?: string;
  normalized_question?: string;
  matches: SessionMemoryQueryMatch[];
  source_tools: string[];
};

export type SessionMemoryQueryVectorStore = {
  ensure: (
    db: Database,
    input: { contract: ActiveEmbeddingContract },
  ) => { available: boolean; reason?: string };
  search: (
    db: Database,
    input: {
      project_key: string;
      contract: ActiveEmbeddingContract;
      embedding: number[];
      limit: number;
    },
  ) => SessionMemoryVectorMatch[];
};

export async function querySessionMemory(
  db: Database,
  input: {
    project_key: string;
    question: string;
    document_contract: ActiveEmbeddingContract;
    provider: EmbeddingProviderClient;
    limit: number;
    filters?: SessionMemoryQueryFilters;
    vector_store?: SessionMemoryQueryVectorStore;
    now?: () => string;
  },
): Promise<SessionMemoryQueryResult> {
  const vectorStore = input.vector_store ?? defaultSessionMemoryQueryVectorStore(createSqliteVecAdapter());
  const counts = indexCounts(db, {
    project_key: input.project_key,
    contract: input.document_contract,
  });

  const availability = vectorStore.ensure(db, { contract: input.document_contract });
  if (!availability.available) {
    return degraded(input, counts, `sqlite-vec unavailable: ${availability.reason ?? "unknown reason"}`);
  }

  if (counts.indexed_count === 0) {
    const reason =
      counts.pending_count > 0
        ? "session memory vector index has pending rows; run myelin memory index session"
        : "session memory vector index has no indexed rows";
    return degraded(input, counts, reason);
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
    return {
      project_key: input.project_key,
      question: input.question,
      degraded: false,
      indexed_count: counts.indexed_count,
      pending_count: counts.pending_count,
      query_embedding_cache_hit: queryEmbedding.cache_hit,
      query_embedding_cache_id: queryEmbedding.cache_id,
      normalized_question: queryEmbedding.normalized_question,
      matches: hydrateMatches(db, matches, input.filters).slice(0, input.limit),
      source_tools: ["query-embedding-cache", "session-memory-vector-index"],
    };
  } catch (error) {
    return degraded(input, counts, error instanceof Error ? error.message : String(error));
  }
}

export function defaultSessionMemoryQueryVectorStore(
  adapter: SqliteVecAdapter = createSqliteVecAdapter(),
): SessionMemoryQueryVectorStore {
  return {
    ensure(db, input) {
      return ensureSessionMemoryVectorStorage(db, {
        contract: input.contract,
        adapter,
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
      });
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
