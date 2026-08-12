export type ProjectMemoryLeadSourceKind = "project_candidate" | "project_handoff" | "session_memory";
export type ProjectMemoryLeadPriority = "high" | "normal" | "low";

export function priorityForProjectMemoryLead(input: {
  source_kind: ProjectMemoryLeadSourceKind;
  confidence?: string;
  risk?: string;
}): ProjectMemoryLeadPriority {
  if (input.risk === "high") return "low";
  if (input.source_kind === "project_candidate" && input.confidence === "high") return "high";
  if (input.source_kind === "project_handoff" && input.confidence === "high") return "high";
  return "normal";
}

export function producerKindForSourceRef(ref: string): string {
  if (ref.startsWith("project_inbox:") || ref.startsWith("inbox:")) return "runtime_inbox";
  if (ref.startsWith("session_memory:")) return "session_memory";
  return "normalized";
}

export function producerKindForLead(input: { id: string; source_event_refs?: string[] }): string {
  const refs = [input.id, ...(input.source_event_refs ?? [])].filter((ref) => ref.length > 0);
  return refs.map(producerKindForSourceRef).find((kind) => kind !== "normalized") ?? "normalized";
}
