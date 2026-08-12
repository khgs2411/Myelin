const SAFE_PAYLOAD_KEYS = ["branch", "command", "status", "decision", "next_action", "verification", "artifact", "url"];
const MAX_SCALAR_LENGTH = 500;

export type SessionMemoryTextInput = {
  title?: string | null;
  summary: string;
  memory_kind: string;
  payload_json: string;
};

export function normalizeSessionMemoryForEmbedding(input: SessionMemoryTextInput): string {
  const lines: string[] = [];
  if (input.title?.trim()) lines.push(`title: ${input.title.trim()}`);
  lines.push(`summary: ${input.summary.trim()}`);
  lines.push(`kind: ${input.memory_kind}`);

  for (const [key, value] of safePayloadScalars(input.payload_json)) {
    lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

export function sessionMemoryNormalizedTextHash(normalizedText: string): string {
  return createHash("sha256").update(normalizedText, "utf8").digest("hex");
}

export function normalizeSessionMemorySearchQuery(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function sessionMemorySearchTokens(value: string): string[] {
  return [...new Set(
    normalizeSessionMemorySearchQuery(value)
      .split(/[^\p{L}\p{N}_./:-]+/u)
      .map((token) => token.trim())
      .filter(Boolean),
  )].sort();
}

function safePayloadScalars(payloadJson: string): Array<[string, string]> {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return [];
  }
  if (!isRecord(payload)) return [];

  const values: Array<[string, string]> = [];
  for (const key of SAFE_PAYLOAD_KEYS) {
    const value = payload[key];
    if (!isScalar(value)) continue;
    const text = String(value).trim();
    if (text === "" || text.length > MAX_SCALAR_LENGTH) continue;
    values.push([key, text]);
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
import { createHash } from "node:crypto";
