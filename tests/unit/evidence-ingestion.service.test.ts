import { describe, expect, mock, test } from "bun:test";
import type { Transaction } from "@sequelize/core";

import type { IClaimedEvidenceBatch } from "../../src/evidence/evidence-manager.ts";
import { EvidenceIngestionService } from "../../src/evidence-ingestion/evidence-ingestion.service.ts";
import type {
  ICuratorExecutor,
  IPreparedEvidenceItem,
} from "../../src/evidence-ingestion/evidence-ingestion.types.ts";
import type { EvidenceItem } from "../../src/storage/sqlite/models/evidence-item.model.ts";
import type { SessionMemoryEntry } from "../../src/storage/sqlite/models/session-memory-entry.model.ts";
import type { WorkspaceContext } from "../../src/workspace/workspace-context.ts";

const CONFIGURATION = {
  evidenceIngestion: { batchSize: 4 },
  agents: {
    evidenceCurator: { provider: "controlled", model: "curator" },
  },
} as const;

const WORKSPACE_CONTEXT: WorkspaceContext = {
  project: { identity: 17, key: "project", rootPath: "/project" },
  workingDirectory: "/project/worktree",
  git: {
    kind: "observed",
    branchName: "feature",
    headCommitId: "abc123",
    upstream: null,
  },
};

function evidence(
  id: number,
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem {
  return {
    id,
    normalizedContent: `content ${id}`,
    speakerRole: id % 2 === 0 ? "assistant" : "user",
    nativeEventKind: `event.${id}`,
    nativeSessionReference: `session-${id}`,
    nativeInteractionReference: `interaction-${id}`,
    nativeOccurredAt: `2026-09-0${id}T00:00:00.000Z`,
    ...overrides,
  } as unknown as EvidenceItem;
}

function setup(options: {
  readonly evidence?: readonly EvidenceItem[] | null;
  readonly curatorResult?: unknown;
  readonly renews?: boolean;
  readonly publishedEntries?: readonly SessionMemoryEntry[];
}) {
  const events: string[] = [];
  const batch: IClaimedEvidenceBatch | null =
    options.evidence === null
      ? null
      : {
          attemptId: "attempt",
          evidence: options.evidence ?? [evidence(1), evidence(2)],
        };
  const transaction = {} as Transaction;
  let preparedEvidence: readonly IPreparedEvidenceItem[] | undefined;
  let executionConfiguration: unknown;
  let ownershipVerificationTransaction: Transaction | undefined;
  let completionTransaction: Transaction | undefined;
  let publication:
    | {
        readonly projectId: number;
        readonly drafts: readonly unknown[];
        readonly transaction: Transaction;
      }
    | undefined;

  const workspaceContextService = {
    resolve: mock(async () => {
      events.push("resolve");
      return { kind: "managed" as const, context: WORKSPACE_CONTEXT };
    }),
  };
  const evidenceManager = {
    CountUnavailableGitEvidence: mock(async (
      _workspaceContext: WorkspaceContext,
      captureSourceKey: string,
    ) => {
      events.push(`count:${captureSourceKey}`);
      return 3;
    }),
    ClaimEvidence: mock(async (request: { readonly captureSourceKey: string }) => {
      events.push(`claim:${request.captureSourceKey}`);
      return batch;
    }),
    RenewEvidence: mock(async () => {
      events.push("renew");
      return options.renews ?? true;
    }),
    VerifyOwnership: mock(async (
      _batch: IClaimedEvidenceBatch,
      activeTransaction: Transaction,
    ) => {
      events.push("verify");
      ownershipVerificationTransaction = activeTransaction;
      return true;
    }),
    CompleteEvidence: mock(async (
      _batch: IClaimedEvidenceBatch,
      activeTransaction: Transaction,
    ) => {
      events.push("complete");
      completionTransaction = activeTransaction;
    }),
    ReleaseEvidence: mock(async () => {
      events.push("release");
    }),
  };
  const sessionMemoryManager = {
    Publish: mock(async (
      projectId: number,
      drafts: readonly unknown[],
      activeTransaction: Transaction,
    ) => {
      events.push("publish");
      publication = { projectId, drafts, transaction: activeTransaction };
      return options.publishedEntries ?? [];
    }),
  };
  const sqliteDatabase = {
    async writeTransaction<T>(
      operation: (activeTransaction: Transaction) => Promise<T>,
    ): Promise<T> {
      events.push("transaction");
      return await operation(transaction);
    },
  };
  const curatorExecutor: ICuratorExecutor = {
    Execute: mock(async (items, configuration) => {
      events.push("execute");
      preparedEvidence = items;
      executionConfiguration = configuration;
      return options.curatorResult ?? { outcome: "completed", memories: [] };
    }),
  };

  return {
    service: new EvidenceIngestionService(
      workspaceContextService,
      evidenceManager,
      sessionMemoryManager,
      sqliteDatabase,
      CONFIGURATION,
      curatorExecutor,
    ),
    batch,
    events,
    transaction,
    getCompletionTransaction: () => completionTransaction,
    getExecutionConfiguration: () => executionConfiguration,
    getOwnershipVerificationTransaction: () =>
      ownershipVerificationTransaction,
    getPreparedEvidence: () => preparedEvidence,
    getPublication: () => publication,
  };
}

describe("EvidenceIngestionService", () => {
  test("maps the claimed batch in order and completes a zero-memory evaluation", async () => {
    const first = evidence(1, {
      nativeSessionReference: null,
      nativeOccurredAt: null,
    });
    const second = evidence(2, {
      speakerRole: null,
      nativeInteractionReference: null,
    });
    const run = setup({ evidence: [first, second] });

    await expect(
      run.service.Ingest({
        workingDirectory: "/project/worktree",
        captureSourceKey: "stored.custom-source",
      }),
    ).resolves.toEqual({
      processedEvidenceCount: 2,
      createdMemoryIds: [],
      skippedUnavailableGitEvidenceCount: 3,
    });

    expect(run.getPreparedEvidence()).toEqual([
      {
        evidenceId: 1,
        content: "content 1",
        speakerRole: "user",
        nativeEventKind: "event.1",
        nativeSessionReference: null,
        nativeInteractionReference: "interaction-1",
        nativeOccurredAt: null,
      },
      {
        evidenceId: 2,
        content: "content 2",
        speakerRole: null,
        nativeEventKind: "event.2",
        nativeSessionReference: "session-2",
        nativeInteractionReference: null,
        nativeOccurredAt: "2026-09-02T00:00:00.000Z",
      },
    ]);
    expect(run.getExecutionConfiguration()).toEqual(
      CONFIGURATION.agents.evidenceCurator,
    );
    expect(run.getOwnershipVerificationTransaction()).toBe(run.transaction);
    expect(run.getPublication()?.transaction).toBe(run.transaction);
    expect(run.getCompletionTransaction()).toBe(run.transaction);
    expect(run.events).toEqual([
      "resolve",
      "count:stored.custom-source",
      "claim:stored.custom-source",
      "execute",
      "renew",
      "transaction",
      "verify",
      "publish",
      "complete",
    ]);
  });

  test("publishes validated memory drafts and returns committed entry IDs", async () => {
    const draft = {
      content: "Durable memory",
      observedAt: "2026-09-07T12:00:00.000Z",
      evidenceIds: [2, 1],
    };
    const run = setup({
      curatorResult: { outcome: "completed", memories: [draft] },
      publishedEntries: [{ id: 81 }] as SessionMemoryEntry[],
    });

    await expect(
      run.service.Ingest({
        workingDirectory: "/project/worktree",
        captureSourceKey: "development.fixture",
      }),
    ).resolves.toMatchObject({
      processedEvidenceCount: 2,
      createdMemoryIds: [81],
    });
    expect(run.getPublication()).toMatchObject({
      projectId: 17,
      drafts: [draft],
    });
    expect(run.getPublication()?.transaction).toBe(run.transaction);
    expect(run.events.slice(-4)).toEqual([
      "transaction",
      "verify",
      "publish",
      "complete",
    ]);
  });

  test("releases the claim when curator output cannot support publication", async () => {
    const run = setup({
      curatorResult: {
        outcome: "completed",
        memories: [
          {
            content: "Unsupported memory",
            observedAt: null,
            evidenceIds: [999],
          },
        ],
      },
    });

    await expect(
      run.service.Ingest({
        workingDirectory: "/project/worktree",
        captureSourceKey: "development.fixture",
      }),
    ).rejects.toThrow("invalid memory draft");
    expect(run.events).toEqual([
      "resolve",
      "count:development.fixture",
      "claim:development.fixture",
      "execute",
      "release",
    ]);
  });

  test("does not publish after lease ownership is lost", async () => {
    const run = setup({ renews: false });

    await expect(
      run.service.Ingest({
        workingDirectory: "/project/worktree",
        captureSourceKey: "development.fixture",
      }),
    ).rejects.toThrow("ownership changed before publication");
    expect(run.events).toEqual([
      "resolve",
      "count:development.fixture",
      "claim:development.fixture",
      "execute",
      "renew",
      "release",
    ]);
  });

  test("returns the empty result when the exact source filter has no eligible rows", async () => {
    const run = setup({ evidence: null });

    await expect(
      run.service.Ingest({
        workingDirectory: "/project/worktree",
        captureSourceKey: "unknown-but-valid-filter",
      }),
    ).resolves.toEqual({
      processedEvidenceCount: 0,
      createdMemoryIds: [],
      skippedUnavailableGitEvidenceCount: 3,
    });
    expect(run.events).toEqual([
      "resolve",
      "count:unknown-but-valid-filter",
      "claim:unknown-but-valid-filter",
    ]);
  });
});
