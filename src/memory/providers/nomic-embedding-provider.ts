import type {
  EmbeddingClient,
  EmbeddingRequest,
  FetchLike,
} from "../embedding-types.ts";
import { OllamaEmbeddingTransport } from "./ollama-embedding-transport.ts";

export class NomicEmbeddingProvider implements EmbeddingClient {
  readonly provider = "ollama_nomic" as const;
  readonly priority = 1;
  private readonly transport: OllamaEmbeddingTransport;

  constructor(input: { baseUrl: string; model: string; dimensions: number; fetch?: FetchLike }) {
    this.transport = new OllamaEmbeddingTransport({
      provider: this.provider,
      ...input,
      format: formatNomicText,
    });
  }

  initialize = () => this.transport.initialize();
  embed = (request: EmbeddingRequest) => this.transport.embed(request);
  embedBatch = (requests: EmbeddingRequest[]) => this.transport.embedBatch(requests);
}

export function createNomicEmbeddingProvider(input: {
  baseUrl: string;
  model: string;
  dimensions: number;
  fetch?: FetchLike;
}): NomicEmbeddingProvider {
  return new NomicEmbeddingProvider(input);
}

function formatNomicText(request: EmbeddingRequest): string {
  const prefix = request.contract.purpose === "retrieval_query" ? "search_query" : "search_document";
  const title = request.title?.trim() ? `title: ${request.title.trim()}\n` : "";
  return `${prefix}: ${title}${request.text}`;
}
