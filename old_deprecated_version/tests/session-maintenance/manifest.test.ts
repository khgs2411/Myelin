import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { readSMCManifest } from "../../src/session-maintenance/manifest.ts";
import { stableJson } from "../../src/runtime/json.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_WORKFLOW_BUDGETS,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
});

afterEach(() => db.close());

test("persists one immutable complete manifest inserted after all owned rows", () => {
  seedIndexedMemory(db, { id: "memory-1" });
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  const plan = planEvidence(db);

  const result = prepare(db, plan);
  if (result.kind !== "prepared") throw new Error(JSON.stringify(result));
  const manifest = readSMCManifest(db, plan.anchor_job_id);
  expect(manifest).toMatchObject({
    job_id: plan.anchor_job_id,
    project_key: "demo",
    owner_epoch: 1,
    compatibility_selection_limit: null,
    selected_evidence_count: 1,
    active_memory_count: 1,
    target_context: { repo_path: "/repo", git_branch: "feature/smc" },
    workflow_budgets: SMC_TEST_WORKFLOW_BUDGETS,
  });
  expect(Object.isFrozen(manifest?.workflow_budgets)).toBeTrue();
  const stored = db.query("SELECT workflow_budgets_json FROM smc_manifests WHERE job_id = ?")
    .get(plan.anchor_job_id) as { workflow_budgets_json: string };
  expect(stored.workflow_budgets_json).toBe(stableJson(SMC_TEST_WORKFLOW_BUDGETS));
  expect(manifest?.manifest_digest).toStartWith("sha256:");
  expect(manifest?.snapshot_token).toStartWith("sha256:");
  expect(() => db.query("INSERT INTO smc_manifests SELECT * FROM smc_manifests").run()).toThrow();
  expect(db.query("SELECT count(*) AS n FROM smc_retrieval_snapshot_completeness").get()).toEqual({ n: 1 });
});
