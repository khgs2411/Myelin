import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { recordExperienceEvent } from "../../src/memory/experience.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
});

afterEach(() => db.close());

test("revalidates, leases, and copies exact evidence batches without terminalizing raw rows", () => {
  seedEvidence(db, "evt-1");
  seedEvidence(db, "evt-2");
  activateSMCAuthority(db);
  const plan = planEvidence(db);

  const result = prepare(db, plan);

  expect(result.kind).toBe("prepared");
  expect(db.query("SELECT source_id, ordinal FROM smc_evidence_snapshot ORDER BY ordinal").all()).toEqual([
    { source_id: "evt-1", ordinal: 0 },
    { source_id: "evt-2", ordinal: 1 },
  ]);
  expect(db.query("SELECT state, finalized_at FROM experience_event_tombstones ORDER BY original_event_id").all())
    .toEqual([
      { state: "claimed", finalized_at: null },
      { state: "claimed", finalized_at: null },
    ]);
  expect(db.query("SELECT id FROM experience_events ORDER BY id").all()).toEqual([{ id: "evt-1" }, { id: "evt-2" }]);
  expect(db.query("SELECT source_id FROM smc_evidence_batch_members ORDER BY ordinal").all())
    .toEqual([{ source_id: "evt-1" }, { source_id: "evt-2" }]);
});

test("evidence drift returns a stable blocker and rolls back every preparation row", () => {
  seedEvidence(db, "evt-1", "before");
  activateSMCAuthority(db);
  const plan = planEvidence(db);
  recordExperienceEvent(db, {
    id: "evt-2",
    project_key: "demo",
    occurred_at: "2026-08-11T12:01:00.000Z",
    event_kind: "assistant.response",
    provider: "codex",
    raw_text: "arrived after planning",
    raw_payload_json: "{}",
    source: "test",
    status: "valid",
  }, new Date("2026-08-11T12:01:00.000Z"));

  expect(prepare(db, plan)).toMatchObject({
    kind: "blocked",
    code: "session_evidence_plan_changed",
  });
  expect(db.query("SELECT count(*) AS n FROM ingest_jobs").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM project_session_mutation_fences").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM experience_event_tombstones").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM smc_evidence_snapshot").get()).toEqual({ n: 0 });
});

test("governing policy identity drift blocks before leasing", () => {
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  const plan = planEvidence(db);
  plan.governing_identities.policy = {
    ...plan.governing_identities.policy,
    digest: `sha256:${"0".repeat(64)}`,
  };

  expect(prepare(db, plan)).toMatchObject({
    kind: "blocked",
    code: "session_evidence_plan_changed",
  });
  expect(db.query("SELECT count(*) AS n FROM experience_event_tombstones").get()).toEqual({ n: 0 });
});
