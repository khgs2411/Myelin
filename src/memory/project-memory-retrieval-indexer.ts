import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { EmbeddingProviderClient, EmbeddingResult } from "./embedding-provider.ts";
import {
  extractProjectMemorySections,
  writeProjectMemorySectionManifest,
  type ProjectMemoryMarkdownSection,
} from "../project/project-memory-markdown-sections.ts";
import {
  projectMemoryHintHash,
  validateProjectMemoryHintsForManifest,
  type ProjectMemoryHintEntry,
} from "../project/project-memory-hints.ts";
import {
  ensurePendingProjectMemoryRetrievalEmbedding,
  listPendingProjectMemoryRetrievalEmbeddings,
  markProjectMemoryRetrievalEmbeddingFailed,
  markProjectMemoryRetrievalEmbeddingIndexed,
  markProjectMemoryRetrievalEmbeddingStaleOrOrphaned,
  type ProjectMemoryRetrievalEmbeddingRow,
} from "./project-memory-retrieval-storage.ts";
import { normalizeProjectMemorySectionForEmbedding } from "./project-memory-retrieval-text.ts";
import { upsertProjectMemorySectionFtsRow } from "./project-memory-section-fts.ts";
import {
  createSqliteVecAdapter,
  ensureProjectMemoryRetrievalVectorTable,
  upsertProjectMemoryRetrievalVector,
  type ProjectMemoryRetrievalVectorInput,
  type SqliteVecAdapter,
} from "./sqlite-vec.ts";

export type ProjectMemoryRetrievalIndexFailure = {
  retrieval_row_id: string;
  wiki_path: string;
  section_id: string;
  reason: string;
};

export type ProjectMemoryRetrievalIndexResult = {
  project_key: string;
  structural_sections_seen: number;
  hints_valid: number;
  hints_stale: number;
  hints_orphaned: number;
  selected: number;
  indexed: number;
  failed: number;
  pending_remaining: number;
  degraded: boolean;
  batch_size: number;
  degraded_reason?: string;
  failures: ProjectMemoryRetrievalIndexFailure[];
};

export type ProjectMemoryRetrievalVectorStore = {
  ensure: (db: Database, input: { contract: ActiveEmbeddingContract }) => { available: boolean; reason?: string };
  upsert: (db: Database, input: ProjectMemoryRetrievalVectorInput) => void;
};

type PreparedEmbeddingEntry = {
  row: ProjectMemoryRetrievalEmbeddingRow;
  section: ProjectMemoryMarkdownSection;
  hint: ProjectMemoryHintEntry | null;
  normalizedText: string;
};

export async function indexProjectMemoryRetrieval(
  db: Database,
  input: {
    root: string;
    project_key: string;
    contract: ActiveEmbeddingContract;
    provider: EmbeddingProviderClient;
    limit: number;
    batch_size?: number;
    retry_failed?: boolean;
    now?: () => string;
    vector_store?: ProjectMemoryRetrievalVectorStore;
  },
): Promise<ProjectMemoryRetrievalIndexResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const batchSize = input.batch_size ?? input.limit;
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error(`Invalid embedding batch size: ${batchSize}`);

  const extractedManifest = await extractProjectMemorySections(input.root, input.project_key, { now: new Date(now()) });
  const manifest = {
    ...extractedManifest,
    sections: extractedManifest.sections.filter(isIndexableProjectMemorySection),
  };
  await writeProjectMemorySectionManifest(input.root, manifest);
  const hintValidation = await validateProjectMemoryHintsForManifest(input.root, manifest);

  const currentRowIds = new Set<string>();
  const sectionByRowId = new Map<string, ProjectMemoryMarkdownSection>();
  const hintByRowId = new Map<string, ProjectMemoryHintEntry | null>();
  for (const section of manifest.sections) {
    const hint = hintValidation.valid_entries_by_section.get(`${section.wiki_path}#${section.section_id}`) ?? null;
    const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
      project_key: input.project_key,
      wiki_path: section.wiki_path,
      section_id: section.section_id,
      section_hash: section.section_hash,
      hint_hash: hint ? projectMemoryHintHash(hint) : null,
      contract: input.contract,
      now: now(),
    });
    currentRowIds.add(row.id);
    sectionByRowId.set(row.id, section);
    hintByRowId.set(row.id, hint);
  }
  markOutdatedRows(db, {
    project_key: input.project_key,
    contract: input.contract,
    currentRowIds,
    sections: manifest.sections,
    now: now(),
  });

  const rows = listPendingProjectMemoryRetrievalEmbeddings(db, {
    project_key: input.project_key,
    contract: input.contract,
    limit: input.limit,
    include_failed: input.retry_failed,
  });
  const failures: ProjectMemoryRetrievalIndexFailure[] = [];

  if (rows.length === 0) {
    return resultFor({
      db,
      input,
      manifestCount: manifest.sections.length,
      selected: 0,
      indexed: 0,
      failures,
      batchSize,
      hintCounts: hintValidation.counts,
    });
  }

  const vectorStore = input.vector_store ?? defaultProjectMemoryRetrievalVectorStore(createSqliteVecAdapter());
  const availability = vectorStore.ensure(db, { contract: input.contract });
  if (!availability.available) {
    const reason = `sqlite-vec unavailable: ${availability.reason ?? "unknown reason"}`;
    for (const row of rows) {
      markFailed(db, row, sectionByRowId, reason, now(), failures);
    }
    return resultFor({
      db,
      input,
      manifestCount: manifest.sections.length,
      selected: rows.length,
      indexed: 0,
      failures,
      batchSize,
      degradedReason: reason,
      hintCounts: hintValidation.counts,
    });
  }

  let indexed = 0;
  const entries: PreparedEmbeddingEntry[] = [];
  for (const row of rows) {
    const section = sectionByRowId.get(row.id) ?? findSectionForRow(manifest.sections, row);
    if (!section) {
      markFailed(db, row, sectionByRowId, "section not found for retrieval row", now(), failures);
      continue;
    }
    entries.push({
      row,
      section,
      hint: hintByRowId.get(row.id) ?? null,
      normalizedText: normalizeProjectMemorySectionForEmbedding({
        ...section,
        hints: hintByRowId.get(row.id) ?? null,
      }),
    });
  }

  for (const chunk of chunks(entries, batchSize)) {
    let embeddings: EmbeddingResult[];
    try {
      embeddings =
        input.provider.embedBatch && chunk.length > 1
          ? await input.provider.embedBatch(
              chunk.map((entry) => ({
                contract: input.contract,
                title: entry.section.page_title,
                text: entry.normalizedText,
              })),
            )
          : await Promise.all(
              chunk.map((entry) =>
                input.provider.embed({
                  contract: input.contract,
                  title: entry.section.page_title,
                  text: entry.normalizedText,
                }),
              ),
            );
      if (embeddings.length !== chunk.length) {
        throw new Error(`Embedding batch result count mismatch: expected ${chunk.length}, got ${embeddings.length}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const entry of chunk) {
        markFailed(db, entry.row, sectionByRowId, reason, now(), failures);
      }
      continue;
    }

    for (let index = 0; index < chunk.length; index += 1) {
      const entry = chunk[index];
      const embedding = embeddings[index];
      try {
        if (embedding.dimensions !== input.contract.dimensions) {
          throw new Error(
            `Embedding dimensions mismatch: expected ${input.contract.dimensions}, got ${embedding.dimensions}`,
          );
        }
        const indexedAt = now();
        db.transaction(() => {
          vectorStore.upsert(db, {
            retrieval_row_id: entry.row.id,
            project_key: input.project_key,
            wiki_path: entry.row.wiki_path,
            section_id: entry.row.section_id,
            embedding_model: input.contract.model,
            embedding_dimensions: input.contract.dimensions,
            embedding_purpose: "retrieval_document",
            format_version: input.contract.formatVersion,
            embedding: embedding.embedding,
          });
          markProjectMemoryRetrievalEmbeddingIndexed(db, {
            id: entry.row.id,
            normalized_text_hash: sha256(entry.normalizedText),
            now: indexedAt,
          });
          upsertProjectMemorySectionFtsRow(db, {
            project_key: input.project_key,
            retrieval_row_id: entry.row.id,
            section: entry.section,
          });
        })();
        indexed += 1;
      } catch (error) {
        markFailed(db, entry.row, sectionByRowId, error instanceof Error ? error.message : String(error), now(), failures);
      }
    }
  }

  return resultFor({
    db,
    input,
    manifestCount: manifest.sections.length,
    selected: rows.length,
    indexed,
    failures,
    batchSize,
    degradedReason: failures.length > 0 ? "one or more Project Memory retrieval sections failed to index" : undefined,
    hintCounts: hintValidation.counts,
  });
}

export function defaultProjectMemoryRetrievalVectorStore(
  adapter: SqliteVecAdapter = createSqliteVecAdapter(),
): ProjectMemoryRetrievalVectorStore {
  return {
    ensure(db, input) {
      return ensureProjectMemoryRetrievalVectorTable(db, {
        dimensions: input.contract.dimensions,
        adapter,
        rebuildOnDimensionMismatch: true,
      });
    },
    upsert(db, input) {
      upsertProjectMemoryRetrievalVector(db, input);
    },
  };
}

function resultFor(input: {
  db: Database;
  input: { project_key: string; contract: ActiveEmbeddingContract };
  manifestCount: number;
  selected: number;
  indexed: number;
  failures: ProjectMemoryRetrievalIndexFailure[];
  batchSize: number;
  degradedReason?: string;
  hintCounts: { valid: number; stale: number; orphaned: number };
}): ProjectMemoryRetrievalIndexResult {
  return {
    project_key: input.input.project_key,
    structural_sections_seen: input.manifestCount,
    hints_valid: input.hintCounts.valid,
    hints_stale: input.hintCounts.stale,
    hints_orphaned: input.hintCounts.orphaned,
    selected: input.selected,
    indexed: input.indexed,
    failed: input.failures.length,
    pending_remaining: pendingRemaining(input.db, input.input.project_key, input.input.contract),
    degraded: input.failures.length > 0,
    batch_size: input.batchSize,
    degraded_reason: input.degradedReason,
    failures: input.failures,
  };
}

function pendingRemaining(db: Database, projectKey: string, contract: ActiveEmbeddingContract): number {
  const row = db
    .query(
      `SELECT count(*) AS n
       FROM project_memory_retrieval_embeddings
       WHERE project_key = ?
         AND embedding_provider = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = 'retrieval_document'
         AND format_version = ?
         AND status = 'pending'`,
    )
    .get(projectKey, contract.provider, contract.model, contract.dimensions, contract.formatVersion) as { n: number };
  return row.n;
}

function markOutdatedRows(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
    currentRowIds: Set<string>;
    sections: ProjectMemoryMarkdownSection[];
    now: string;
  },
): void {
  const currentSectionKeys = new Map(input.sections.map((section) => [`${section.wiki_path}#${section.section_id}`, section.section_hash]));
  const rows = db
    .query(
      `SELECT *
       FROM project_memory_retrieval_embeddings
       WHERE project_key = ?
         AND embedding_provider = ?
         AND embedding_model = ?
         AND embedding_dimensions = ?
         AND embedding_purpose = 'retrieval_document'
         AND format_version = ?
         AND status IN ('pending', 'indexed', 'failed')`,
    )
    .all(
      input.project_key,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.formatVersion,
    ) as ProjectMemoryRetrievalEmbeddingRow[];

  for (const row of rows) {
    if (input.currentRowIds.has(row.id)) continue;
    const currentHash = currentSectionKeys.get(`${row.wiki_path}#${row.section_id}`);
    markProjectMemoryRetrievalEmbeddingStaleOrOrphaned(db, {
      id: row.id,
      status: currentHash ? "stale" : "orphaned",
      failure_reason: currentHash ? "section hash changed" : "section no longer exists",
      now: input.now,
    });
  }
}

function findSectionForRow(
  sections: ProjectMemoryMarkdownSection[],
  row: ProjectMemoryRetrievalEmbeddingRow,
): ProjectMemoryMarkdownSection | null {
  return (
    sections.find(
      (section) =>
        section.wiki_path === row.wiki_path &&
        section.section_id === row.section_id &&
        section.section_hash === row.section_hash,
    ) ?? null
  );
}

function isIndexableProjectMemorySection(section: ProjectMemoryMarkdownSection): boolean {
  return section.heading_level > 1;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function markFailed(
  db: Database,
  row: ProjectMemoryRetrievalEmbeddingRow,
  sections: Map<string, ProjectMemoryMarkdownSection>,
  reason: string,
  now: string,
  failures: ProjectMemoryRetrievalIndexFailure[],
): void {
  markProjectMemoryRetrievalEmbeddingFailed(db, {
    id: row.id,
    failure_reason: reason,
    now,
  });
  const section = sections.get(row.id);
  failures.push({
    retrieval_row_id: row.id,
    wiki_path: section?.wiki_path ?? row.wiki_path,
    section_id: section?.section_id ?? row.section_id,
    reason,
  });
}

function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
