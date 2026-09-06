import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteRuntime } from "../../src/storage/sqlite/sqlite-runtime.ts";
import { SqliteDatabase } from "../../src/storage/sqlite/sqlite-database.ts";
import { Project } from "../../src/storage/sqlite/models/project.model.ts";
import { EvidenceItemRepository } from "../../src/evidence/evidence-item.repository.ts";
import type { EvidenceItemDto } from "../../src/evidence/evidence-item.dto.ts";
import type { CaptureProcessInput } from "../support/capture-process.ts";

let root: string;
let databasePath: string;
let database: SqliteDatabase;
let sql: Database;
let repository: EvidenceItemRepository;
let project: Project;
let workspace: string;
let projectNumber = 0;
const PROCESS_ENTRY = join(import.meta.dir, "..", "support", "capture-process.ts");

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "llm-wiki-capture-test-")));
  databasePath = join(root, "state.sqlite");
  database = await SqliteDatabase.open({ databasePath, runtime: await SqliteRuntime.initialize() });
  repository = new EvidenceItemRepository(database);
  // Independent SQL connection: assertions do not trust repository receipts.
  sql = new Database(databasePath, { strict: true });
  sql.exec("PRAGMA foreign_keys = ON");
});
beforeEach(async () => {
  project = await newProject();
  workspace = project.rootPath;
});
afterAll(async () => {
  sql?.close();
  await database?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

async function newProject(): Promise<Project> {
  const key = `project-${++projectNumber}`;
  const rootPath = join(root, key);
  await mkdir(rootPath);
  return Project.create({ key, rootPath, repositoryRootPath: null });
}

function item(key = "event", owner = project): EvidenceItemDto {
  return {
    captureSourceKey: "fixture.integration",
    workspaceContext: {
      project: { identity: owner.id, key: owner.key, rootPath: owner.rootPath },
      workingDirectory: owner.rootPath,
      git: { kind: "observed", branchName: "feature", headCommitId: null, upstream: null },
    },
    nativeEventKind: "fixture.input",
    nativeSessionReference: "session",
    nativeInteractionReference: key,
    nativeOccurredAt: "2026-09-05T00:00:00.000Z",
    normalizedContent: "source facts",
    replay: { scheme: "fixture/v1", key },
    sourceMaterial: { format: "bytes.v1", content: new TextEncoder().encode("abc") },
  };
}

function rows(owner = project): Record<string, unknown>[] {
  return sql.query<Record<string, unknown>, [number]>("SELECT * FROM evidence_items WHERE project_id = ? ORDER BY project_sequence").all(owner.id);
}
function sequence(owner = project): number {
  return sql.query<{ value: number }, [number]>("SELECT last_allocated_evidence_sequence AS value FROM projects WHERE id = ?").get(owner.id)!.value;
}
function native(index = 0, changes: Record<string, unknown> = {}) {
  return { fixtureReference: "application-fixture", itemIndex: index, workingDirectory: workspace, content: `content-${index}`, ...changes };
}
function start(input: Omit<CaptureProcessInput, "databasePath"> & { databasePath?: string }) {
  const child = Bun.spawn([process.execPath, PROCESS_ENTRY], {
    cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  child.stdin.write(JSON.stringify({ databasePath, ...input }));
  child.stdin.end();
  return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    .then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}
async function fixtureFile(value: unknown): Promise<string> {
  const path = join(workspace, "fixture.json");
  await writeFile(path, JSON.stringify(value));
  return path;
}
async function command(value: unknown, fault?: CaptureProcessInput["fault"]) {
  return start({ mode: "cli", args: ["dev", "capture-fixture", await fixtureFile(value)], fault });
}
function expectSafeFailure(result: Awaited<ReturnType<typeof start>>, code: string): void {
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`${code}: `);
  expect(result.stderr).not.toContain("PRIVATE_FAILURE_SENTINEL");
  expect(result.stderr).not.toMatch(/\n\s+at\s/);
}

describe("EvidenceItemRepository with real SQLite", () => {
  test("stores complete source facts and returns committed ordered identities", async () => {
    const before = Date.now();
    const receipt = await repository.insertBatch([item("first"), item("second")]);
    const stored = rows();
    expect(stored).toHaveLength(2);
    expect(receipt.map(({ projectSequence, disposition }) => [projectSequence, disposition])).toEqual([[1, "inserted"], [2, "inserted"]]);
    expect(receipt.map(({ evidenceId }) => evidenceId)).toEqual(stored.map(({ id }) => id as number));
    expect(stored[0]).toMatchObject({
      project_id: project.id, project_sequence: 1, capture_source_key: "fixture.integration",
      native_event_kind: "fixture.input", native_session_reference: "session", native_interaction_reference: "first",
      native_occurred_at: "2026-09-05T00:00:00.000Z", normalized_content: "source facts",
      working_directory: workspace, raw_source_format: "bytes.v1", replay_scheme: "fixture/v1", replay_key: "first",
      // Independently calculated SHA-256 vector for the literal bytes 'abc'.
      raw_source_digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect([...stored[0]!.raw_source_content as Uint8Array]).toEqual([97, 98, 99]);
    expect(JSON.parse(stored[0]!.workspace_context_json as string)).toEqual(item().workspaceContext);
    const received = Date.parse(stored[0]!.received_at as string);
    expect(received).toBeGreaterThanOrEqual(before);
    expect(received).toBeLessThanOrEqual(Date.now());
    expect(sequence()).toBe(2);
    expect(sql.query("SELECT typeof(raw_source_content) AS type FROM evidence_items WHERE id = ?").get(receipt[0]!.evidenceId)).toEqual({ type: "blob" });
  });

  test("preserves null content and stores omitted native facts as NULL", async () => {
    await repository.insertBatch([{
      ...item(), normalizedContent: null, nativeSessionReference: undefined,
      nativeInteractionReference: undefined, nativeOccurredAt: undefined,
    }]);
    expect(rows()[0]).toMatchObject({
      normalized_content: null, native_session_reference: null,
      native_interaction_reference: null, native_occurred_at: null,
    });
  });

  test("keeps Project identities and sequence counters independent", async () => {
    const other = await newProject();
    const first = await repository.insertBatch([item()]);
    const second = await repository.insertBatch([item("event", other)]);
    expect(first[0]!.evidenceId).not.toBe(second[0]!.evidenceId);
    expect([sequence(), sequence(other)]).toEqual([1, 1]);
    expect(rows(other)).toHaveLength(1);
  });

  test("exact replay preserves every stored field despite changed incoming derived facts", async () => {
    const receipt = await repository.insertBatch([item()]);
    const original = rows();
    const replay = await repository.insertBatch([{
      ...item(), normalizedContent: "different normalized facts", nativeOccurredAt: undefined,
      workspaceContext: { ...item().workspaceContext, git: { kind: "unavailable", safeDiagnostic: "Now unavailable" } },
    }]);
    expect(replay).toEqual([{ ...receipt[0]!, disposition: "existing" }]);
    expect(rows()).toEqual(original);
    expect(sequence()).toBe(1);
  });

  test.each(["bytes", "format"])("a replay %s conflict rolls back earlier writes and sequence changes", async (difference) => {
    await repository.insertBatch([item()]);
    const original = rows();
    const conflict = { ...item(), sourceMaterial: difference === "bytes"
      ? { format: "bytes.v1", content: new Uint8Array([9]) }
      : { ...item().sourceMaterial, format: "different.v1" } };
    await expect(repository.insertBatch([item("new-before-conflict"), conflict])).rejects.toMatchObject({ code: "capture:replay-conflict" });
    expect(rows()).toEqual(original);
    expect(sequence()).toBe(1);
    expect((await repository.insertBatch([item("after-conflict")]))[0]!.projectSequence).toBe(2);
  });

  test("a database write failure rolls back the complete transaction", async () => {
    await repository.insertBatch([item("committed")]);
    const original = rows();
    // A test-only trigger fails the second insertion inside the real transaction.
    sql.exec(`CREATE TRIGGER capture_test_failure BEFORE INSERT ON evidence_items WHEN NEW.replay_key = 'fail-write' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`);
    try {
      await expect(repository.insertBatch([item("before-failure"), item("fail-write")])).rejects.toThrow();
      expect(rows()).toEqual(original);
      expect(sequence()).toBe(1);
    } finally { sql.exec("DROP TRIGGER capture_test_failure"); }
  });

  test("deduplicates identical items within a batch and rolls back conflicting duplicates", async () => {
    const receipt = await repository.insertBatch([item(), item()]);
    expect(receipt).toEqual([
      { evidenceId: receipt[0]!.evidenceId, projectSequence: 1, disposition: "inserted" },
      { evidenceId: receipt[0]!.evidenceId, projectSequence: 1, disposition: "existing" },
    ]);
    const original = rows();
    await expect(repository.insertBatch([item("new"), { ...item("new"), sourceMaterial: { format: "bytes.v1", content: new Uint8Array([8]) } }]))
      .rejects.toMatchObject({ code: "capture:replay-conflict" });
    expect(rows()).toEqual(original);
    expect(sequence()).toBe(1);
  });

  test("each replay coordinate contributes to identity", async () => {
    const variants = [item(), { ...item(), captureSourceKey: "other.source" }, { ...item(), replay: { scheme: "other/v1", key: "event" } }, item("other-key")];
    const receipt = await repository.insertBatch(variants);
    expect(new Set(receipt.map(({ evidenceId }) => evidenceId)).size).toBe(4);
    expect(rows()).toHaveLength(4);
    expect(sequence()).toBe(4);
  });

  test("rejects empty and mixed-Project batches without changing storage", async () => {
    const other = await newProject();
    await expect(repository.insertBatch([])).rejects.toMatchObject({ code: "capture:invalid-input" });
    await expect(repository.insertBatch([item(), item("event", other)])).rejects.toMatchObject({ code: "capture:mixed-project-batch" });
    expect(rows()).toEqual([]); expect(rows(other)).toEqual([]);
    expect([sequence(), sequence(other)]).toEqual([0, 0]);
  });

  test("SQL enforces immutability, unique coordinates, and Project references", async () => {
    await repository.insertBatch([item()]);
    const row = rows()[0]!;
    expect(() => sql.query("UPDATE evidence_items SET normalized_content = 'changed' WHERE id = ?").run(row.id as number)).toThrow();
    expect(() => sql.query("DELETE FROM evidence_items WHERE id = ?").run(row.id as number)).toThrow();
    const clone = (changes: Record<string, unknown>) => {
      const { id: _id, ...values } = { ...row, ...changes };
      const columns = Object.keys(values);
      return () => sql.query(`INSERT INTO evidence_items (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
        .run(...Object.values(values) as (string | number | Uint8Array | null)[]);
    };
    expect(clone({ replay_key: "new-key" })).toThrow();
    expect(clone({ project_sequence: 2 })).toThrow();
    expect(clone({ project_id: 99999999, project_sequence: 2, replay_key: "new-key" })).toThrow();
    expect(rows()).toEqual([row]);
  });
});

describe("Application and CLI through fresh processes", () => {
  test("captures ordered native inputs using their directories instead of process cwd", async () => {
    const child = await start({ mode: "application", inputs: [native(0), native(1)] });
    expect(child.exitCode).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.receipt.map((r: { projectSequence: number }) => r.projectSequence)).toEqual([1, 2]);
    expect(rows().map((r) => r.normalized_content)).toEqual(["content-0", "content-1"]);
    expect(rows().map((r) => r.working_directory)).toEqual([workspace, workspace]);
  });

  test.each([
    { sourceKey: "unknown.source", inputs: [{}], code: "capture:unsupported-source" },
    { sourceKey: "development.fixture", inputs: [], code: "capture:invalid-input" },
  ])("rejects unsupported or invalid Application input: $code", async ({ sourceKey, inputs, code }) => {
    const child = await start({ mode: "application", sourceKey, inputs });
    expect(child.exitCode).toBe(1);
    expect(JSON.parse(child.stdout)).toMatchObject({ ok: false, code });
    expect(rows()).toEqual([]); expect(sequence()).toBe(0);
  });

  test.each(["normalization", "resolution"])("a later %s failure prevents all capture writes", async (failure) => {
    const bad = failure === "normalization" ? native(1, { content: 5 }) : native(1, { workingDirectory: join(root, "absent") });
    const child = await start({ mode: "application", inputs: [native(), bad] });
    expect(JSON.parse(child.stdout)).toMatchObject({ ok: false, code: failure === "normalization" ? "capture:invalid-input" : "capture:failed" });
    expect(rows()).toEqual([]); expect(sequence()).toBe(0);
  });

  test("Application wraps an unexpected repository failure with an internal cause", async () => {
    const child = await start({ mode: "application", inputs: [native()], fault: "repository" });
    expect(JSON.parse(child.stdout)).toEqual({ ok: false, code: "capture:failed", causeMessage: "PRIVATE_FAILURE_SENTINEL", causeName: "Error" });
    expect(rows()).toEqual([]);
  });

  test("CLI source and Project identity cannot be supplied by fixture fields", async () => {
    const input = native(0, { sourceKey: "codex.hook", projectId: 999, workspaceContext: { project: { identity: 999 } } });
    const child = await command([input]);
    expect(child.exitCode).toBe(0); expect(child.stderr).toBe("");
    const receipt = JSON.parse(child.stdout);
    expect(receipt).toEqual([{ evidenceId: rows()[0]!.id, projectSequence: 1, disposition: "inserted" }]);
    expect(rows()[0]).toMatchObject({ capture_source_key: "development.fixture", project_id: project.id });
    expect(JSON.parse(new TextDecoder().decode(rows()[0]!.raw_source_content as Uint8Array))).toEqual(input);
  });

  test("CLI replay survives process restart with original rows and sequences", async () => {
    const first = await command([native(0), native(1)]);
    const original = rows();
    const second = await command([native(0), native(1)]);
    expect(first.exitCode).toBe(0); expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout)).toEqual(JSON.parse(first.stdout).map((receipt: object) => ({ ...receipt, disposition: "existing" })));
    expect(rows()).toEqual(original); expect(sequence()).toBe(2);
  });

  test.each([null, {}, [], [{ content: "invalid" }]].map((value, index) => ({ value, index })))("CLI rejects invalid fixture shape $index", async ({ value }) => {
    const child = await command(value);
    expectSafeFailure(child, "capture:invalid-input");
    expect(child.stdout).toBe(""); expect(rows()).toEqual([]);
  });

  test("CLI handles unmanaged and mixed-Project input without partial rows", async () => {
    const unmanaged = await command([native(0), native(1, { workingDirectory: root })]);
    expectSafeFailure(unmanaged, "capture:unmanaged-workspace");
    const other = await newProject();
    const mixed = await command([native(0), native(1, { workingDirectory: other.rootPath })]);
    expectSafeFailure(mixed, "capture:mixed-project-batch");
    expect(rows()).toEqual([]); expect(rows(other)).toEqual([]);
  });

  test("CLI reports replay conflicts and preserves committed evidence", async () => {
    await command([native()]);
    const original = rows();
    const conflict = await command([native(1), native(0, { content: "conflicting" })]);
    expectSafeFailure(conflict, "capture:replay-conflict");
    expect(conflict.stdout).toBe(""); expect(rows()).toEqual(original); expect(sequence()).toBe(1);
  });

  test("CLI reports unreadable files and malformed JSON without exposing contents", async () => {
    for (const file of [join(root, "missing.json"), workspace]) {
      const child = await start({ mode: "cli", args: ["dev", "capture-fixture", file] });
      expectSafeFailure(child, "cli:fixture-read-failed"); expect(child.stdout).toBe("");
    }
    const malformed = join(workspace, "malformed.json");
    await writeFile(malformed, '{"PRIVATE_FAILURE_SENTINEL":');
    const child = await start({ mode: "cli", args: ["dev", "capture-fixture", malformed] });
    expectSafeFailure(child, "cli:fixture-parse-failed");
    expect(child.stdout).toBe(""); expect(rows()).toEqual([]);
  });

  test("CLI reports database startup failure without a capture receipt", async () => {
    const child = await start({ mode: "cli", databasePath: workspace, args: ["dev", "capture-fixture", await fixtureFile([native()])] });
    expectSafeFailure(child, "cli:startup-failed"); expect(child.stdout).toBe(""); expect(rows()).toEqual([]);
  });

  test("output failure after commit retains evidence and allows safe retry", async () => {
    const child = await command([native()], "output");
    expectSafeFailure(child, "cli:output-failed"); expect(child.stdout).toBe("");
    expect(child.stderr).toContain("Capture succeeded.");
    expect(rows()).toHaveLength(1);
    const original = rows();
    const retry = await command([native()]);
    expect(JSON.parse(retry.stdout)[0].disposition).toBe("existing"); expect(rows()).toEqual(original);
  });

  test("cleanup failure preserves a successful receipt and committed evidence", async () => {
    const child = await command([native()], "cleanup");
    expectSafeFailure(child, "cli:cleanup-failed");
    expect(JSON.parse(child.stdout)[0].evidenceId).toBe(rows()[0]!.id);
    expect(rows()).toHaveLength(1);
  });

  test("cleanup failure does not replace an earlier capture error", async () => {
    const child = await command([native(0, { content: false })], "cleanup");
    expectSafeFailure(child, "capture:invalid-input");
    expectSafeFailure(child, "cli:cleanup-failed");
    expect(child.stderr.indexOf("capture:invalid-input")).toBeLessThan(child.stderr.indexOf("cli:cleanup-failed"));
    expect(child.stdout).toBe(""); expect(rows()).toEqual([]);
  });

  test("CLI never emits internal causes or stacks from unexpected failures", async () => {
    const child = await command([native()], "repository");
    expect(child.stderr).toBe("capture:failed: The capture operation failed.\n");
    expectSafeFailure(child, "capture:failed"); expect(child.stdout).toBe("");
  });

  test("help and usage errors do not initialize the database", async () => {
    for (const args of [[], ["--help"], ["-h"]]) {
      const child = await start({ mode: "cli", args, fault: "startup" });
      expect(child.exitCode).toBe(0); expect(child.stderr).toBe(""); expect(child.stdout).toContain("dev capture-fixture");
    }
    for (const args of [["unknown"], ["dev", "capture-fixture"], ["dev", "capture-fixture", "file", "extra"]]) {
      const child = await start({ mode: "cli", args, fault: "startup" });
      expect(child.exitCode).toBe(2); expect(child.stdout).toBe(""); expect(child.stderr).not.toContain("startup-failed");
    }
  });

  test("concurrent processes preserve replay uniqueness and atomic Project sequences", async () => {
    const gatePath = join(workspace, "gate");
    const readyPaths = [join(workspace, "ready-a"), join(workspace, "ready-b")];
    const writers = readyPaths.map((readyPath, index) => start({
      mode: "application", readyPath, gatePath,
      inputs: [native(0), native(index + 1)],
    }));
    try {
      const deadline = Date.now() + 8000;
      while (!(await Promise.all(readyPaths.map((p) => Bun.file(p).exists()))).every(Boolean)) {
        if (Date.now() > deadline) throw new Error("Writers did not reach the gate");
        await Bun.sleep(10);
      }
      await writeFile(gatePath, "go");
      const results = await Promise.all(writers);
      const completed = results.map((r) => JSON.parse(r.stdout));
      expect(completed.some((r) => r.ok)).toBe(true);
      for (const [index, result] of completed.entries()) {
        if (result.ok) expect(result.receipt).toHaveLength(2);
        else {
          expect(result.code).toBe("capture:failed");
          expect(result.causeMessage).toMatch(/SQLITE_BUSY|database is locked/);
          expect(rows().some((r) => r.native_interaction_reference === String(index + 1))).toBe(false);
        }
      }
      const stored = rows();
      expect(stored.filter((r) => r.native_interaction_reference === "0")).toHaveLength(1);
      expect(stored).toHaveLength(1 + completed.filter((r) => r.ok).length);
      expect(stored.map((r) => r.project_sequence)).toEqual(Array.from({ length: stored.length }, (_, i) => i + 1));
      expect(sequence()).toBe(stored.length);
    } finally {
      await writeFile(gatePath, "go");
      await Promise.all(writers);
    }
  }, 15_000);
});
