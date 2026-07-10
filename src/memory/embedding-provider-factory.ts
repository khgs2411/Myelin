import {
  selectEmbeddingContract,
  type ActiveEmbeddingContract,
  type EmbeddingProvider,
  type EmbeddingPurpose,
  type MyelinConfig,
} from "../runtime/config.ts";
import {
  createGeminiEmbeddingProvider,
  createOllamaEmbeddingClient,
  createStubEmbeddingProvider,
  type EmbeddingClient,
  type FetchLike,
} from "./embedding-provider.ts";

export type ResolvedEmbeddingClient = {
  client: EmbeddingClient;
  contract: ActiveEmbeddingContract;
  fallbackReason?: string;
};

export class EmbeddingProviderFactory {
  constructor(private readonly config: MyelinConfig, private readonly fetch?: FetchLike) {}

  async initialize(purpose: EmbeddingPurpose): Promise<ResolvedEmbeddingClient> {
    if (this.config.embedding.stubResponsesDir) {
      return {
        client: createStubEmbeddingProvider(this.config.embedding.stubResponsesDir),
        contract: selectEmbeddingContract(this.config, "gemini", purpose),
      };
    }

    const candidates = this.candidates();
    const unavailable: string[] = [];
    for (const client of candidates) {
      const initialized = await client.initialize();
      if (initialized.available) {
        return {
          client,
          contract: selectEmbeddingContract(this.config, client.provider, purpose),
          fallbackReason: unavailable.length === 0 ? undefined : unavailable.join("; "),
        };
      }
      unavailable.push(`${client.provider}: ${initialized.reason}`);
    }
    throw new Error(`No embedding client is available: ${unavailable.join("; ")}`);
  }

  private candidates(): Array<EmbeddingClient & { provider: EmbeddingProvider }> {
    const ollama = createOllamaEmbeddingClient({
      baseUrl: this.config.embedding.ollamaUrl,
      model: this.config.embedding.ollamaModel,
      dimensions: this.config.embedding.dimensions,
      fetch: this.fetch,
    });
    const google = createGeminiEmbeddingProvider({
      apiKey: this.config.values.GOOGLE_API_KEY ?? this.config.values.GEMINI_API_KEY,
      fetch: this.fetch,
    });
    if (this.config.embedding.provider === "ollama") return [ollama];
    if (this.config.embedding.provider === "gemini") return [google];
    return [ollama, google].sort((left, right) => left.priority - right.priority);
  }
}
