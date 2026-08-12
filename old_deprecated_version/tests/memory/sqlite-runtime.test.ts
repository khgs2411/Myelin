import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveCustomSQLitePath, vendoredSQLitePath } from "../../src/memory/sqlite-runtime.ts";

let root: string;
let previousMyelinPath: string | undefined;
let previousSqlitePath: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-sqlite-runtime-"));
  previousMyelinPath = process.env.MYELIN_SQLITE_DYLIB_PATH;
  previousSqlitePath = process.env.SQLITE_DYLIB_PATH;
  delete process.env.MYELIN_SQLITE_DYLIB_PATH;
  delete process.env.SQLITE_DYLIB_PATH;
});

afterEach(async () => {
  restoreEnv("MYELIN_SQLITE_DYLIB_PATH", previousMyelinPath);
  restoreEnv("SQLITE_DYLIB_PATH", previousSqlitePath);
  await rm(root, { recursive: true, force: true });
});

test("custom sqlite path prefers environment over dotenv and myelin config", async () => {
  await writeFile(join(root, "myelin.config"), "MYELIN_SQLITE_DYLIB_PATH=/from/config.dylib\n", "utf8");
  await writeFile(join(root, ".env"), "MYELIN_SQLITE_DYLIB_PATH=/from/dotenv.dylib\n", "utf8");
  process.env.MYELIN_SQLITE_DYLIB_PATH = "/from/env.dylib";

  expect(resolveCustomSQLitePath(root)).toBe("/from/env.dylib");
});

test("custom sqlite path reads dotenv before myelin config", async () => {
  await writeFile(join(root, "myelin.config"), "SQLITE_DYLIB_PATH=/from/config.dylib\n", "utf8");
  await writeFile(join(root, ".env"), "SQLITE_DYLIB_PATH=/from/dotenv.dylib\n", "utf8");

  expect(resolveCustomSQLitePath(root)).toBe("/from/dotenv.dylib");
});

test("custom sqlite path uses vendored sqlite when no override is configured", () => {
  const path = resolveCustomSQLitePath(root);
  if (process.platform === "darwin" && process.arch === "arm64") {
    expect(path).toBe(vendoredSQLitePath());
  } else {
    expect(path === vendoredSQLitePath() || path === null).toBe(true);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
