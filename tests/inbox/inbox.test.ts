import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMcpAutoGapItem,
  emitLowConfidenceGap,
  inboxItemPath,
  validateInboxFilename,
  validateInboxItem,
  writeInboxItem,
} from "../../src/inbox/items.ts";
import { acquireAutoUpdateLock, autoUpdateLogPath, releaseAutoUpdateLock, spawnDetachedProjectIngest } from "../../src/inbox/auto-update.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-inbox-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("inbox filenames are filesystem-safe ids and must match the item id", () => {
  const id = "2026-04-19T19-22-14Z_a1b2c3";
  expect(validateInboxFilename(`${id}.json`)).toBe(id);
  expect(() => validateInboxFilename("2026-04-19T19:22:14Z_a1b2c3.json")).toThrow("Invalid inbox item filename");

  const item = buildMcpAutoGapItem(
    {
      projectKey: "demo",
      question: "What is stale?",
      confidence: 0.23,
      now: new Date("2026-04-19T19:22:14Z"),
    },
    id,
  );

  expect(validateInboxItem(item, `${id}.json`).id).toBe(id);
  expect(() => validateInboxItem(item, "2026-04-19T19-22-14Z_ffffff.json")).toThrow("id must match");
});

test("gap notes include every schema field so later ingest can classify them deterministically", async () => {
  const item = buildMcpAutoGapItem(
    {
      projectKey: "demo",
      question: "Where is auth documented?",
      confidence: 0.42,
      pagesRead: ["wiki/systems/auth.md"],
      pagesConsidered: 7,
      routerModel: "router",
      synthesizerModel: "synth",
      now: new Date("2026-04-19T19:22:14Z"),
    },
    "2026-04-19T19-22-14Z_a1b2c3",
  );

  const path = await writeInboxItem(root, item);
  const saved = JSON.parse(await readFile(path, "utf8"));

  expect(path).toBe(inboxItemPath(root, "demo", "2026-04-19T19-22-14Z_a1b2c3"));
  expect(Object.keys(saved).sort()).toEqual([
    "confidence",
    "emitted_at",
    "enriched_notes",
    "expected_page",
    "id",
    "measurement_run_id",
    "operator_notes",
    "pages_considered",
    "pages_read",
    "project_key",
    "question",
    "question_index",
    "question_tag",
    "router_model",
    "schema_version",
    "score_awarded",
    "score_max",
    "source",
    "synthesizer_model",
    "target_hint",
  ]);
  expect(saved.target_hint).toBe("wiki/systems/auth.md");
});

test("low-confidence query results emit a gap note and confident results stay side-effect free", async () => {
  const emitted = await emitLowConfidenceGap(root, {
    projectKey: "demo",
    question: "What changed?",
    confidence: 0.12,
    pagesRead: ["wiki/index.md"],
  });
  const skipped = await emitLowConfidenceGap(root, {
    projectKey: "demo",
    question: "What changed?",
    confidence: 0.88,
  });

  expect(emitted?.emitted).toBe(true);
  expect(emitted?.item.source).toBe("mcp-auto");
  expect(existsSync(emitted!.path)).toBe(true);
  expect(skipped).toBeNull();
});

test("auto-update lock acquire, skip, and release prevent duplicate ingest loops", async () => {
  const first = await acquireAutoUpdateLock(root, "demo", new Date("2026-06-04T12:00:00Z"));
  const second = await acquireAutoUpdateLock(root, "demo", new Date("2026-06-04T12:00:01Z"));

  expect(first.acquired).toBe(true);
  expect(second.acquired).toBe(false);
  expect(await readFile(first.lockPath, "utf8")).toContain('"project_key": "demo"');

  await first.release();
  const third = await acquireAutoUpdateLock(root, "demo", new Date("2026-06-04T12:00:02Z"));
  expect(third.acquired).toBe(true);
  await releaseAutoUpdateLock(root, "demo");
});

test("detached auto-update writes logs under the project and releases the lock", async () => {
  await writeFile(join(root, "package.json"), '{"type":"module"}', "utf8");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src", "cli.ts"),
    "console.log(`ingest ${process.argv.slice(2).join(' ')}`);",
    "utf8",
  );

  const now = new Date("2026-06-04T12:34:56.000Z");
  const result = await spawnDetachedProjectIngest(root, "demo", now);

  expect(result.status).toBe("spawned");
  expect(result.logPath).toBe(autoUpdateLogPath(root, "demo", now));

  for (let i = 0; i < 50 && existsSync(result.lockPath); i += 1) {
    await Bun.sleep(20);
  }

  expect(existsSync(result.lockPath)).toBe(false);
  expect(await readFile(result.logPath!, "utf8")).toContain("ingest demo");
});
