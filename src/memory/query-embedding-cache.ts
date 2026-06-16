import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingProviderClient } from "./embedding-provider.ts";

export type QueryEmbeddingCacheResult = {
  embedding: number[];
  normalized_question: string;
  cache_hit: boolean;
  cache_id: string;
};

type QueryEmbeddingCacheRow = {
  id: string;
  embedding_json: string;
};

export async function getOrCreateQueryEmbedding(
  db: Database,
  input: {
    project_key: string;
    question: string;
    contract: ActiveEmbeddingContract;
    provider: EmbeddingProviderClient;
    now?: () => string;
  },
): Promise<QueryEmbeddingCacheResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const normalizedQuestion = normalizeQueryQuestion(input.question);
  if (!normalizedQuestion) throw new Error("Query question must not be empty");

  const cached = getCachedQueryEmbedding(db, {
    project_key: input.project_key,
    normalized_question: normalizedQuestion,
    contract: input.contract,
  });
  if (cached) {
    const embedding = parseEmbedding(cached.embedding_json);
    assertDimensions(input.contract.dimensions, embedding.length);
    markQueryEmbeddingCacheHit(db, { id: cached.id, now: now() });
    return {
      embedding,
      normalized_question: normalizedQuestion,
      cache_hit: true,
      cache_id: cached.id,
    };
  }

  const result = await input.provider.embed({
    contract: input.contract,
    text: input.question,
  });
  assertDimensions(input.contract.dimensions, result.dimensions);
  const timestamp = now();
  const id = queryEmbeddingCacheId({
    project_key: input.project_key,
    normalized_question: normalizedQuestion,
    contract: input.contract,
  });
  db.query(
    `INSERT INTO query_embedding_cache
      (id, project_key, original_question, normalized_question, embedding_provider, embedding_model,
       embedding_dimensions, embedding_purpose, format_version, embedding_json, hit_count,
       created_at, updated_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(project_key, normalized_question, embedding_provider, embedding_model,
       embedding_dimensions, embedding_purpose, format_version)
     DO UPDATE SET
       original_question = excluded.original_question,
       embedding_json = excluded.embedding_json,
       hit_count = query_embedding_cache.hit_count + 1,
       updated_at = excluded.updated_at,
       last_used_at = excluded.last_used_at`,
  ).run(
    id,
    input.project_key,
    input.question,
    normalizedQuestion,
    input.contract.provider,
    input.contract.model,
    input.contract.dimensions,
    input.contract.purpose,
    input.contract.formatVersion,
    JSON.stringify(result.embedding),
    timestamp,
    timestamp,
    timestamp,
  );

  return {
    embedding: result.embedding,
    normalized_question: normalizedQuestion,
    cache_hit: false,
    cache_id: id,
  };
}

export function normalizeQueryQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

export function queryEmbeddingCacheId(input: {
  project_key: string;
  normalized_question: string;
  contract: ActiveEmbeddingContract;
}): string {
  const hash = createHash("sha256")
    .update(
      [
        input.project_key,
        input.normalized_question,
        input.contract.provider,
        input.contract.model,
        input.contract.dimensions,
        input.contract.purpose,
        input.contract.formatVersion,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);
  return `qemb_${hash}`;
}

function getCachedQueryEmbedding(
  db: Database,
  input: {
    project_key: string;
    normalized_question: string;
    contract: ActiveEmbeddingContract;
  },
): QueryEmbeddingCacheRow | null {
  return db
    .query(
      `SELECT id, embedding_json
       FROM query_embedding_cache
       WHERE project_key = ?
         AND normalized_question = ?
         AND embedding_provider = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = ?
         AND format_version = ?`,
    )
    .get(
      input.project_key,
      input.normalized_question,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.purpose,
      input.contract.formatVersion,
    ) as QueryEmbeddingCacheRow | null;
}

function markQueryEmbeddingCacheHit(db: Database, input: { id: string; now: string }): void {
  db.query(
    `UPDATE query_embedding_cache
     SET hit_count = hit_count + 1,
         updated_at = ?,
         last_used_at = ?
     WHERE id = ?`,
  ).run(input.now, input.now, input.id);
}

function parseEmbedding(text: string): number[] {
  const value = JSON.parse(text) as unknown;
  if (!Array.isArray(value)) throw new Error("Cached query embedding is not an array");
  return value.map((item) => Number(item));
}

function assertDimensions(expected: number, actual: number): void {
  if (expected !== actual) throw new Error(`Query embedding dimensions mismatch: expected ${expected}, got ${actual}`);
}
