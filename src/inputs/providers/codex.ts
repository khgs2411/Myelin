import type { InputProviderAdapter, ProviderInput, ProviderInputMetadata } from "../contracts.ts";

type CodexHookPayload = {
  hook_event_name?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
  cwd?: unknown;
  prompt?: unknown;
  last_assistant_message?: unknown;
  [key: string]: unknown;
};

export const codexInputAdapter: InputProviderAdapter = {
  classify: classifyCodexHookInput,
};

export function classifyCodexHookInput(payload: unknown, occurredAt = new Date()): ProviderInput {
  const isObject = Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
  const value = isObject ? (payload as CodexHookPayload) : {};
  const metadata: ProviderInputMetadata = {
    id: crypto.randomUUID(),
    occurred_at: occurredAt.toISOString(),
    hook_event_name: stringOrNull(value.hook_event_name),
    cwd: stringOrNull(value.cwd),
    provider: "codex",
    provider_session_id: stringOrNull(value.session_id),
    turn_id: stringOrNull(value.turn_id),
    raw_payload_json: serializePayload(payload),
    source: "codex-hook",
  };

  if (!isObject) {
    return { kind: "ignored", diagnostic: { ...metadata, reason: "malformed-payload" } };
  }

  if (value.hook_event_name === "SessionStart") {
    return { kind: "control", signal: { ...metadata, signal_kind: "session.start" } };
  }

  if (value.hook_event_name === "UserPromptSubmit") {
    if (typeof value.prompt === "string" && value.prompt.trim().length > 0) {
      return {
        kind: "experience",
        event: { ...metadata, event_kind: "user.prompt", raw_text: value.prompt },
      };
    }
    return { kind: "ignored", diagnostic: { ...metadata, reason: "empty-content" } };
  }

  if (value.hook_event_name === "Stop") {
    if (typeof value.last_assistant_message === "string" && value.last_assistant_message.trim().length > 0) {
      return {
        kind: "experience",
        event: { ...metadata, event_kind: "assistant.response", raw_text: value.last_assistant_message },
      };
    }
    return { kind: "ignored", diagnostic: { ...metadata, reason: "empty-content" } };
  }

  return { kind: "ignored", diagnostic: { ...metadata, reason: "unsupported-event" } };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function serializePayload(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? null) ?? "null";
  } catch {
    return "null";
  }
}
