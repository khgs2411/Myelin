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
      const provider = this.config.embedding.provider === "auto"
        ? "ollama_nomic"
        : this.config.embedding.provider;
      return {
        client: createStubEmbeddingProvider(this.config.embedding.stubResponsesDir),
        contract: selectEmbeddingContract(this.config, provider, purpose),
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
    const nomic = createOllamaEmbeddingClient({
      provider: "ollama_nomic",
      priority: 1,
      baseUrl: this.config.embedding.ollamaUrl,
      ...this.config.embedding.providers.ollama_nomic,
      fetch: this.fetch,
    });
    const qwen = createOllamaEmbeddingClient({
      provider: "ollama_qwen",
      priority: 2,
      baseUrl: this.config.embedding.ollamaUrl,
      ...this.config.embedding.providers.ollama_qwen,
      fetch: this.fetch,
    });
    const google = createGeminiEmbeddingProvider({
      apiKey: this.config.values.GOOGLE_API_KEY ?? this.config.values.GEMINI_API_KEY,
      fetch: this.fetch,
    });
    if (this.config.embedding.provider === "ollama_nomic") return [nomic];
    if (this.config.embedding.provider === "ollama_qwen") return [qwen];
    if (this.config.embedding.provider === "gemini") return [google];
    return [nomic, qwen, google].sort((left, right) => left.priority - right.priority);
  }
}
