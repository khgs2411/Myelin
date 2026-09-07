import type { Transaction } from "@sequelize/core";

import type { SessionMemoryEntry } from "../storage/sqlite/models/session-memory-entry.model.ts";
import { SessionMemoryRepository } from "./session-memory.repository.ts";

export interface ISessionMemoryDraft {
  readonly content: string;
  readonly observedAt: string | null;
  readonly evidenceIds: readonly number[];
}

export class SessionMemoryManager {
  public constructor(
    private readonly sessionMemoryRepository: SessionMemoryRepository,
  ) {}

  public async Publish(
    projectId: number,
    drafts: readonly ISessionMemoryDraft[],
    transaction: Transaction,
  ): Promise<readonly SessionMemoryEntry[]> {
    return await this.sessionMemoryRepository.InsertBatch(
      projectId,
      drafts,
      transaction,
    );
  }
}
