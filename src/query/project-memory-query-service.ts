import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingProviderClient } from "../memory/embedding-provider.ts";
import { getOrCreateQueryEmbedding } from "../memory/query-embedding-cache.ts";
import { recordMemoryQueryLog } from "../memory/query-logs.ts";
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
  searchProjectMemorySectionFts,
  syncProjectMemorySectionFts,
  type ProjectMemoryFtsMatch,
} from "../memory/project-memory-section-fts.ts";
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
  vector_rank?: number;
  fts_rank?: number;
  bm25_score?: number;
  rrf_score?: number;
  rerank_score?: number;
  rerank_reasons?: string[];
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
  retrieval_debug?: ProjectMemoryRetrievalDebug;
  matches: ProjectMemoryQueryMatch[];
  source_tools: string[];
};

export type ProjectMemoryRetrievalDebug = {
  vector_recall_count: number;
  fts_recall_count: number;
  fused_candidate_count: number;
  rrf_rank_constant: number;
  fts_degraded_reason?: string;
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
    return withProjectQueryLog(db, degraded(input, counts, `sqlite-vec unavailable: ${availability.reason ?? "unknown reason"}`), input);
  }

  if (counts.indexed_count === 0) {
    const reason =
      counts.pending_count > 0
        ? "Project Memory vector index has pending rows; run myelin memory index project"
        : "Project Memory vector index has no indexed rows";
    return withProjectQueryLog(db, degraded(input, counts, reason), input);
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
      limit: vectorRecallLimit(input.limit),
    });
    const manifest = await extractProjectMemorySections(input.root, input.project_key);
    let ftsMatches: ProjectMemoryFtsMatch[] = [];
    let ftsDegradedReason: string | undefined;
    try {
      syncProjectMemorySectionFts(db, {
        project_key: input.project_key,
        contract: input.document_contract,
        sections: manifest.sections,
      });
      ftsMatches = searchProjectMemorySectionFts(db, {
        project_key: input.project_key,
        contract: input.document_contract,
        question: input.question,
        limit: vectorRecallLimit(input.limit),
      });
    } catch (error) {
      ftsDegradedReason = error instanceof Error ? error.message : String(error);
    }
    const candidates = fuseProjectMemoryRetrievalCandidates({
      vectorMatches,
      ftsMatches,
    });
    const matches = rerankProjectMemoryMatches({
      question: input.question,
      matches: await hydrateProjectMemoryMatches(db, input, candidates, manifest.sections),
      limit: input.limit,
    });
    return withProjectQueryLog(db, {
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
      retrieval_debug: {
        vector_recall_count: vectorMatches.length,
        fts_recall_count: ftsMatches.length,
        fused_candidate_count: candidates.length,
        rrf_rank_constant: RRF_RANK_CONSTANT,
        fts_degraded_reason: ftsDegradedReason,
      },
      matches,
      source_tools: [
        "query-embedding-cache",
        "project-memory-vector-index",
        "project-memory-fts-index",
        "reciprocal-rank-fusion",
        "project-memory-markdown-sections",
      ],
    }, input);
  } catch (error) {
    return withProjectQueryLog(db, degraded(input, counts, error instanceof Error ? error.message : String(error)), input);
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
    max_inline_chars: number;
  },
  candidates: ProjectMemoryRetrievalCandidate[],
  sections: ProjectMemoryMarkdownSection[],
): Promise<ProjectMemoryQueryMatch[]> {
  const rowsById = new Map(
    hydrateProjectMemoryRetrievalRows(db, candidates.map((match) => match.retrieval_row_id)).map((row) => [row.id, row]),
  );
  const sectionByKey = new Map(sections.map((section) => [sectionKey(section), section]));
  const matches: ProjectMemoryQueryMatch[] = [];

  for (const candidate of candidates) {
    const row = rowsById.get(candidate.retrieval_row_id);
    if (!row) {
      matches.push(missingRowMatch(candidate));
      continue;
    }
    const section = sectionByKey.get(`${row.wiki_path}#${row.section_id}`);
    if (!section) {
      matches.push(withCandidateSignals(referenceOnlyMatch(row, distanceForCandidate(candidate), "missing_markdown"), candidate));
      continue;
    }
    if (section.section_hash !== row.section_hash) {
      matches.push(withCandidateSignals(referenceOnlyMatch(row, distanceForCandidate(candidate), "stale_hash"), candidate));
      continue;
    }
    if (section.body_text.length > input.max_inline_chars) {
      matches.push(withCandidateSignals(referenceOnlyMatch(row, distanceForCandidate(candidate), "too_large"), candidate));
      continue;
    }
    matches.push(withCandidateSignals({
      retrieval_row_id: row.id,
      wiki_path: row.wiki_path,
      section_id: row.section_id,
      section_hash: row.section_hash,
      heading_path: section.heading_path,
      page_title: section.page_title,
      distance: distanceForCandidate(candidate),
      return_kind: "inline_content",
      content: section.body_text,
      citation: citationFor(row),
    }, candidate));
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

function withProjectQueryLog(
  db: Database,
  result: ProjectMemoryQueryResult,
  input: { now?: () => string },
): ProjectMemoryQueryResult {
  recordMemoryQueryLog(db, {
    layer: "project",
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
  return result;
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

function missingRowMatch(match: ProjectMemoryRetrievalCandidate): ProjectMemoryQueryMatch {
  return withCandidateSignals({
    retrieval_row_id: match.retrieval_row_id,
    wiki_path: "",
    section_id: "",
    section_hash: "",
    heading_path: [],
    page_title: "",
    distance: distanceForCandidate(match),
    return_kind: "reference",
    reference_reason: "missing_markdown",
    citation: `project_memory:${match.retrieval_row_id}`,
  }, match);
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

function vectorRecallLimit(limit: number): number {
  return Math.max(limit * 4, 20);
}

type ProjectMemoryRetrievalCandidate = {
  retrieval_row_id: string;
  distance?: number;
  vector_rank?: number;
  fts_rank?: number;
  bm25_score?: number;
  rrf_score: number;
};

const RRF_RANK_CONSTANT = 60;
const RERANK_RRF_SCALE = 30;

function fuseProjectMemoryRetrievalCandidates(input: {
  vectorMatches: ProjectMemoryRetrievalVectorMatch[];
  ftsMatches: ProjectMemoryFtsMatch[];
}): ProjectMemoryRetrievalCandidate[] {
  const candidates = new Map<string, ProjectMemoryRetrievalCandidate>();
  for (const [index, match] of input.vectorMatches.entries()) {
    const rank = index + 1;
    const candidate = candidates.get(match.retrieval_row_id) ?? {
      retrieval_row_id: match.retrieval_row_id,
      rrf_score: 0,
    };
    candidate.distance = match.distance;
    candidate.vector_rank = rank;
    candidate.rrf_score += reciprocalRankScore(rank);
    candidates.set(match.retrieval_row_id, candidate);
  }
  for (const [index, match] of input.ftsMatches.entries()) {
    const rank = index + 1;
    const candidate = candidates.get(match.retrieval_row_id) ?? {
      retrieval_row_id: match.retrieval_row_id,
      rrf_score: 0,
    };
    candidate.fts_rank = rank;
    candidate.bm25_score = match.bm25_score;
    candidate.rrf_score += reciprocalRankScore(rank);
    candidates.set(match.retrieval_row_id, candidate);
  }
  return Array.from(candidates.values()).sort((left, right) => {
    if (right.rrf_score !== left.rrf_score) return right.rrf_score - left.rrf_score;
    if ((left.vector_rank ?? Infinity) !== (right.vector_rank ?? Infinity)) {
      return (left.vector_rank ?? Infinity) - (right.vector_rank ?? Infinity);
    }
    return (left.fts_rank ?? Infinity) - (right.fts_rank ?? Infinity);
  });
}

function reciprocalRankScore(rank: number): number {
  return 1 / (RRF_RANK_CONSTANT + rank);
}

function distanceForCandidate(candidate: ProjectMemoryRetrievalCandidate): number {
  if (candidate.distance !== undefined && Number.isFinite(candidate.distance)) return candidate.distance;
  return Number((1 - Math.min(0.95, candidate.rrf_score * RERANK_RRF_SCALE)).toFixed(6));
}

function withCandidateSignals<T extends ProjectMemoryQueryMatch>(
  match: T,
  candidate: ProjectMemoryRetrievalCandidate,
): T {
  return {
    ...match,
    vector_rank: candidate.vector_rank,
    fts_rank: candidate.fts_rank,
    bm25_score: candidate.bm25_score,
    rrf_score: Number(candidate.rrf_score.toFixed(6)),
  };
}

function rerankProjectMemoryMatches(input: {
  question: string;
  matches: ProjectMemoryQueryMatch[];
  limit: number;
}): ProjectMemoryQueryMatch[] {
  const queryTokens = tokenSet(input.question);
  return input.matches
    .map((match, originalIndex) => {
      const rerank = projectMemoryRerankScore(match, queryTokens);
      return {
        ...match,
        rerank_score: rerank.score,
        rerank_reasons: rerank.reasons,
        originalIndex,
      };
    })
    .sort((left, right) => {
      if (right.rerank_score !== left.rerank_score) return (right.rerank_score ?? 0) - (left.rerank_score ?? 0);
      return left.originalIndex - right.originalIndex;
    })
    .slice(0, input.limit)
    .map(({ originalIndex: _originalIndex, ...match }) => match);
}

function projectMemoryRerankScore(
  match: ProjectMemoryQueryMatch,
  queryTokens: Set<string>,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score =
    match.rrf_score !== undefined && Number.isFinite(match.rrf_score)
      ? match.rrf_score * RERANK_RRF_SCALE
      : Number.isFinite(match.distance)
        ? 1 - match.distance
        : 0.5;
  if (match.rrf_score !== undefined && Number.isFinite(match.rrf_score)) reasons.push("rrf_base");
  if (match.vector_rank !== undefined && match.fts_rank !== undefined) {
    score += 0.05 / match.vector_rank;
    reasons.push("vector_rank_tiebreak");
    if (Number.isFinite(match.distance)) {
      score += Math.min(0.08, Math.max(0, 1 - match.distance) * 0.2);
      reasons.push("vector_distance_tiebreak");
    }
  }

  score += tokenBoost("section_title_match", queryTokens, tokenSet(lastHeading(match)), 0.04, 0.16, reasons);
  score += tokenBoost("page_title_match", queryTokens, tokenSet(match.page_title), 0.025, 0.1, reasons);
  score += tokenBoost("section_id_match", queryTokens, tokenSet(match.section_id), 0.025, 0.1, reasons);
  score += tokenBoost("path_match", queryTokens, tokenSet(match.wiki_path), 0.02, 0.08, reasons);
  score += tokenBoost("body_match", queryTokens, tokenSet(match.content ?? ""), 0.008, 0.04, reasons);

  const penalty = navigationPenalty(match);
  if (penalty > 0) {
    score -= penalty;
    reasons.push("navigation_penalty");
  }

  return { score: Number(score.toFixed(6)), reasons };
}

function tokenBoost(
  reason: string,
  queryTokens: Set<string>,
  candidateTokens: Set<string>,
  weight: number,
  cap: number,
  reasons: string[],
): number {
  let matches = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) matches += 1;
  }
  if (matches === 0) return 0;
  reasons.push(reason);
  return Math.min(cap, matches * weight);
}

function navigationPenalty(match: ProjectMemoryQueryMatch): number {
  let penalty = 0;
  const heading = normalizeText(lastHeading(match));
  if (match.wiki_path === "wiki/index.md" || match.wiki_path.endsWith("/index.md")) penalty += 0.08;
  if (heading === "documentation subjects" || heading === "known draft gaps") penalty += 0.08;
  if (isMostlyNavigationList(match.content ?? "")) penalty += 0.04;
  return penalty;
}

function isMostlyNavigationList(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return false;
  const navigationLines = lines.filter((line) => /^\d+\.\s+\[.+\]\(.+\)/.test(line) || /^[-*]\s+\[.+\]\(.+\)/.test(line));
  return navigationLines.length / lines.length >= 0.6;
}

function lastHeading(match: ProjectMemoryQueryMatch): string {
  return match.heading_path.at(-1) ?? "";
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(/\s+/)
      .map(stemToken)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stemToken(token: string): string {
  if (token.startsWith("creat")) return "create";
  if (token.startsWith("doc")) return "document";
  if (token.startsWith("quer")) return "query";
  if (token.startsWith("retriev")) return "retrieve";
  if (token.startsWith("index")) return "index";
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

const STOP_WORDS = new Set([
  "about",
  "against",
  "and",
  "are",
  "does",
  "for",
  "from",
  "how",
  "into",
  "memory",
  "project",
  "the",
  "query",
  "this",
  "that",
  "what",
  "when",
  "where",
  "which",
  "wiki",
  "with",
]);
