import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { writeJson } from "../../src/runtime/json.ts";
import { StatusService } from "../../src/status/status-service.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-status-service-"));
  await writeFile(join(root, "myelin.config"), "AUTO_MEMORY_MAINTENANCE=0\nAUTO_PROJECT_MEMORY_MAINTENANCE=0\n");
  await seedProject("demo", join(root, "repos", "demo"));
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("builds a normalized contract and resolves project provenance", async () => {
  await seedDb();
  const service = new StatusService(root, { locatorPath: join(root, "machine", "install.json"), now: () => new Date("2026-07-10T12:00:00.000Z") });
  const explicit = await service.summary({ projectKey: "demo", cwd: join(root, "unrelated") });
  const inferred = await service.summary({ cwd: join(root, "repos", "demo", "src") });

  expect(explicit.project.resolved_from).toBe("argument");
  expect(inferred.project.resolved_from).toBe("cwd");
  expect(explicit.installation.lifecycle).toBe("not_installed");
  expect(explicit.session_memory.capture).toEqual({ queued_events: 0, unleased_events: 0, leased_events: 0 });
  expect(explicit.project_memory.curation.lifecycle).toBe("not_curated");
  expect(explicit.overall_state).toBe("attention");
  expect(explicit.generated_at).toBe("2026-07-10T12:00:00.000Z");
});

test("missing required SQLite produces a blocked contract without creating the database", async () => {
  const dbPath = join(root, "state", "memory", "memory.db");
  const result = await new StatusService(root, { locatorPath: join(root, "machine", "install.json") }).summary({ projectKey: "demo" });
  expect(result.overall_state).toBe("blocked");
  expect(result.warnings.filter((item) => item.code === "ROOT_SQLITE_UNAVAILABLE")).toHaveLength(2);
  expect(await Bun.file(dbPath).exists()).toBe(false);
});

test("status leaves database bytes unchanged and creates no SQLite sidecars", async () => {
  await seedDb();
  const dbPath = join(root, "state", "memory", "memory.db");
  const before = hash(await readFile(dbPath));
  const sidecarsBefore = (await readdir(join(root, "state", "memory"))).filter(isSidecar).sort();
  await new StatusService(root, { locatorPath: join(root, "machine", "install.json") }).summary({ projectKey: "demo" });
  const after = hash(await readFile(dbPath));
  const sidecarsAfter = (await readdir(join(root, "state", "memory"))).filter(isSidecar).sort();
  expect(after).toBe(before);
  expect(sidecarsAfter).toEqual(sidecarsBefore);
});

test("omitted key fails outside registered repos and rejects ambiguous mappings", async () => {
  await seedDb();
  const service = new StatusService(root, { locatorPath: join(root, "machine", "install.json") });
  await expect(service.summary({ cwd: join(root, "unrelated") })).rejects.toThrow("No project found");
  await seedProject("other", join(root, "repos", "demo"));
  await expect(service.summary({ cwd: join(root, "repos", "demo") })).rejects.toThrow("Ambiguous project");
});

async function seedDb(): Promise<void> {
  const db = openMemoryDbAt(join(root, "state", "memory", "memory.db"));
  db.close();
}

async function seedProject(key: string, repo: string): Promise<void> {
  await writeJson(join(root, "state", key, "project.json"), { key, name: key === "demo" ? "Demo" : "Other", repo_paths: [repo] });
  await mkdir(repo, { recursive: true });
}

function hash(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function isSidecar(value: string): boolean { return /memory\.db-(?:wal|shm|journal)$/.test(value); }
