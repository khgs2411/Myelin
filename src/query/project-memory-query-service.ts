import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingProviderClient } from "../memory/embedding-provider.ts";
import { getOrCreateQueryEmbedding } from "../memory/query-embedding-cache.ts";
import {
  createSqliteVecAdapter,
  ensureProjectMemoryRetrievalVectorTable,
  searchProjectMemoryRetrievalVectors,
  type ProjectMemoryRetrievalVectorMatch,
  type SqliteVecAdapter,
} from "../memory/sqlite-vec.ts";
import {
  hydrateProjectMemoryRetrievalRows,
  type ProjectMemoryRetrievalEmbeddingRow,
} from "../memory/project-memory-retrieval-storage.ts";
import {
  extractProjectMemorySections,
  type ProjectMemoryMarkdownSection,
} from "../project/project-memory-markdown-sections.ts";

export type ProjectMemoryQueryMatch = {
  retrieval_row_id: string;
  wiki_path: string;
  section_id: string;
  section_hash: string;
  heading_path: string[];
  page_title: string;
  distance: number;
  return_kind: "inline_content" | "reference";
  content?: string;
  reference_reason?: "too_large" | "stale_hash" | "missing_markdown" | "degraded";
  citation: string;
};

export type ProjectMemoryQueryResult = {
  project_key: string;
  question: string;
  degraded: boolean;
  degraded_reason?: string;
  indexed_count: number;
  pending_count: number;
  match_count: number;
  query_embedding_cache_hit?: boolean;
  query_embedding_cache_id?: string;
  normalized_question?: string;
  matches: ProjectMemoryQueryMatch[];
  source_tools: string[];
};

export type ProjectMemoryQueryVectorStore = {
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
  ) => ProjectMemoryRetrievalVectorMatch[];
};

export async function queryProjectMemory(
  db: Database,
  input: {
    root: string;
    project_key: string;
    question: string;
    document_contract: ActiveEmbeddingContract;
    provider: EmbeddingProviderClient;
    limit: number;
    max_inline_chars: number;
    vector_store?: ProjectMemoryQueryVectorStore;
    now?: () => string;
  },
): Promise<ProjectMemoryQueryResult> {
  const vectorStore = input.vector_store ?? defaultProjectMemoryQueryVectorStore(createSqliteVecAdapter());
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
        ? "Project Memory vector index has pending rows; run myelin memory index project"
        : "Project Memory vector index has no indexed rows";
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
    const vectorMatches = vectorStore.search(db, {
      project_key: input.project_key,
      contract: input.document_contract,
      embedding: queryEmbedding.embedding,
      limit: input.limit,
    });
    const matches = await hydrateProjectMemoryMatches(db, input, vectorMatches);
    return {
      project_key: input.project_key,
      question: input.question,
      degraded: matches.some((match) => match.reference_reason === "stale_hash" || match.reference_reason === "missing_markdown"),
      degraded_reason: degradedReasonForMatches(matches),
      indexed_count: counts.indexed_count,
      pending_count: counts.pending_count,
      match_count: matches.length,
      query_embedding_cache_hit: queryEmbedding.cache_hit,
      query_embedding_cache_id: queryEmbedding.cache_id,
      normalized_question: queryEmbedding.normalized_question,
      matches,
      source_tools: ["query-embedding-cache", "project-memory-vector-index", "project-memory-markdown-sections"],
    };
  } catch (error) {
    return degraded(input, counts, error instanceof Error ? error.message : String(error));
  }
}

export function defaultProjectMemoryQueryVectorStore(
  adapter: SqliteVecAdapter = createSqliteVecAdapter(),
): ProjectMemoryQueryVectorStore {
  return {
    ensure(db, input) {
      return ensureProjectMemoryRetrievalVectorTable(db, {
        dimensions: input.contract.dimensions,
        adapter,
      });
    },
    search(db, input) {
      return searchProjectMemoryRetrievalVectors(db, {
        project_key: input.project_key,
        embedding_model: input.contract.model,
        embedding_dimensions: input.contract.dimensions,
        embedding_purpose: "retrieval_document",
        format_version: input.contract.formatVersion,
        embedding: input.embedding,
        limit: input.limit,
      });
    },
  };
}

async function hydrateProjectMemoryMatches(
  db: Database,
  input: {
    root: string;
    project_key: string;
    max_inline_chars: number;
  },
  vectorMatches: ProjectMemoryRetrievalVectorMatch[],
): Promise<ProjectMemoryQueryMatch[]> {
  const rowsById = new Map(
    hydrateProjectMemoryRetrievalRows(db, vectorMatches.map((match) => match.retrieval_row_id)).map((row) => [row.id, row]),
  );
  const manifest = await extractProjectMemorySections(input.root, input.project_key);
  const sectionByKey = new Map(manifest.sections.map((section) => [sectionKey(section), section]));
  const matches: ProjectMemoryQueryMatch[] = [];

  for (const vectorMatch of vectorMatches) {
    const row = rowsById.get(vectorMatch.retrieval_row_id);
    if (!row) {
      matches.push(missingRowMatch(vectorMatch));
      continue;
    }
    const section = sectionByKey.get(`${row.wiki_path}#${row.section_id}`);
    if (!section) {
      matches.push(referenceOnlyMatch(row, vectorMatch.distance, "missing_markdown"));
      continue;
    }
    if (section.section_hash !== row.section_hash) {
      matches.push(referenceOnlyMatch(row, vectorMatch.distance, "stale_hash"));
      continue;
    }
    if (section.body_text.length > input.max_inline_chars) {
      matches.push(referenceOnlyMatch(row, vectorMatch.distance, "too_large"));
      continue;
    }
    matches.push({
      retrieval_row_id: row.id,
      wiki_path: row.wiki_path,
      section_id: row.section_id,
      section_hash: row.section_hash,
      heading_path: section.heading_path,
      page_title: section.page_title,
      distance: vectorMatch.distance,
      return_kind: "inline_content",
      content: section.body_text,
      citation: citationFor(row),
    });
  }
  return matches;
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
         sum(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexed_count,
         sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
       FROM project_memory_retrieval_embeddings
       WHERE project_key = ?
         AND embedding_provider = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = 'retrieval_document'
         AND format_version = ?`,
    )
    .get(
      input.project_key,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.formatVersion,
    ) as { indexed_count: number | null; pending_count: number | null };
  return {
    indexed_count: row.indexed_count ?? 0,
    pending_count: row.pending_count ?? 0,
  };
}

function degraded(
  input: { project_key: string; question: string },
  counts: { indexed_count: number; pending_count: number },
  reason: string,
): ProjectMemoryQueryResult {
  return {
    project_key: input.project_key,
    question: input.question,
    degraded: true,
    degraded_reason: reason,
    indexed_count: counts.indexed_count,
    pending_count: counts.pending_count,
    match_count: 0,
    matches: [],
    source_tools: ["query-embedding-cache", "project-memory-vector-index"],
  };
}

function referenceOnlyMatch(
  row: ProjectMemoryRetrievalEmbeddingRow,
  distance: number,
  reason: "too_large" | "stale_hash" | "missing_markdown" | "degraded",
): ProjectMemoryQueryMatch {
  return {
    retrieval_row_id: row.id,
    wiki_path: row.wiki_path,
    section_id: row.section_id,
    section_hash: row.section_hash,
    heading_path: [],
    page_title: "",
    distance,
    return_kind: "reference",
    reference_reason: reason,
    citation: citationFor(row),
  };
}

function missingRowMatch(match: ProjectMemoryRetrievalVectorMatch): ProjectMemoryQueryMatch {
  return {
    retrieval_row_id: match.retrieval_row_id,
    wiki_path: "",
    section_id: "",
    section_hash: "",
    heading_path: [],
    page_title: "",
    distance: match.distance,
    return_kind: "reference",
    reference_reason: "missing_markdown",
    citation: `project_memory:${match.retrieval_row_id}`,
  };
}

function degradedReasonForMatches(matches: ProjectMemoryQueryMatch[]): string | undefined {
  if (matches.some((match) => match.reference_reason === "stale_hash")) return "one or more Project Memory retrieval hits are stale";
  if (matches.some((match) => match.reference_reason === "missing_markdown")) return "one or more Project Memory retrieval hits are missing canonical markdown";
  return undefined;
}

function sectionKey(section: ProjectMemoryMarkdownSection): string {
  return `${section.wiki_path}#${section.section_id}`;
}

function citationFor(row: Pick<ProjectMemoryRetrievalEmbeddingRow, "wiki_path" | "section_id">): string {
  return `project_memory:${row.wiki_path}#${row.section_id}`;
}
