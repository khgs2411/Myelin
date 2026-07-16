import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb, type MemoryDb } from "../../src/memory/db.ts";
import { ProjectMemoryRetrievalIndexService } from "../../src/memory/project-memory-retrieval-index-service.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";

let root: string;
let db: MemoryDb;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pm-index-service-"));
  await mkdir(join(root, "projects", "demo"), { recursive: true });
  await writeFile(
    join(root, "projects", "demo", "index.md"),
    "# Demo\n\n## Overview\n\nUseful project memory.\n",
    "utf8",
  );
  db = openMemoryDb(root);
});

afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

test("ProjectMemoryRetrievalIndexService uses only injected runtime dependencies", async () => {
  const upserts: string[] = [];
  const service = new ProjectMemoryRetrievalIndexService({
    root,
    db,
    contract: { ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, dimensions: 3 },
    provider: {
      async embed(request) {
        return { embedding: [1, 0, 0], model: request.contract.model, dimensions: 3 };
      },
    },
    vectorStore: {
      ensure: () => ({ available: true }),
      upsert: (_db, input) => upserts.push(input.retrieval_row_id),
    },
  });

  const result = await service.indexProject({
    projectKey: "demo",
    limit: 10,
    batchSize: 10,
    retryFailed: false,
  });

  expect(result.indexed).toBe(1);
  expect(upserts).toHaveLength(1);
});
