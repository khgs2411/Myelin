import type { Database } from "bun:sqlite";
import type { SessionMemoryRow } from "./ingest-types.ts";
import type { SessionMemoryContextRow } from "./session-memory-contexts.ts";

export type SessionMemoryInspectRow = SessionMemoryRow & {
  contexts: SessionMemoryContextRow[];
};

export type SessionMemoryInspectionServiceDeps = {
  db?: Database;
};
