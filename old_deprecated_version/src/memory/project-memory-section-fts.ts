import type { Database } from "bun:sqlite";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type { ProjectMemoryMarkdownSection } from "../project/project-memory-markdown-sections.ts";
import type { ProjectMemoryRetrievalEmbeddingRow } from "./project-memory-retrieval-storage.ts";

export type ProjectMemoryFtsMatch = {
  retrieval_row_id: string;
  bm25_score: number;
};

export function ensureProjectMemorySectionFtsTable(db: Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS project_memory_section_fts USING fts5(
      retrieval_row_id UNINDEXED,
      project_key UNINDEXED,
      wiki_path,
      page_title,
      heading_text,
      section_id,
      body_text,
      tokenize = 'porter unicode61'
    );
  `);
}

export function syncProjectMemorySectionFts(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
    sections: ProjectMemoryMarkdownSection[];
  },
): void {
  ensureProjectMemorySectionFtsTable(db);
  const sectionByKey = new Map(input.sections.map((section) => [`${section.wiki_path}#${section.section_id}`, section]));
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
         AND status = 'indexed'`,
    )
    .all(
      input.project_key,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.formatVersion,
    ) as ProjectMemoryRetrievalEmbeddingRow[];

  db.transaction(() => {
    for (const row of rows) {
      const section = sectionByKey.get(`${row.wiki_path}#${row.section_id}`);
      if (!section || section.section_hash !== row.section_hash) continue;
      upsertProjectMemorySectionFtsRow(db, {
        project_key: input.project_key,
        retrieval_row_id: row.id,
        section,
      });
    }
  })();
}

export function upsertProjectMemorySectionFtsRow(
  db: Database,
  input: {
    project_key: string;
    retrieval_row_id: string;
    section: ProjectMemoryMarkdownSection;
  },
): void {
  ensureProjectMemorySectionFtsTable(db);
  db.query("DELETE FROM project_memory_section_fts WHERE retrieval_row_id = ?").run(input.retrieval_row_id);
  db.query(
    `INSERT INTO project_memory_section_fts
      (retrieval_row_id, project_key, wiki_path, page_title, heading_text, section_id, body_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.retrieval_row_id,
    input.project_key,
    input.section.wiki_path,
    input.section.page_title,
    input.section.heading_path.join(" "),
    input.section.section_id,
    input.section.body_text,
  );
}

export function searchProjectMemorySectionFts(
  db: Database,
  input: {
    project_key: string;
    contract: ActiveEmbeddingContract;
    question: string;
    limit: number;
  },
): ProjectMemoryFtsMatch[] {
  ensureProjectMemorySectionFtsTable(db);
  const expression = ftsQueryExpression(input.question);
  if (!expression) return [];
  return db
    .query(
      `SELECT f.retrieval_row_id,
              bm25(project_memory_section_fts, 0.0, 0.0, 2.0, 4.0, 5.0, 4.0, 1.0) AS bm25_score
       FROM project_memory_section_fts f
       JOIN project_memory_retrieval_embeddings e ON e.id = f.retrieval_row_id
       WHERE project_memory_section_fts MATCH ?
         AND f.project_key = ?
         AND e.project_key = ?
         AND e.embedding_provider = ?
         AND e.embedding_model = ?
         AND e.embedding_dimensions = ?
         AND e.embedding_purpose = 'retrieval_document'
         AND e.format_version = ?
         AND e.status = 'indexed'
       ORDER BY bm25_score ASC
       LIMIT ?`,
    )
    .all(
      expression,
      input.project_key,
      input.project_key,
      input.contract.provider,
      input.contract.model,
      input.contract.dimensions,
      input.contract.formatVersion,
      input.limit,
    ) as ProjectMemoryFtsMatch[];
}

function ftsQueryExpression(question: string): string | null {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !FTS_STOP_WORDS.has(token));
  const uniqueTokens = Array.from(new Set(tokens)).slice(0, 12);
  if (uniqueTokens.length === 0) return null;
  return uniqueTokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
}

const FTS_STOP_WORDS = new Set([
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
