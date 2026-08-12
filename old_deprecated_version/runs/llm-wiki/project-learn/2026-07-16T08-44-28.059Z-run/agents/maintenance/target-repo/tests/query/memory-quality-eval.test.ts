import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { createMemoryCandidate, listMemoryCandidates } from "../../src/memory/candidates.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import type { EmbeddingProviderClient } from "../../src/memory/embedding-types.ts";
import type { MemoryScope, SessionMemoryKind } from "../../src/memory/ingest-types.ts";
import { querySessionMemory, type SessionMemoryQueryVectorStore } from "../../src/memory/session-memory-query.ts";
import { ensurePendingSessionMemoryEmbedding, markSessionMemoryEmbeddingIndexed } from "../../src/memory/session-memory-embeddings.ts";
import { createSessionMemoryContexts } from "../../src/memory/session-memory-contexts.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";

type EvalStatus = "pass" | "warn" | "fail";
type EvalDiagnosis = "ok" | "ranking" | "candidate-promotion" | "stale-lifecycle" | "missing-ingest-output";

type QualityFixture = {
  project_key: string;
  memories: FixtureMemory[];
  candidates: FixtureCandidate[];
  cases: FixtureCase[];
};

type FixtureMemory = {
  id: string;
  kind: SessionMemoryKind;
  title: string;
  summary: string;
  created_at: string;
  contexts: Array<{ git_branch: string; repo_path: string }>;
};

type FixtureCandidate = {
  id: string;
  scope: MemoryScope;
  status: "needs_review";
  candidate_type: string;
  title: string;
  summary: string;
  reason: string;
};

type FixtureCase = {
  id: string;
  question: string;
  git_branch?: string;
  cached_vector_matches: Array<{ memory_id: string; distance: number }>;
  expected_active_any_ids?: string[];
  expected_candidate_any_ids?: string[];
  forbidden_active_ids?: string[];
  expected_max_rank?: number;
  expected_status: EvalStatus;
  expected_diagnosis: EvalDiagnosis;
};

type EvalResult = {
  id: string;
  status: EvalStatus;
  diagnosis: EvalDiagnosis;
  top_ids: string[];
  reason: string;
};

const QUALITY_CASE_IDS = [
  "reconciliation-race-ranking",
  "branch-context-top-rank",
  "oo-composition-candidate",
  "stale-next-action",
  "failed-job-admin-ranking",
  "dogfood-project-key-top-rank",
  "session-memory-live-top-rank",
  "branch-filter-removes-other-branch",
  "mcp-boundary-missing",
  "auto-maintenance-not-in-snapshot",
] as const;

test("llm-wiki Session Memory quality fixture has executable expectations", async () => {
  const fixture = await loadFixture();

  expect(fixture.project_key).toBe("llm-wiki");
  expect(fixture.memories.length).toBeGreaterThanOrEqual(5);
  expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
  for (const item of fixture.cases) {
    expect(item.id).toBeTruthy();
    expect(item.question).toBeTruthy();
    expect(item.cached_vector_matches.length).toBeGreaterThan(0);
    expect(["pass", "warn", "fail"]).toContain(item.expected_status);
  }
});

for (const caseId of QUALITY_CASE_IDS) {
  test(`llm-wiki Session Memory quality case: ${caseId}`, async () => {
    const fixture = await loadFixture();
    const item = fixture.cases.find((candidate) => candidate.id === caseId);
    if (!item) throw new Error(`Missing fixture case: ${caseId}`);
    const db = openMemoryDbAt(":memory:");
    try {
      seedFixture(db, fixture);
      const result = await evaluateCase(db, fixture, item);

      expect(result.status, result.reason).toBe(item.expected_status);
      expect(result.diagnosis, result.reason).toBe(item.expected_diagnosis);
    } finally {
      db.close();
    }
  });
}

test("llm-wiki Session Memory quality baseline diagnoses current retrieval weaknesses", async () => {
  const fixture = await loadFixture();
  const db = openMemoryDbAt(":memory:");
  try {
    seedFixture(db, fixture);

    const results = [];
    for (const item of fixture.cases) {
      results.push(await evaluateCase(db, fixture, item));
    }

    expect(results).toEqual([
      expect.objectContaining({
        id: "reconciliation-race-ranking",
        status: "warn",
        diagnosis: "ranking",
        top_ids: [
          "mem_llmwiki_dogfood_followup",
          "mem_llmwiki_worker_reconciliation_skip_stale_ops",
          "mem_llmwiki_ingest_design_finalized",
        ],
      }),
      expect.objectContaining({
        id: "branch-context-top-rank",
        status: "pass",
        diagnosis: "ok",
        top_ids: ["mem_llmwiki_git_context_branching", "mem_llmwiki_ingest_branch_flex", "mem_llmwiki_worker_reconciliation_skip_stale_ops"],
      }),
      expect.objectContaining({
        id: "oo-composition-candidate",
        status: "warn",
        diagnosis: "candidate-promotion",
      }),
      expect.objectContaining({
        id: "stale-next-action",
        status: "warn",
        diagnosis: "stale-lifecycle",
        top_ids: ["mem_llmwiki_dogfood_followup", "mem_ingest_pipeline", "mem_llmwiki_dogfood_project_key"],
      }),
      expect.objectContaining({
        id: "failed-job-admin-ranking",
        status: "warn",
        diagnosis: "ranking",
        top_ids: ["mem_ingest_pipeline", "mem_llmwiki_ingest_jobs_admin", "mem_llmwiki_ingest_runtime_lease_validation"],
      }),
      expect.objectContaining({
        id: "dogfood-project-key-top-rank",
        status: "pass",
        diagnosis: "ok",
        top_ids: ["mem_llmwiki_dogfood_project_key", "mem_ingest_pipeline", "mem_llmwiki_cli_docs_canonical"],
      }),
      expect.objectContaining({
        id: "session-memory-live-top-rank",
        status: "pass",
        diagnosis: "ok",
        top_ids: ["mem_llmwiki_session_memory_active_only", "mem_ingest_pipeline", "mem_llmwiki_ingest_runtime_lease_validation"],
      }),
      expect.objectContaining({
        id: "branch-filter-removes-other-branch",
        status: "pass",
        diagnosis: "ok",
        top_ids: ["mem_llmwiki_ingest_branch_flex", "mem_llmwiki_git_context_branching"],
      }),
      expect.objectContaining({
        id: "mcp-boundary-missing",
        status: "fail",
        diagnosis: "missing-ingest-output",
      }),
      expect.objectContaining({
        id: "auto-maintenance-not-in-snapshot",
        status: "fail",
        diagnosis: "missing-ingest-output",
      }),
    ]);

    for (const result of results) {
      const expected = fixture.cases.find((item) => item.id === result.id);
      if (!expected) throw new Error(`Missing fixture expectation for result: ${result.id}`);
      expect(result.status, result.reason).toBe(expected.expected_status);
      expect(result.diagnosis, result.reason).toBe(expected.expected_diagnosis);
    }
  } finally {
    db.close();
  }
});

async function loadFixture(): Promise<QualityFixture> {
  return JSON.parse(
    await readFile(join(import.meta.dir, "fixtures", "llm-wiki-session-memory-quality.json"), "utf8"),
  ) as QualityFixture;
}

function seedFixture(db: Database, fixture: QualityFixture): void {
  for (const memory of fixture.memories) {
    createSessionMemory(db, {
      id: memory.id,
      project_key: fixture.project_key,
      source_event_refs: [`tomb_${memory.id}`],
      memory_kind: memory.kind,
      title: memory.title,
      summary: memory.summary,
      payload: {},
      confidence: "high",
      risk: "low",
      now: memory.created_at,
      embedding_contract: null,
    });
    const embedding = ensurePendingSessionMemoryEmbedding(db, {
      session_memory_id: memory.id,
      project_key: fixture.project_key,
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      now: memory.created_at,
    });
    markSessionMemoryEmbeddingIndexed(db, {
      id: embedding.id,
      normalized_text_hash: `hash_${memory.id}`,
      now: memory.created_at,
    });
    createSessionMemoryContexts(
      db,
      memory.contexts.map((context, index) => ({
        session_memory_id: memory.id,
        project_key: fixture.project_key,
        repo_path: context.repo_path,
        git_branch: context.git_branch,
        git_commit: "snapshot",
        git_worktree_id: context.repo_path,
        source_event_ref: `tomb_${memory.id}_${index}`,
      })),
    );
  }

  for (const candidate of fixture.candidates) {
    createMemoryCandidate(db, {
      id: candidate.id,
      project_key: fixture.project_key,
      scope: candidate.scope,
      status: candidate.status,
      candidate_type: candidate.candidate_type,
      title: candidate.title,
      summary: candidate.summary,
      source_event_refs: [`tomb_${candidate.id}`],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "medium",
      reason: candidate.reason,
      now: "2026-06-17T20:00:00.000Z",
    });
  }
}

async function evaluateCase(db: Database, fixture: QualityFixture, item: FixtureCase): Promise<EvalResult> {
  const result = await querySessionMemory(db, {
    project_key: fixture.project_key,
    question: item.question,
    document_contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
    provider: fixedProvider(),
    limit: 5,
    filters: item.git_branch ? { git_branch: item.git_branch } : undefined,
    vector_store: vectorStoreFor(item),
  });
  const topIds = result.matches.map((match) => match.id);
  const forbiddenHit = item.forbidden_active_ids?.find((id) => topIds.includes(id));
  if (forbiddenHit) {
    return {
      id: item.id,
      status: "warn",
      diagnosis: "stale-lifecycle",
      top_ids: topIds,
      reason: `forbidden stale memory returned: ${forbiddenHit}`,
    };
  }

  const expectedActiveRank = rankOfAny(topIds, item.expected_active_any_ids ?? []);
  if ((item.expected_active_any_ids ?? []).length > 0 && expectedActiveRank === null) {
    return {
      id: item.id,
      status: "fail",
      diagnosis: "missing-ingest-output",
      top_ids: topIds,
      reason: `none of the expected active memories returned: ${(item.expected_active_any_ids ?? []).join(", ")}`,
    };
  }
  if (expectedActiveRank !== null && item.expected_max_rank !== undefined && expectedActiveRank > item.expected_max_rank) {
    return {
      id: item.id,
      status: "warn",
      diagnosis: "ranking",
      top_ids: topIds,
      reason: `expected memory rank ${expectedActiveRank}; wanted <= ${item.expected_max_rank}`,
    };
  }

  const expectedCandidate = item.expected_candidate_any_ids?.find((id) => candidateExists(db, fixture.project_key, id));
  if ((item.expected_candidate_any_ids ?? []).length > 0 && expectedCandidate) {
    return {
      id: item.id,
      status: "warn",
      diagnosis: "candidate-promotion",
      top_ids: topIds,
      reason: `relevant knowledge exists only as needs-review candidate: ${expectedCandidate}`,
    };
  }
  if ((item.expected_candidate_any_ids ?? []).length > 0) {
    return {
      id: item.id,
      status: "fail",
      diagnosis: "missing-ingest-output",
      top_ids: topIds,
      reason: `expected candidate was not present: ${(item.expected_candidate_any_ids ?? []).join(", ")}`,
    };
  }

  return {
    id: item.id,
    status: "pass",
    diagnosis: "ok",
    top_ids: topIds,
    reason: "expected retrieval behavior matched",
  };
}

function vectorStoreFor(item: FixtureCase): SessionMemoryQueryVectorStore {
  return {
    ensure() {
      return { available: true };
    },
    search() {
      return item.cached_vector_matches;
    },
  };
}

function rankOfAny(ids: string[], expected: string[]): number | null {
  let bestRank: number | null = null;
  for (const id of expected) {
    const index = ids.indexOf(id);
    if (index !== -1) {
      const rank = index + 1;
      bestRank = bestRank === null ? rank : Math.min(bestRank, rank);
    }
  }
  return bestRank;
}

function candidateExists(db: Database, projectKey: string, id: string): boolean {
  return listMemoryCandidates(db, { project_key: projectKey, status: "needs_review" }).some((candidate) => candidate.id === id);
}

function fixedProvider(): EmbeddingProviderClient {
  return {
    async embed(request) {
      return {
        embedding: Array.from({ length: request.contract.dimensions }, () => 0),
        model: request.contract.model,
        dimensions: request.contract.dimensions,
      };
    },
    async embedBatch(requests) {
      return Promise.all(requests.map((request) => this.embed(request)));
    },
  };
}
