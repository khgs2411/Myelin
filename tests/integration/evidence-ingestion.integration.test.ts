import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { IngestionProcessInput } from "../support/ingestion-process.ts";

let root: string;
let databasePath: string;
const PROCESS_ENTRY = join(
  import.meta.dir,
  "..",
  "support",
  "ingestion-process.ts",
);

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "llm-wiki-ingestion-test-")));
  databasePath = join(root, "state.sqlite");
});

afterAll(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Application evidence ingestion availability", () => {
  test("keeps capture available but rejects ingestion before creating a claim", async () => {
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const input: IngestionProcessInput = { databasePath, workspace };
    const child = Bun.spawn([process.execPath, PROCESS_ENTRY], {
      cwd: root,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      receiptCount: 1,
      ingestionErrorCode: "ingestion:executor-unavailable",
      evidenceCount: 1,
      claimCount: 0,
    });
  });
});
