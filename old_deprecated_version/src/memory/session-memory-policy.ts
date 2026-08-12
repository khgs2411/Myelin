export const SESSION_MEMORY_CONTROL_EVENT_KINDS = ["session.start"] as const;

export function isSessionMemoryControlEventKind(value: unknown): boolean {
  return typeof value === "string"
    && (SESSION_MEMORY_CONTROL_EVENT_KINDS as readonly string[]).includes(value);
}
