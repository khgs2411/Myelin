import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareProjectLogFile, projectLogPath } from "../../src/runtime/project-logs.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-project-logs-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("prepareProjectLogFile prunes project logs to the newest 25 entries", async () => {
  const logsDir = join(root, "projects", "demo", "logs");
  await mkdir(logsDir, { recursive: true });
  await writeFile(join(logsDir, "notes.txt"), "not a log\n", "utf8");

  for (let i = 0; i < 30; i += 1) {
    const path = join(logsDir, `old-${i.toString().padStart(2, "0")}.log`);
    await writeFile(path, `${i}\n`, "utf8");
    const time = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
    await utimes(path, time, time);
  }

  const nextLog = projectLogPath(root, "demo", "ingest-next.log");
  await prepareProjectLogFile(root, "demo", nextLog);
  await writeFile(nextLog, "next\n", "utf8");

  const entries = await readdir(logsDir);
  const logs = entries.filter((entry) => entry.endsWith(".log")).sort();
  expect(logs).toHaveLength(25);
  expect(logs).toContain("ingest-next.log");
  expect(logs).toContain("old-29.log");
  expect(logs).not.toContain("old-00.log");
  expect(entries).toContain("notes.txt");
});
