import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { LeasedExperienceEvent } from "../../src/memory/experience.ts";
import { createSessionMemoryContexts } from "../../src/memory/session-memory-contexts.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";
import { selectSessionMemoryReconciliationContext } from "../../src/ingest/reconciliation-context.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
});

afterEach(() => {
  db.close();
});

test("selects recent and branch-aware active memories for ingest reconciliation", async () => {
  createSessionMemory(db, {
    id: "mem_recent",
    project_key: "wizepal",
    source_event_refs: ["tomb_recent"],
    memory_kind: "continuity",
    title: "Recent work",
    summary: "Recent SQLite work touched AgentKnowledgeComponent.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-17T10:00:00.000Z",
  });
  createSessionMemory(db, {
    id: "mem_branch",
    project_key: "wizepal",
    source_event_refs: ["tomb_branch"],
    memory_kind: "decision",
    title: "Branch work",
    summary: "Branch-specific sqlite-vec retrieval context.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-17T09:00:00.000Z",
  });
  createSessionMemory(db, {
    id: "mem_old",
    project_key: "wizepal",
    source_event_refs: ["tomb_old"],
    memory_kind: "decision",
    summary: "Stale SQLite memory.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-17T08:00:00.000Z",
  });
  db.query("UPDATE session_memories SET status = 'superseded', superseded_by = 'mem_recent' WHERE id = 'mem_old'").run();
  createSessionMemoryContexts(db, [
    {
      session_memory_id: "mem_branch",
      project_key: "wizepal",
      repo_path: "/Users/liadgoren/Wizepal/droplet-bot",
      git_branch: "feature/sqlite-vec",
      git_commit: "abc123",
      git_worktree_id: "/Users/liadgoren/Wizepal/droplet-bot",
      source_event_ref: "tomb_branch",
    },
  ]);

  const result = await selectSessionMemoryReconciliationContext({
    db,
    projectKey: "wizepal",
    leased: [leasedEvent()],
    limit: 10,
  });

  expect(result.map((memory) => memory.id)).toContain("mem_recent");
  expect(result.map((memory) => memory.id)).toContain("mem_branch");
  expect(result.map((memory) => memory.id)).not.toContain("mem_old");
  expect(result.find((memory) => memory.id === "mem_branch")?.selection_reasons).toContain("branch:feature/sqlite-vec");
});

test("prioritizes active next_action memories for stale lifecycle reconciliation", async () => {
  for (let index = 0; index < 8; index += 1) {
    createSessionMemory(db, {
      id: `mem_recent_${index}`,
      project_key: "wizepal",
      source_event_refs: [`tomb_recent_${index}`],
      memory_kind: "continuity",
      summary: `Recent continuity ${index}.`,
      payload: {},
      confidence: "high",
      risk: "low",
      now: `2026-06-17T10:0${index}:00.000Z`,
    });
  }
  createSessionMemory(db, {
    id: "mem_stale_next_action",
    project_key: "wizepal",
    source_event_refs: ["tomb_next_action"],
    memory_kind: "next_action",
    title: "Retry failed auto-maintenance ingest",
    summary: "Retry failed auto-maintenance ingest after the prompt-size fix.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-06-17T09:00:00.000Z",
  });

  const result = await selectSessionMemoryReconciliationContext({
    db,
    projectKey: "wizepal",
    leased: [leasedEvent()],
    limit: 5,
  });

  const nextAction = result.find((memory) => memory.id === "mem_stale_next_action");
  expect(nextAction?.memory_kind).toBe("next_action");
  expect(nextAction?.selection_reasons).toContain("active_next_action");
});

function leasedEvent(): LeasedExperienceEvent {
  return {
    id: "tomb_new",
    original_event_id: "evt_new",
    project_key: "wizepal",
    ingest_job_id: "job_1",
    provider: "codex",
    provider_session_id: null,
    claimed_at: "2026-06-17T11:00:00.000Z",
    state: "claimed",
    source_metadata_json: JSON.stringify({
      repo_path: "/Users/liadgoren/Wizepal/droplet-bot",
      git_branch: "feature/sqlite-vec",
      git_commit: "def456",
      git_worktree_id: "/Users/liadgoren/Wizepal/droplet-bot",
    }),
    retained_evidence_json: "{}",
    prompt_evidence: {
      raw_text: "sqlite vec AgentKnowledgeComponent retrieval branch context",
      raw_payload_json: "{}",
    },
  };
}
