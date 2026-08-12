import type { NormalizedCaptureEvent } from "../facade.ts";
import { classifyCodexHookInput } from "../../inputs/providers/codex.ts";

export function normalizeCodexHookPayload(payload: unknown, occurredAt = new Date()): NormalizedCaptureEvent | null {
  const input = classifyCodexHookInput(payload, occurredAt);
  if (input.kind === "experience") return { ...input.event, status: "valid" };
  if (input.kind === "control") {
    return { ...input.signal, event_kind: input.signal.signal_kind, raw_text: null, status: "valid" };
  }
  return {
    ...input.diagnostic,
    event_kind: null,
    raw_text: null,
    status: "invalid",
  };
}
