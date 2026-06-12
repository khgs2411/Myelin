import { join } from "node:path";
import { openMemoryDb } from "../memory/db.ts";
import { recordExperienceEvent, recordHookError, type ExperienceStatus } from "../memory/experience.ts";
import { projectForRepoPath } from "../runtime/projects.ts";

export type NormalizedCaptureEvent = {
  id?: string;
  occurred_at?: string;
  hook_event_name?: string | null;
  event_kind?: string | null;
  cwd?: string | null;
  provider: string;
  provider_session_id?: string | null;
  turn_id?: string | null;
  raw_text?: string | null;
  raw_payload_json: string;
  source: string;
  status: ExperienceStatus;
};

export type CaptureResult =
  | { status: "stored"; project_key: string; event_id: string }
  | { status: "dropped-unregistered-repo" }
  | { status: "failed-open"; error_message: string };

export async function handleCaptureEvent(root: string, event: NormalizedCaptureEvent): Promise<CaptureResult> {
  try {
    if (!event.cwd) return { status: "dropped-unregistered-repo" };

    const project = await projectForRepoPath(root, event.cwd);
    if (!project) return { status: "dropped-unregistered-repo" };

    const eventId = event.id ?? crypto.randomUUID();
    const db = openMemoryDb(root);
    try {
      const row = recordExperienceEvent(db, {
        id: eventId,
        project_key: project.key,
        occurred_at: event.occurred_at ?? new Date().toISOString(),
        hook_event_name: event.hook_event_name ?? null,
        event_kind: event.event_kind ?? null,
        cwd: event.cwd,
        provider: event.provider,
        provider_session_id: event.provider_session_id ?? null,
        turn_id: event.turn_id ?? null,
        raw_text: event.raw_text ?? null,
        raw_payload_json: event.raw_payload_json,
        source: event.source,
        status: event.status,
      });

      return { status: "stored", project_key: project.key, event_id: row?.id ?? eventId };
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackPath = join(root, "state", "hook-errors.jsonl");

    try {
      const db = openMemoryDb(root);
      try {
        recordHookError(db, fallbackPath, {
          occurred_at: new Date().toISOString(),
          provider: event.provider,
          source: event.source,
          cwd: event.cwd ?? null,
          hook_event_name: event.hook_event_name ?? null,
          error_message: message,
          raw_payload_json: event.raw_payload_json,
        });
      } finally {
        db.close();
      }
    } catch {
      recordHookError(null, fallbackPath, {
        occurred_at: new Date().toISOString(),
        provider: event.provider,
        source: event.source,
        cwd: event.cwd ?? null,
        hook_event_name: event.hook_event_name ?? null,
        error_message: message,
        raw_payload_json: event.raw_payload_json,
      });
    }

    return { status: "failed-open", error_message: message };
  }
}
