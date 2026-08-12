import {
  selectEmbeddingContract,
  type ActiveEmbeddingContract,
  type EmbeddingProvider,
  type EmbeddingPurpose,
  type MyelinConfig,
} from "../runtime/config.ts";
import {
  type EmbeddingClient,
  type FetchLike,
} from "./embedding-types.ts";
import { EmbeddingService } from "./embedding-service.ts";
import { createGeminiEmbeddingProvider } from "./providers/gemini-embedding-provider.ts";
import { createNomicEmbeddingProvider } from "./providers/nomic-embedding-provider.ts";
import { createQwenEmbeddingProvider } from "./providers/qwen-embedding-provider.ts";
import { createStubEmbeddingProvider } from "./providers/stub-embedding-provider.ts";

export type ResolvedEmbeddingClient = {
  client: EmbeddingService;
  contract: ActiveEmbeddingContract;
  fallbackReason?: string;
};

export class EmbeddingProviderFactory {
  constructor(private readonly config: MyelinConfig, private readonly fetch?: FetchLike) {}

  async initialize(purpose: EmbeddingPurpose): Promise<ResolvedEmbeddingClient> {
    if (this.config.embedding.stubResponsesDir) {
      const provider = this.config.embedding.provider === "auto"
        ? "ollama_nomic"
        : this.config.embedding.provider;
      const contract = selectEmbeddingContract(this.config, provider, purpose);
      return {
        client: new EmbeddingService(contract, createStubEmbeddingProvider(this.config.embedding.stubResponsesDir)),
        contract,
      };
    }

    if (this.config.embedding.provider !== "auto") {
      return this.initializeContract(selectEmbeddingContract(this.config, this.config.embedding.provider, purpose));
    }

    return this.initializeLocalAuto(purpose);
  }

  async initializeContract(contract: ActiveEmbeddingContract): Promise<ResolvedEmbeddingClient> {
    if (this.config.embedding.stubResponsesDir) {
      return {
        client: new EmbeddingService(contract, createStubEmbeddingProvider(this.config.embedding.stubResponsesDir)),
        contract,
      };
    }
    const client = this.clientForContract(contract);
    const initialized = await client.initialize();
    if (!initialized.available) {
      throw new Error(`Active embedding provider is unavailable (${contract.provider}): ${initialized.reason}`);
    }
    return { client: new EmbeddingService(contract, client), contract };
  }

  async initializeLocalAuto(purpose: EmbeddingPurpose): Promise<ResolvedEmbeddingClient> {
    if (this.config.embedding.stubResponsesDir) {
      const contract = selectEmbeddingContract(this.config, "ollama_nomic", purpose);
      return {
        client: new EmbeddingService(contract, createStubEmbeddingProvider(this.config.embedding.stubResponsesDir)),
        contract,
      };
    }
    const candidates = this.localCandidates();
    const unavailable: string[] = [];
    for (const client of candidates) {
      const initialized = await client.initialize();
      if (initialized.available) {
        const contract = selectEmbeddingContract(this.config, client.provider, purpose);
        return {
          client: new EmbeddingService(contract, client),
          contract,
          fallbackReason: unavailable.length === 0 ? undefined : unavailable.join("; "),
        };
      }
      unavailable.push(`${client.provider}: ${initialized.reason}`);
    }
    throw new Error(`No local embedding client is available: ${unavailable.join("; ")}`);
  }

  private localCandidates(): Array<EmbeddingClient & { provider: EmbeddingProvider }> {
    const nomic = createNomicEmbeddingProvider({
      baseUrl: this.config.embedding.ollamaUrl,
      ...this.config.embedding.providers.ollama_nomic,
      fetch: this.fetch,
    });
    const qwen = createQwenEmbeddingProvider({
      baseUrl: this.config.embedding.ollamaUrl,
      ...this.config.embedding.providers.ollama_qwen,
      fetch: this.fetch,
    });
    return [nomic, qwen].sort((left, right) => left.priority - right.priority);
  }

  private clientForContract(contract: ActiveEmbeddingContract): EmbeddingClient & { provider: EmbeddingProvider } {
    if (contract.provider === "ollama_nomic") {
      return createNomicEmbeddingProvider({
        baseUrl: this.config.embedding.ollamaUrl,
        model: contract.model,
        dimensions: contract.dimensions,
        fetch: this.fetch,
      });
    }
    if (contract.provider === "ollama_qwen") {
      return createQwenEmbeddingProvider({
        baseUrl: this.config.embedding.ollamaUrl,
        model: contract.model,
        dimensions: contract.dimensions,
        fetch: this.fetch,
      });
    }
    return createGeminiEmbeddingProvider({
      apiKey: this.config.values.GOOGLE_API_KEY ?? this.config.values.GEMINI_API_KEY,
      fetch: this.fetch,
    });
  }
}
