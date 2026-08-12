import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb } from "../../src/memory/db.ts";
import {
  SessionMemoryRepairService,
} from "../../src/memory/session-memory-repair-service.ts";
import {
  applySessionMemoryRepairCandidatesInOpenTransaction,
  createSessionMemory,
  retractSessionMemory,
} from "../helpers/session-mutation-authority.ts";
import {
  withCompatibilityCanonicalApplyAdmission,
  withCompatibilityEventLeaseAdmission,
} from "../../src/memory/session-memory-write-firewall.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-session-memory-repair-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("retracts only active memories supported entirely by control events and preserves evidence", async () => {
  const db = openMemoryDb(root);
  try {
    seedTombstone(db, "tomb_start", "session.start");
    seedTombstone(db, "tomb_content", "assistant.response");
    createSessionMemory(db, {
      id: "mem_control",
      project_key: "demo",
      source_event_refs: ["tomb_start"],
      memory_kind: "continuity",
      title: "Session started",
      summary: "A new session began.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-08-09T07:00:00.000Z",
      embedding_contract: null,
    });
    createSessionMemory(db, {
      id: "mem_content",
      project_key: "demo",
      source_event_refs: ["tomb_content"],
      memory_kind: "decision",
      title: "Keep useful evidence",
      summary: "Content-bearing evidence remains eligible.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-08-09T07:01:00.000Z",
      embedding_contract: null,
    });
  } finally {
    db.close();
  }

  const service = new SessionMemoryRepairService(root, () => new Date("2026-08-09T08:00:00.000Z"));
  const preview = service.preview("demo");
  expect(preview.candidates.map((candidate) => candidate.id)).toEqual(["mem_control"]);
  expect(preview.proposed_retractions).toBe(1);
  expect(preview.candidates[0]).toMatchObject({ revision: 1 });
  expect(preview.candidates[0]?.state_digest).toMatch(/^sha256:[0-9a-f]{64}$/);

  const applied = await service.apply("demo");
  expect(applied.status).toBe("completed");
  expect(applied.applied_retractions).toBe(1);
  expect(applied.report_path).not.toBeNull();
  const report = JSON.parse(await readFile(applied.report_path!, "utf8")) as Record<string, unknown>;
  expect(report).toMatchObject({ status: "completed", applied_retractions: 1 });
  expect(service.preview("demo").proposed_retractions).toBe(0);

  const verified = openMemoryDb(root);
  try {
    expect(verified.query("SELECT status, lifecycle_reason, revision FROM session_memories WHERE id = ?").get("mem_control")).toEqual({
      status: "retracted",
      lifecycle_reason:
        "repair:session-control-events-v1: control-only evidence cannot support trusted Session Memory",
      revision: 2,
    });
    expect(verified.query("SELECT status FROM session_memories WHERE id = ?").get("mem_content")).toEqual({ status: "active" });
    expect(verified.query("SELECT source_metadata_json FROM experience_event_tombstones WHERE id = ?").get("tomb_start"))
      .toEqual({ source_metadata_json: JSON.stringify({ event_kind: "session.start" }) });
  } finally {
    verified.close();
  }
});

test("repair fails closed when a previewed candidate becomes inactive", () => {
  seedControlMemory();
  const seeded = openMemoryDb(root);
  try {
    seedTombstone(seeded, "tomb_start_2", "session.start");
    createSessionMemory(seeded, {
      id: "mem_control_2",
      project_key: "demo",
      source_event_refs: ["tomb_start_2"],
      memory_kind: "continuity",
      title: "Another session started",
      summary: "Another session began.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-08-09T07:01:00.000Z",
      embedding_contract: null,
    });
  } finally {
    seeded.close();
  }
  const service = new SessionMemoryRepairService(root, () => new Date("2026-08-09T08:00:00.000Z"));
  const preview = service.preview("demo");
  const db = openMemoryDb(root);
  try {
    retractSessionMemory(db, {
      id: "mem_control_2",
      projectKey: "demo",
      reason: "concurrent lifecycle change",
      now: "2026-08-09T07:30:00.000Z",
    });

    expect(() => db.transaction(() => applySessionMemoryRepairCandidatesInOpenTransaction(db, {
      projectKey: "demo",
      candidates: preview.candidates,
      appliedAt: "2026-08-09T08:00:00.000Z",
    }))()).toThrow("no longer active after repair preview: mem_control_2");
    expect(db.query("SELECT status, revision FROM session_memories WHERE id = 'mem_control'").get()).toEqual({
      status: "active",
      revision: 1,
    });
    expect(db.query("SELECT status, revision FROM session_memories WHERE id = 'mem_control_2'").get()).toEqual({
      status: "retracted",
      revision: 2,
    });
  } finally {
    db.close();
  }
});

test("repair fails closed when a previewed candidate disappears", () => {
  seedControlMemory();
  const service = new SessionMemoryRepairService(root, () => new Date("2026-08-09T08:00:00.000Z"));
  const preview = service.preview("demo");
  const db = openMemoryDb(root);
  try {
    withCompatibilityCanonicalApplyAdmission(db, "demo", () => {
      db.query("DELETE FROM session_memories WHERE id = 'mem_control'").run();
    });

    expect(() => db.transaction(() => applySessionMemoryRepairCandidatesInOpenTransaction(db, {
      projectKey: "demo",
      candidates: preview.candidates,
      appliedAt: "2026-08-09T08:00:00.000Z",
    }))()).toThrow("missing after repair preview: mem_control");
    expect(db.query("SELECT count(*) AS count FROM session_memories").get()).toEqual({ count: 0 });
  } finally {
    db.close();
  }
});

function seedControlMemory(): void {
  const db = openMemoryDb(root);
  try {
    seedTombstone(db, "tomb_start", "session.start");
    createSessionMemory(db, {
      id: "mem_control",
      project_key: "demo",
      source_event_refs: ["tomb_start"],
      memory_kind: "continuity",
      title: "Session started",
      summary: "A new session began.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-08-09T07:00:00.000Z",
      embedding_contract: null,
    });
  } finally {
    db.close();
  }
}

function seedTombstone(db: ReturnType<typeof openMemoryDb>, id: string, eventKind: string): void {
  withCompatibilityEventLeaseAdmission(db, "demo", () => {
    db.query(
      `INSERT INTO experience_event_tombstones
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, NULL, 'demo', NULL, 'codex', NULL, ?, ?, 'output', 'output', ?, '{}', '[]')`,
    ).run(
      id,
      `event_${id}`,
      "2026-08-09T06:59:00.000Z",
      "2026-08-09T07:00:00.000Z",
      JSON.stringify({ event_kind: eventKind }),
    );
  });
}
