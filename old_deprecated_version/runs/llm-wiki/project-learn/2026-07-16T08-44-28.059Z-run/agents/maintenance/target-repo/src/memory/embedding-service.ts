import type { ActiveEmbeddingContract, EmbeddingProvider } from "../runtime/config.ts";
import type {
  EmbeddingProviderClient,
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingTransport,
} from "./embedding-types.ts";
import {
  assertEmbeddingContract,
  validateEmbeddingResult,
} from "./embedding-validation.ts";

/** Contract-bound facade used by indexing and query services. */
export class EmbeddingService implements EmbeddingProviderClient {
  readonly provider: EmbeddingProvider;

  constructor(
    readonly contract: ActiveEmbeddingContract,
    private readonly transport: EmbeddingTransport,
  ) {
    this.provider = contract.provider;
  }

  static bind(contract: ActiveEmbeddingContract, transport: EmbeddingTransport): EmbeddingService {
    return transport instanceof EmbeddingService ? transport.rebind(contract) : new EmbeddingService(contract, transport);
  }

  rebind(contract: ActiveEmbeddingContract): EmbeddingService {
    if (
      this.contract.provider !== contract.provider ||
      this.contract.model !== contract.model ||
      this.contract.dimensions !== contract.dimensions ||
      this.contract.formatVersion !== contract.formatVersion
    ) {
      throw new Error("Embedding contract is incompatible with the initialized provider");
    }
    return new EmbeddingService(contract, this.transport);
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    assertEmbeddingContract(this.contract, request.contract);
    return validateEmbeddingResult(this.contract, await this.transport.embed(request));
  }

  async embedBatch(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    for (const request of requests) assertEmbeddingContract(this.contract, request.contract);
    if (requests.length === 0) return [];
    const results = this.transport.embedBatch
      ? await this.transport.embedBatch(requests)
      : await Promise.all(requests.map((request) => this.transport.embed(request)));
    if (results.length !== requests.length) {
      throw new Error(
        `Embedding batch result count mismatch: expected ${requests.length}, got ${results.length}`,
      );
    }
    return results.map((result) => validateEmbeddingResult(this.contract, result));
  }
}
