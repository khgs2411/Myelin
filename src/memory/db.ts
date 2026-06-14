import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveInside } from "../runtime/fs.ts";
import { runMigrations } from "./migrations.ts";
import { configureBunSQLite } from "./sqlite-runtime.ts";

export type MemoryDb = Database;

export function memoryDbPath(root: string): string {
  return resolveInside(root, "state", "memory.db");
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
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}
