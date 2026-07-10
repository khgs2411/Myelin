import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import { openMemoryDb } from "../memory/db.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { attachMemoryQueryLogEval } from "../memory/query-logs.ts";
import { loadConfig } from "../runtime/config.ts";
import { MemoryQueryService, type QueryResponse } from "./memory-query-service.ts";

export type ProjectMemoryGoldenQuestion = {
  id: string;
  question: string;
  expected_primary_refs: string[];
  acceptable_refs?: string[];
  forbidden_top_refs?: string[];
  must_contain_text?: string[];
};

export type ProjectMemoryQuestionEvalCaseResult = {
  id: string;
  question: string;
  query_log_id: string | null;
  degraded: boolean;
  top_ref: string | null;
  expected_primary_rank: number | null;
  acceptable_rank: number | null;
  forbidden_top_hit: string | null;
  missing_answer_text: string[];
  passed: boolean;
};

export type ProjectMemoryQuestionEvalResult = {
  run_id: string;
  project_key: string;
  total: number;
  passed: number;
  failed: number;
  degraded: number;
  primary_rank_1: number;
  acceptable_top_5: number;
  forbidden_top_hits: number;
  started_at: string;
  finished_at: string;
  cases: ProjectMemoryQuestionEvalCaseResult[];
};

export async function loadProjectMemoryGoldenQuestions(input: {
  project_key: string;
  fixture_path?: string;
}): Promise<ProjectMemoryGoldenQuestion[]> {
  if (input.fixture_path) {
    const parsed = JSON.parse(await readFile(input.fixture_path, "utf8")) as { questions?: ProjectMemoryGoldenQuestion[] };
    if (!Array.isArray(parsed.questions)) throw new Error("Project Memory eval fixture must contain a questions array");
    return parsed.questions.map(validateGoldenQuestion);
  }
  if (input.project_key !== "llm-wiki") {
    throw new Error("No built-in Project Memory eval pack exists for this project; pass --fixture <path>");
  }
  return DEFAULT_LLM_WIKI_PROJECT_MEMORY_EVAL_QUESTIONS;
}

export async function runProjectMemoryQuestionEval(input: {
  root: string;
  project_key: string;
  questions: ProjectMemoryGoldenQuestion[];
  limit?: number;
  max_inline_chars?: number;
  now?: () => string;
  db?: Database;
}): Promise<ProjectMemoryQuestionEvalResult> {
  const startedAt = input.now?.() ?? new Date().toISOString();
  const runId = `pm_eval_${randomUUID()}`;
  const config = await loadConfig(input.root);
  const selection = await new EmbeddingProviderFactory(config).initialize("retrieval_document");
  const ownedDb = input.db ? null : openMemoryDb(input.root);
  const db = input.db ?? ownedDb;
  if (!db) throw new Error("Project Memory eval could not open memory db");

  const cases: ProjectMemoryQuestionEvalCaseResult[] = [];
  try {
    const service = new MemoryQueryService({
      db,
      documentContract: selection.contract,
      embeddingProvider: selection.client,
    });

    for (const question of input.questions) {
      const response = await service.query({
        root: input.root,
        projectKey: input.project_key,
        question: question.question,
        layer: "project",
        includeRoute: true,
        limit: input.limit ?? 5,
        maxInlineChars: input.max_inline_chars ?? 4000,
      });
      const result = evaluateProjectMemoryQuestion(question, response);
      cases.push(result);
      if (result.query_log_id) {
        attachMemoryQueryLogEval(db, {
          layer: "project",
          log_id: result.query_log_id,
          eval_run_id: runId,
          eval_result: result,
        });
      }
    }
  } finally {
    ownedDb?.close();
  }

  const finishedAt = input.now?.() ?? new Date().toISOString();
  return {
    run_id: runId,
    project_key: input.project_key,
    total: cases.length,
    passed: cases.filter((item) => item.passed).length,
    failed: cases.filter((item) => !item.passed).length,
    degraded: cases.filter((item) => item.degraded).length,
    primary_rank_1: cases.filter((item) => item.expected_primary_rank === 1).length,
    acceptable_top_5: cases.filter((item) => item.acceptable_rank !== null && item.acceptable_rank <= 5).length,
    forbidden_top_hits: cases.filter((item) => item.forbidden_top_hit !== null).length,
    started_at: startedAt,
    finished_at: finishedAt,
    cases,
  };
}

function evaluateProjectMemoryQuestion(
  question: ProjectMemoryGoldenQuestion,
  response: QueryResponse,
): ProjectMemoryQuestionEvalCaseResult {
  const refs = response.project_memory_matches.map((match) => `${match.wiki_path}#${match.section_id}`);
  const topRef = refs[0] ?? null;
  const acceptableRefs = new Set([...(question.expected_primary_refs ?? []), ...(question.acceptable_refs ?? [])]);
  const expectedPrimaryRank = firstRank(refs, new Set(question.expected_primary_refs));
  const acceptableRank = firstRank(refs, acceptableRefs);
  const forbiddenTopHit = topRef && question.forbidden_top_refs?.includes(topRef) ? topRef : null;
  const missingAnswerText = (question.must_contain_text ?? []).filter(
    (text) => !normalizeForContains(response.answer).includes(normalizeForContains(text)),
  );
  const passed =
    !response.degraded &&
    acceptableRank !== null &&
    acceptableRank <= 5 &&
    forbiddenTopHit === null &&
    missingAnswerText.length === 0;
  return {
    id: question.id,
    question: question.question,
    query_log_id: response.layers?.find((layer) => layer.layer === "project_memory")?.query_log_id ?? null,
    degraded: response.degraded,
    top_ref: topRef,
    expected_primary_rank: expectedPrimaryRank,
    acceptable_rank: acceptableRank,
    forbidden_top_hit: forbiddenTopHit,
    missing_answer_text: missingAnswerText,
    passed,
  };
}

function firstRank(refs: string[], expected: Set<string>): number | null {
  const index = refs.findIndex((ref) => expected.has(ref));
  return index === -1 ? null : index + 1;
}

function normalizeForContains(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function validateGoldenQuestion(question: ProjectMemoryGoldenQuestion): ProjectMemoryGoldenQuestion {
  if (!question.id || !question.question) throw new Error("Project Memory eval question requires id and question");
  if (!Array.isArray(question.expected_primary_refs) || question.expected_primary_refs.length === 0) {
    throw new Error(`Project Memory eval question ${question.id} requires expected_primary_refs`);
  }
  return question;
}

const DEFAULT_LLM_WIKI_PROJECT_MEMORY_EVAL_QUESTIONS: ProjectMemoryGoldenQuestion[] = [
  {
    id: "pm-create-mode",
    question: "How does Project Memory create the initial wiki documentation?",
    expected_primary_refs: [
      "wiki/project-memory-creation-and-curation.md#project-memory-creation-and-curation/current-creation-model",
    ],
    must_contain_text: ["planner agent", "subject writer agents"],
  },
  {
    id: "pm-query-markdown-resolution",
    question: "How does Project Memory query resolve vector matches back to markdown?",
    expected_primary_refs: [
      "wiki/storage-sqlite-and-retrieval-indexes.md#storage-sqlite-and-retrieval-indexes/project-memory-retrieval-indexing",
    ],
    acceptable_refs: [
      "wiki/query-status-and-agent-interfaces.md#query-status-and-agent-interfaces/memory-query-facade",
    ],
    must_contain_text: ["canonical Project Memory writes", "markdown"],
  },
  {
    id: "pm-command-replacement",
    question: "What command replaced old project ingest behavior?",
    expected_primary_refs: [
      "wiki/command-surface-and-operator-workflows.md#command-surface-and-operator-workflows/known-conflicts-and-gaps",
    ],
    must_contain_text: ["project learn"],
  },
  {
    id: "pm-runtime-inbox-leads",
    question: "Are runtime inbox items trusted memory or just leads?",
    expected_primary_refs: [
      "wiki/source-evidence-inbox-and-candidate-boundaries.md#source-evidence-inbox-and-candidate-boundaries/candidates-are-leads",
    ],
    must_contain_text: ["creates exactly one candidate", "needs_review"],
  },
  {
    id: "pm-source-of-truth",
    question: "What is the source of truth relationship between repo, markdown wiki, and SQLite?",
    expected_primary_refs: ["wiki/product-and-memory-model.md#product-and-memory-model/source-of-truth-model"],
    must_contain_text: ["implementation truth", "SQLite is serving state"],
  },
  {
    id: "pm-quality-bar",
    question: "How does Myelin distinguish product-quality Project Memory from mechanically valid documentation?",
    expected_primary_refs: ["wiki/product-and-memory-model.md#product-and-memory-model/project-memory-quality-bar"],
    forbidden_top_refs: ["wiki/product-and-memory-model.md#product-and-memory-model/product-purpose", "wiki/index.md"],
    must_contain_text: ["mechanical correctness is not enough", "representative questions"],
  },
  {
    id: "pm-retrieval-after-promotion",
    question: "After Project Memory markdown is promoted, how is retrieval refreshed?",
    expected_primary_refs: [
      "wiki/project-memory-creation-and-curation.md#project-memory-creation-and-curation/retrieval-after-apply",
    ],
    must_contain_text: ["refreshes serving state from markdown"],
  },
  {
    id: "pm-side-effect-boundaries",
    question: "Which Myelin commands are read-only or side-effect-light versus explicit write commands?",
    expected_primary_refs: [
      "wiki/command-surface-and-operator-workflows.md#command-surface-and-operator-workflows/side-effect-boundaries",
    ],
    must_contain_text: ["read-only", "write"],
  },
  {
    id: "pm-session-records",
    question: "How are trusted Session Memory records stored and lifecycle-managed during ingest?",
    expected_primary_refs: [
      "wiki/session-memory-and-experience-ingest.md#session-memory-and-experience-ingest/session-memory-records",
    ],
    must_contain_text: ["session_memories", "active"],
  },
  {
    id: "pm-vector-rebuild",
    question: "What should happen when Project Memory vector rows are stale, missing, or need rebuilding?",
    expected_primary_refs: [
      "wiki/storage-sqlite-and-retrieval-indexes.md#storage-sqlite-and-retrieval-indexes/freshness-rebuild-and-degradation-rules",
    ],
    must_contain_text: ["markdown wins", "rebuild"],
  },
  {
    id: "pm-config-precedence",
    question: "How does Myelin choose runtime configuration and provider settings?",
    expected_primary_refs: [
      "wiki/runtime-providers-and-project-layout.md#runtime-providers-and-project-layout/config-precedence",
    ],
    acceptable_refs: [
      "wiki/runtime-providers-and-project-layout.md#runtime-providers-and-project-layout/provider-abstraction",
    ],
    must_contain_text: ["myelin.config", ".env"],
  },
  {
    id: "pm-contract-tests",
    question: "Which tests define the Project Memory creation and curation contract?",
    expected_primary_refs: [
      "wiki/project-memory-creation-and-curation.md#project-memory-creation-and-curation/tests-that-define-the-contract",
    ],
    must_contain_text: ["tests/project"],
  },
  {
    id: "pm-mcp-boundary",
    question: "What is the boundary between core query logic and detached MCP consumers?",
    expected_primary_refs: [
      "wiki/query-status-and-agent-interfaces.md#query-status-and-agent-interfaces/agent-and-mcp-boundary",
    ],
    must_contain_text: ["query logic lives once", "detached MCP"],
  },
  {
    id: "pm-inbox-candidates",
    question: "How should preserved source material and runtime inbox proposals become candidates?",
    expected_primary_refs: [
      "wiki/source-evidence-inbox-and-candidate-boundaries.md#source-evidence-inbox-and-candidate-boundaries/runtime-inbox-source-proposals",
    ],
    must_contain_text: ["runtime inbox"],
  },
  {
    id: "pm-verification-commands",
    question: "What standard verification commands should agents run in this repository?",
    expected_primary_refs: [
      "wiki/testing-and-verification.md#testing-and-verification/standard-verification-commands",
    ],
    must_contain_text: ["bun test", "typecheck"],
  },
];
