import { ApplicationError } from "../application-error.ts";
import type {
  EvidenceCuratorExecutionConfiguration,
  ICuratorExecutor,
} from "./evidence-ingestion.types.ts";

/**
 * Selects the explicitly configured evidence-curator execution boundary.
 *
 * Real execution adapters are not implemented yet. Configuration therefore
 * fails during ingestion composition, before evidence can be claimed.
 */
export class CuratorExecutorFactory {
  public Create(
    _configuration: EvidenceCuratorExecutionConfiguration,
  ): ICuratorExecutor {
    throw new ApplicationError("ingestion:executor-unavailable");
  }
}
