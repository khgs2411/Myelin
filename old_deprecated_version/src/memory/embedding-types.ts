import type { ActiveEmbeddingContract, EmbeddingProvider } from "../runtime/config.ts";

export type EmbeddingRequest = {
  contract: ActiveEmbeddingContract;
  text: string;
  title?: string | null;
};

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  dimensions: number;
};

/** The application-facing embedding port. Batch support is part of the contract. */
export interface EmbeddingProviderClient {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  embedBatch(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]>;
}

/** A provider transport. The facade supplies the default batch implementation. */
export interface EmbeddingTransport {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  embedBatch?(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]>;
}

export type EmbeddingClientInitialization =
  | { available: true }
  | {
    available: false;
    reason: string;
    failure_kind: "configuration" | "unreachable" | "provider";
  };

export interface EmbeddingClient extends EmbeddingTransport {
  readonly provider: EmbeddingProvider | "stub";
  readonly priority: number;
  initialize(): Promise<EmbeddingClientInitialization>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
