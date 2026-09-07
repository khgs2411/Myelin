import type { IPreparedEvidenceItem } from "../evidence/evidence.adapter.ts";
import type {
  EvidenceCuratorExecutionConfiguration,
  ICuratorExecutor,
  ICuratorResult,
} from "./evidence-ingestion.types.ts";

/**
 * Deterministic infrastructure curator used until a real execution transport
 * is approved and implemented.
 */
export class NoOpCurator implements ICuratorExecutor {
  public async Execute(
    _preparedEvidence: readonly IPreparedEvidenceItem[],
    _configuration: EvidenceCuratorExecutionConfiguration,
  ): Promise<ICuratorResult> {
    return { outcome: "completed", memories: [] };
  }
}
