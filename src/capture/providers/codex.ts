import type { NormalizedCaptureEvent } from "../facade.ts";

type CodexHookPayload = {
  hook_event_name?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
  cwd?: unknown;
  prompt?: unknown;
  last_assistant_message?: unknown;
  [key: string]: unknown;
};

export function normalizeCodexHookPayload(payload: unknown, occurredAt = new Date()): NormalizedCaptureEvent | null {
  const value = payload && typeof payload === "object" ? (payload as CodexHookPayload) : {};
  const rawPayload = JSON.stringify(payload ?? null);
  const base = {
    id: crypto.randomUUID(),
    occurred_at: occurredAt.toISOString(),
    hook_event_name: stringOrNull(value.hook_event_name),
    cwd: stringOrNull(value.cwd),
    provider: "codex",
    provider_session_id: stringOrNull(value.session_id),
    turn_id: stringOrNull(value.turn_id),
    raw_payload_json: rawPayload,
    source: "codex-hook",
  };

  if (value.hook_event_name === "SessionStart") {
    return { ...base, event_kind: "session.start", raw_text: null, status: "valid" };
  }

  if (value.hook_event_name === "UserPromptSubmit" && typeof value.prompt === "string") {
    return { ...base, event_kind: "user.prompt", raw_text: value.prompt, status: "valid" };
  }

  if (value.hook_event_name === "Stop") {
    if (typeof value.last_assistant_message === "string" && value.last_assistant_message.trim().length > 0) {
      return { ...base, event_kind: "assistant.response", raw_text: value.last_assistant_message, status: "valid" };
    }
    return { ...base, event_kind: null, raw_text: null, status: "invalid" };
  }

  return {
    ...base,
    event_kind: null,
    raw_text: null,
    status: "invalid",
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
