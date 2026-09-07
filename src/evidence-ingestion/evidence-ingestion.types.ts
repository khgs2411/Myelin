import type { CaptureSourceKey } from "../capture/capture-adapter.ts";
import type { IApplicationConfiguration } from "../application.configuration.ts";
import type { IPreparedEvidenceItem } from "../evidence/evidence.adapter.ts";
import type { ISessionMemoryDraft } from "../session-memory/session-memory-manager.ts";

export interface IEvidenceIngestionRequest {
  readonly workingDirectory: string;
  readonly captureSourceKey: CaptureSourceKey;
}

export interface IEvidenceIngestionResult {
  readonly processedEvidenceCount: number;
  readonly createdMemoryIds: readonly number[];
  readonly skippedUnavailableGitEvidenceCount: number;
}

export type EvidenceCuratorExecutionConfiguration =
  IApplicationConfiguration["agents"]["evidenceCurator"];

/**
 * Executes one complete evidence-curation evaluation.
 *
 * The returned value is untrusted at the orchestration boundary. The service
 * validates it against the claimed evidence before opening a write transaction.
 */
export interface ICuratorExecutor {
  Execute(
    preparedEvidence: readonly IPreparedEvidenceItem[],
    configuration: EvidenceCuratorExecutionConfiguration,
  ): Promise<unknown>;
}

export interface ICuratorResult {
  readonly outcome: "completed";
  readonly memories: readonly ISessionMemoryDraft[];
}
