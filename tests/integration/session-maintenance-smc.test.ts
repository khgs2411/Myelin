import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb } from "../../src/memory/db.ts";
import { finalizeSessionMaintenance } from "../../src/session-maintenance/finalization-service.ts";
import { createAcceptedFinalizationContext } from "../helpers/smc-finalization.ts";

const roots: string[] = [];
afterEach(async () => { while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true }); });

test("the accepted projection has one finalizer and terminal replay is idempotent", async () => {
  const root = await temporaryRoot();
  const db = openMemoryDb(root);
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-integrated-smc" });
  const finalized = await finalizeSessionMaintenance(db, {
    jobId: context.job_id,
    ownerEpoch: context.owner_epoch,
    acceptedProjectionDigest: context.accepted.projection_digest,
    requestIndexing: async () => undefined,
  });
  expect(finalized.kind).toBe("finalized");
  db.close();

  const verified = openMemoryDb(root);
  const replay = await finalizeSessionMaintenance(verified, {
    jobId: context.job_id,
    ownerEpoch: context.owner_epoch,
    acceptedProjectionDigest: context.accepted.projection_digest,
    requestIndexing: async () => undefined,
  });
  expect(replay.kind).toBe("replayed");
  expect(verified.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(context.job_id))
    .toEqual({ phase: "completed" });
  expect(verified.query("SELECT status FROM session_memories WHERE id = 'memory-new'").get())
    .toEqual({ status: "active" });
  expect(verified.query("SELECT state FROM experience_event_tombstones WHERE ingest_job_id = ?").get(context.job_id))
    .toEqual({ state: "output" });
  expect(verified.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(verified.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  verified.close();

  for (const retired of [
    "src/session-maintenance/workflow.ts",
    "src/session-maintenance/prompt.ts",
    "src/ingest/worker-output.schema.json",
  ]) expect(await Bun.file(join(import.meta.dir, "../..", retired)).exists()).toBeFalse();
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smc-integrated-"));
  roots.push(root);
  return root;
}
