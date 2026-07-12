import type {
  EmbeddingClient,
  EmbeddingRequest,
  FetchLike,
} from "../embedding-types.ts";
import { OllamaEmbeddingTransport } from "./ollama-embedding-transport.ts";

export class QwenEmbeddingProvider implements EmbeddingClient {
  readonly provider = "ollama_qwen" as const;
  readonly priority = 2;
  private readonly transport: OllamaEmbeddingTransport;

  constructor(input: { baseUrl: string; model: string; dimensions: number; fetch?: FetchLike }) {
    this.transport = new OllamaEmbeddingTransport({
      provider: this.provider,
      ...input,
      format: formatQwenText,
    });
  }

  initialize = () => this.transport.initialize();
  embed = (request: EmbeddingRequest) => this.transport.embed(request);
  embedBatch = (requests: EmbeddingRequest[]) => this.transport.embedBatch(requests);
}

export function createQwenEmbeddingProvider(input: {
  baseUrl: string;
  model: string;
  dimensions: number;
  fetch?: FetchLike;
}): QwenEmbeddingProvider {
  return new QwenEmbeddingProvider(input);
}

function formatQwenText(request: EmbeddingRequest): string {
  if (request.contract.purpose === "retrieval_query") return `query: ${request.text}`;
  return `title: ${request.title?.trim() || "none"}\ntext: ${request.text}`;
}
