import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIngestWorker } from "../../src/ingest/worker.ts";
import { openMemoryDb } from "../../src/memory/db.ts";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

test("worker rejects every non-anchor job instead of invoking a legacy one-shot path", async () => {
  const root = await temporaryRoot();
  openMemoryDb(root).close();

  await expect(runIngestWorker({
    root,
    projectKey: "demo",
    jobId: "legacy-job",
    provider: "codex",
  })).rejects.toThrow("smc_companion_anchor_required");
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smc-worker-cutover-"));
  roots.push(root);
  return root;
}
