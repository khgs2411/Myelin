import type { MyelinConfig } from "../runtime/config.ts";
import {
  createGeminiEmbeddingProvider,
  createStubEmbeddingProvider,
  type EmbeddingProviderClient,
} from "./embedding-provider.ts";

export class EmbeddingProviderFactory {
  constructor(private readonly config: MyelinConfig) {}

  create(): EmbeddingProviderClient {
    if (this.config.embedding.stubResponsesDir) {
      return createStubEmbeddingProvider(this.config.embedding.stubResponsesDir);
    }
    return createGeminiEmbeddingProvider({
      apiKey: this.config.values.GOOGLE_API_KEY ?? this.config.values.GEMINI_API_KEY,
    });
  }
}
