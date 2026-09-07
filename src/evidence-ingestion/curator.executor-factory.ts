import { ApplicationError } from "../application-error.ts";
import { NoOpCurator } from "./curator.no-op.ts";
import type {
  EvidenceCuratorExecutionConfiguration,
  ICuratorExecutor,
} from "./evidence-ingestion.types.ts";

const DEVELOPMENT_NO_OP_PROVIDER = "development.no-op";
const NO_OP_MODEL = "no-op";

/**
 * Selects the explicitly configured evidence-curator execution boundary.
 *
 * Real execution adapters are not implemented yet. Every configuration other
 * than the deliberate development no-op therefore fails during composition,
 * before ingestion can claim evidence.
 */
export class CuratorExecutorFactory {
  public Create(
    configuration: EvidenceCuratorExecutionConfiguration,
  ): ICuratorExecutor {
    if (
      configuration.provider === DEVELOPMENT_NO_OP_PROVIDER &&
      configuration.model === NO_OP_MODEL
    ) {
      return new NoOpCurator();
    }

    throw new ApplicationError("ingestion:executor-unavailable");
  }
}
