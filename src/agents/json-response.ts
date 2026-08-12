import type { JsonObject } from "./contracts.ts";

export function parseJsonishObject(text: string): JsonObject {
  const direct = tryParseObject(text);
  if (direct) return direct;

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    const parsed = tryParseObject(match[1] ?? "");
    if (parsed) return parsed;
  }

  for (const candidate of iterBalancedJsonCandidates(text)) {
    const parsed = tryParseObject(candidate);
    if (parsed) return parsed;
  }

  JSON.parse(text);
  throw new Error("JSON payload is not an object");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tryParseObject(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function* iterBalancedJsonCandidates(text: string): Generator<string> {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{" && text[index] !== "[") continue;
    const candidate = extractBalancedJsonValue(text, index);
    if (candidate) yield candidate;
  }
}

function extractBalancedJsonValue(text: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      const opener = stack.pop();
      if ((opener === "{" && char !== "}") || (opener === "[" && char !== "]")) return null;
      if (stack.length === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}
