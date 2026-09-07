import type { Transaction } from "@sequelize/core";

import { SessionMemoryEntry } from "../storage/sqlite/models/session-memory-entry.model.ts";
import { SessionMemoryEvidence } from "../storage/sqlite/models/session-memory-evidence.model.ts";
import { SessionMemoryLifecycle } from "../storage/sqlite/models/session-memory-lifecycle.model.ts";
import type { ISessionMemoryDraft } from "./session-memory-manager.ts";

export class SessionMemoryRepository {
  public async InsertBatch(
    projectId: number,
    drafts: readonly ISessionMemoryDraft[],
    transaction: Transaction,
  ): Promise<readonly SessionMemoryEntry[]> {
    if (drafts.length === 0) {
      return [];
    }

    const entries: SessionMemoryEntry[] = [];
    for (const draft of drafts) {
      const entry = await SessionMemoryEntry.create(
        {
          projectId,
          content: draft.content,
          observedAt: draft.observedAt,
        },
        { transaction },
      );

      for (const evidenceId of draft.evidenceIds) {
        await SessionMemoryEvidence.create(
          { entryId: entry.id, evidenceId },
          { transaction },
        );
      }

      await SessionMemoryLifecycle.create(
        {
          entryId: entry.id,
          state: "active",
          reason: null,
          supersededByEntryId: null,
        },
        { transaction },
      );

      entries.push(entry);
    }

    return entries;
  }
}
