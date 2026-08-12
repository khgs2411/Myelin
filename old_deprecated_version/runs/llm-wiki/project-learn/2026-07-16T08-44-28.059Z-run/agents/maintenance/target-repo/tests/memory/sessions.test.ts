import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  startSession, logEvent, closeSession, openSessions, recentSessions, getSession,
} from "../../src/memory/sessions.ts";

let dir: string;
let db: MemoryDb;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "myelin-sess-")); db = openMemoryDbAt(join(dir, "memory.db")); });
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });

test("full lifecycle persists rows and recall counts events", () => {
  const s = startSession(db, "trygga", "work", new Date("2026-06-04T10:00:00Z"));
  expect(s.status).toBe("open");
  logEvent(db, s.id, "note", "looked at auth", new Date("2026-06-04T10:01:00Z"));
  logEvent(db, s.id, "decision", "use sqlite", new Date("2026-06-04T10:02:00Z"));
  const closed = closeSession(db, s.id, "done", new Date("2026-06-04T10:30:00Z"));
  expect(closed.status).toBe("closed");
  expect(closed.ended_at).toBe("2026-06-04T10:30:00.000Z");

  const recent = recentSessions(db, "trygga", 5);
  expect(recent).toHaveLength(1);
  expect(recent[0].event_count).toBe(2);
  expect(recent[0].summary).toBe("done");

  const full = getSession(db, s.id);
  expect(full?.events.map((e) => e.kind)).toEqual(["note", "decision"]);
});

test("recent is newest-first, truncates to limit, and is isolated by project_key", () => {
  const a1 = startSession(db, "alpha", null, new Date("2026-06-04T09:00:00Z"));
  const a2 = startSession(db, "alpha", null, new Date("2026-06-04T11:00:00Z"));
  startSession(db, "beta", null, new Date("2026-06-04T10:00:00Z"));
  const recent = recentSessions(db, "alpha", 5);
  expect(recent.map((r) => r.id)).toEqual([a2.id, a1.id]); // newest first (deterministic)
  expect(recent.every((r) => r.project_key === "alpha")).toBe(true); // no beta leakage
  expect(recentSessions(db, "alpha", 1).map((r) => r.id)).toEqual([a2.id]); // limit truncates
});

test("openSessions returns only open sessions newest-first", () => {
  const o1 = startSession(db, "trygga", null, new Date("2026-06-04T09:00:00Z"));
  const o2 = startSession(db, "trygga", null, new Date("2026-06-04T10:00:00Z"));
  closeSession(db, o1.id, null, new Date("2026-06-04T11:00:00Z"));
  expect(openSessions(db, "trygga").map((s) => s.id)).toEqual([o2.id]);
});

test("logEvent rejects an unknown session, a closed session, and a bad kind", () => {
  const s = startSession(db, "trygga", null);
  expect(() => logEvent(db, "no-such-id", "note", "x")).toThrow("Unknown session");
  expect(() => logEvent(db, s.id, "bogus" as never, "x")).toThrow("Invalid event kind");
  closeSession(db, s.id, null);
  expect(() => logEvent(db, s.id, "note", "x")).toThrow("is closed");
});

test("closeSession rejects an already-closed session", () => {
  const s = startSession(db, "trygga", null);
  closeSession(db, s.id, null);
  expect(() => closeSession(db, s.id, null)).toThrow("already closed");
});

test("getSession returns null for an unknown id", () => {
  expect(getSession(db, "no-such-id")).toBeNull();
});
