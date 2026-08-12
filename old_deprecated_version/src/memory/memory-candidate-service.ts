import { getMemoryCandidate, listMemoryCandidates, normalizeCandidateStatus } from "./candidates.ts";
import { openMemoryDb, type MemoryDb } from "./db.ts";
import type { MemoryCandidateRow, MemoryCandidateStatus, MemoryScope } from "./ingest-types.ts";

export type ListMemoryCandidatesInput = {
  projectKey: string;
  status?: MemoryCandidateStatus;
  scope?: MemoryScope;
};

export type ListMemoryCandidatesResult = {
  project_key: string;
  candidates: MemoryCandidateRow[];
};

export type ShowMemoryCandidateResult = {
  candidate: MemoryCandidateRow;
};

export class MemoryCandidateService {
  constructor(private readonly root: string) {}

  normalizeStatus(value: string): MemoryCandidateStatus {
    return normalizeCandidateStatus(value);
  }

  list(input: ListMemoryCandidatesInput): ListMemoryCandidatesResult {
    return this.withDb((db) => ({
      project_key: input.projectKey,
      candidates: listMemoryCandidates(db, {
        project_key: input.projectKey,
        status: input.status,
        scope: input.scope,
      }),
    }));
  }

  show(id: string): ShowMemoryCandidateResult {
    return this.withDb((db) => {
      const candidate = getMemoryCandidate(db, id);
      if (!candidate) throw new Error(`Unknown memory candidate: ${id}`);
      return { candidate };
    });
  }

  private withDb<T>(fn: (db: MemoryDb) => T): T {
    const db = openMemoryDb(this.root);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }
}
