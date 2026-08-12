import type { EmbeddingProvider } from "../runtime/config.ts";

export type EmbeddingProviderFailureKind = "configuration" | "unreachable" | "provider";
export type EmbeddingProviderFailureCode =
  | "embedding_provider_configuration"
  | "embedding_provider_unreachable"
  | "embedding_provider_unavailable";

export class EmbeddingProviderInitializationError extends Error {
  readonly code: "EMBEDDING_PROVIDER_CONFIGURATION" | "EMBEDDING_PROVIDER_UNREACHABLE" | "EMBEDDING_PROVIDER_UNAVAILABLE";

  constructor(
    readonly provider: EmbeddingProvider,
    readonly failureKind: EmbeddingProviderFailureKind,
    reason: string,
  ) {
    super(initializationMessage(provider, failureKind, reason));
    this.name = "EmbeddingProviderInitializationError";
    this.code = failureKind === "configuration"
      ? "EMBEDDING_PROVIDER_CONFIGURATION"
      : failureKind === "unreachable"
      ? "EMBEDDING_PROVIDER_UNREACHABLE"
      : "EMBEDDING_PROVIDER_UNAVAILABLE";
  }
}

export class EmbeddingProviderUnreachableError extends Error {
  readonly code = "EMBEDDING_PROVIDER_UNREACHABLE" as const;

  constructor(
    readonly provider: EmbeddingProvider,
    operation: string,
    options?: { cause?: unknown },
  ) {
    super(unreachableMessage(provider, operation), options);
    this.name = "EmbeddingProviderUnreachableError";
  }
}

export function embeddingProviderFailureKind(error: unknown): EmbeddingProviderFailureKind {
  if (error instanceof EmbeddingProviderInitializationError) return error.failureKind;
  if (error instanceof EmbeddingProviderUnreachableError) return "unreachable";
  return isNetworkTransportFailure(error) ? "unreachable" : "provider";
}

export function embeddingProviderFailureCode(error: unknown): EmbeddingProviderFailureCode | undefined {
  if (error instanceof EmbeddingProviderInitializationError) {
    return error.failureKind === "configuration"
      ? "embedding_provider_configuration"
      : error.failureKind === "unreachable"
      ? "embedding_provider_unreachable"
      : "embedding_provider_unavailable";
  }
  if (error instanceof EmbeddingProviderUnreachableError || isNetworkTransportFailure(error)) {
    return "embedding_provider_unreachable";
  }
  return undefined;
}

export function wrapEmbeddingProviderTransportError(
  error: unknown,
  input: { provider: EmbeddingProvider; operation: string },
): Error {
  if (error instanceof EmbeddingProviderInitializationError || error instanceof EmbeddingProviderUnreachableError) {
    return error;
  }
  return isNetworkTransportFailure(error)
    ? new EmbeddingProviderUnreachableError(input.provider, input.operation, { cause: error })
    : error instanceof Error
    ? error
    : new Error(String(error));
}

function initializationMessage(
  provider: EmbeddingProvider,
  failureKind: EmbeddingProviderFailureKind,
  reason: string,
): string {
  if (failureKind === "unreachable") return unreachableMessage(provider, "availability check");
  if (failureKind === "configuration") {
    return `Active embedding provider is misconfigured (${provider}): ${reason}`;
  }
  return `Active embedding provider is unavailable (${provider}): ${reason}`;
}

function unreachableMessage(provider: EmbeddingProvider, operation: string): string {
  return `Embedding provider is unreachable from the current process (${provider}, ${operation}). ` +
    "Verify the provider is running and this process has network access. " +
    "When running through Codex, rerun the command with network permission.";
}

function isNetworkTransportFailure(error: unknown): boolean {
  const networkCodes = new Set([
    "FailedToOpenSocket",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
  ]);
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.code === "string" && networkCodes.has(record.code)) return true;
      current = record.cause;
      continue;
    }
    break;
  }
  return false;
}
