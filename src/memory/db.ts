import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveInside } from "../runtime/fs.ts";
import { runMigrations } from "./migrations.ts";
import { configureBunSQLite } from "./sqlite-runtime.ts";

export type MemoryDb = Database;

export function memoryDbPath(root: string): string {
  return resolveInside(root, "state", "memory", "memory.db");
}

/** Open the repo-root memory DB (creates state/ if missing). Caller closes. */
export function openMemoryDb(root: string): MemoryDb {
  configureBunSQLite(root);
  return openMemoryDbAt(memoryDbPath(root));
}

/** Open at an explicit path (":memory:" or a file) — used by tests. Caller closes. */
export function openMemoryDbAt(path: string): MemoryDb {
  configureBunSQLite();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  if (path === ":memory:") return createConfiguredMemoryDb(path);

  let lastError: unknown;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      return createConfiguredMemoryDb(path);
    } catch (error) {
      if (!isDatabaseLockedError(error)) throw error;
      lastError = error;
      sleepSync(Math.min(1000, 50 * (attempt + 1)));
    }
  }

  throw lastError;
}

function createConfiguredMemoryDb(path: string): MemoryDb {
  const db = new Database(path);
  try {
    db.exec("PRAGMA busy_timeout = 10000;");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function isDatabaseLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked/i.test(message);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
