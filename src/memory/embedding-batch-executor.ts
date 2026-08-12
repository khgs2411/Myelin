import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import type {
  EmbeddingProviderClient,
  EmbeddingRequest,
  EmbeddingResult,
} from "./embedding-types.ts";
import { validateEmbeddingResult } from "./embedding-validation.ts";
import { embeddingProviderFailureKind } from "./embedding-provider-errors.ts";

export async function executeEmbeddingBatches<T>(input: {
  entries: T[];
  batchSize: number;
  contract: ActiveEmbeddingContract;
  provider: EmbeddingProviderClient;
  requestFor: (entry: T) => EmbeddingRequest;
  onSuccess: (entry: T, result: EmbeddingResult) => void;
  onFailure: (entry: T, reason: string) => void;
}): Promise<number> {
  if (!Number.isInteger(input.batchSize) || input.batchSize <= 0) {
    throw new Error(`Invalid embedding batch size: ${input.batchSize}`);
  }

  let succeeded = 0;
  for (let offset = 0; offset < input.entries.length; offset += input.batchSize) {
    const batch = input.entries.slice(offset, offset + input.batchSize);
    let results: EmbeddingResult[];
    try {
      results = await input.provider.embedBatch(batch.map(input.requestFor));
      if (results.length !== batch.length) {
        throw new Error(
          `Embedding batch result count mismatch: expected ${batch.length}, got ${results.length}`,
        );
      }
      results = results.map((result) => validateEmbeddingResult(input.contract, result));
    } catch (error) {
      if (embeddingProviderFailureKind(error) === "unreachable") throw error;
      const reason = error instanceof Error ? error.message : String(error);
      for (const entry of batch) input.onFailure(entry, reason);
      continue;
    }

    for (let index = 0; index < batch.length; index += 1) {
      const entry = batch[index]!;
      try {
        input.onSuccess(entry, results[index]!);
        succeeded += 1;
      } catch (error) {
        input.onFailure(entry, error instanceof Error ? error.message : String(error));
      }
    }
  }
  return succeeded;
}
