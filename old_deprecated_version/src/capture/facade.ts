import { isAbsolute, join, relative, resolve } from "node:path";
import { openMemoryDb } from "../memory/db.ts";
import { recordExperienceEvent, recordHookError, type ExperienceStatus } from "../memory/experience.ts";
import { projectForRepoPath, type Project } from "../runtime/projects.ts";
import { readGitWorktreeContext, type GitContextRunner } from "./git-context.ts";
import { AutoMemoryMaintenanceService } from "../maintenance/auto-memory-maintenance.ts";
import type { AutoMemoryMaintenanceScheduleResult } from "../maintenance/maintenance-contracts.ts";
import type { SessionMaintenanceWakeKind } from "../maintenance/session-maintenance-eligibility.ts";
import type { ProviderInput, ProviderInputMetadata } from "../inputs/contracts.ts";

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
  | { status: "control-signaled"; project_key: string; signal_kind: "session.start" }
  | { status: "ignored"; reason: string }
  | { status: "dropped-unregistered-repo" }
  | { status: "failed-open"; error_message: string };

export type AutoMemoryMaintenanceScheduler = {
  maybeSchedule: (
    projectKey: string,
    options?: { wakeKind?: SessionMaintenanceWakeKind },
  ) => Promise<AutoMemoryMaintenanceScheduleResult>;
};

export async function handleCaptureEvent(
  root: string,
  event: NormalizedCaptureEvent,
  deps: { gitContextRunner?: GitContextRunner; maintenanceScheduler?: AutoMemoryMaintenanceScheduler } = {},
): Promise<CaptureResult> {
  return handleProviderInput(root, providerInputFromNormalizedEvent(event), deps);
}

export async function handleProviderInput(
  root: string,
  input: ProviderInput,
  deps: { gitContextRunner?: GitContextRunner; maintenanceScheduler?: AutoMemoryMaintenanceScheduler } = {},
): Promise<CaptureResult> {
  if (input.kind === "ignored") return { status: "ignored", reason: input.diagnostic.reason };

  const metadata = input.kind === "experience" ? input.event : input.signal;
  try {
    if (!metadata.cwd) return { status: "dropped-unregistered-repo" };

    const project = await projectForRepoPath(root, metadata.cwd);
    if (!project) return { status: "dropped-unregistered-repo" };

    if (input.kind === "control") {
      await scheduleAutoMemoryMaintenance(root, project.key, "session_start", deps.maintenanceScheduler);
      return { status: "control-signaled", project_key: project.key, signal_kind: input.signal.signal_kind };
    }

    const event = input.event;
    const repoPath = matchingRepoPath(project, event.cwd ?? "");
    const gitContext = await readGitWorktreeContext(repoPath, deps.gitContextRunner);

    const eventId = event.id ?? crypto.randomUUID();
    let storedEventId = eventId;
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
        status: "valid",
        repo_path: gitContext.repo_path,
        git_branch: gitContext.git_branch,
        git_commit: gitContext.git_commit,
        git_worktree_id: gitContext.git_worktree_id,
      });
      storedEventId = row?.id ?? eventId;
    } finally {
      db.close();
    }
    await scheduleAutoMemoryMaintenance(root, project.key, "capture", deps.maintenanceScheduler);
    return { status: "stored", project_key: project.key, event_id: storedEventId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackPath = join(root, "state", "hook-errors.jsonl");

    try {
      const db = openMemoryDb(root);
      try {
        recordHookError(db, fallbackPath, {
          occurred_at: new Date().toISOString(),
          provider: metadata.provider,
          source: metadata.source,
          cwd: metadata.cwd,
          hook_event_name: metadata.hook_event_name,
          error_message: message,
          raw_payload_json: metadata.raw_payload_json,
        });
      } finally {
        db.close();
      }
    } catch {
      recordHookError(null, fallbackPath, {
        occurred_at: new Date().toISOString(),
        provider: metadata.provider,
        source: metadata.source,
        cwd: metadata.cwd,
        hook_event_name: metadata.hook_event_name,
        error_message: message,
        raw_payload_json: metadata.raw_payload_json,
      });
    }

    return { status: "failed-open", error_message: message };
  }
}

function providerInputFromNormalizedEvent(event: NormalizedCaptureEvent): ProviderInput {
  const metadata: ProviderInputMetadata = {
    id: event.id,
    occurred_at: event.occurred_at,
    hook_event_name: event.hook_event_name ?? null,
    cwd: event.cwd ?? null,
    provider: event.provider,
    provider_session_id: event.provider_session_id ?? null,
    turn_id: event.turn_id ?? null,
    raw_payload_json: event.raw_payload_json,
    source: event.source,
  };

  if (event.status === "valid" && event.event_kind === "session.start") {
    return { kind: "control", signal: { ...metadata, signal_kind: "session.start" } };
  }
  if (
    event.status === "valid"
    && (event.event_kind === "user.prompt" || event.event_kind === "assistant.response")
    && typeof event.raw_text === "string"
    && event.raw_text.trim().length > 0
  ) {
    return {
      kind: "experience",
      event: { ...metadata, event_kind: event.event_kind, raw_text: event.raw_text },
    };
  }
  return {
    kind: "ignored",
    diagnostic: {
      ...metadata,
      reason: event.status === "invalid" ? "malformed-payload" : "unsupported-event",
    },
  };
}

async function scheduleAutoMemoryMaintenance(
  root: string,
  projectKey: string,
  wakeKind: SessionMaintenanceWakeKind,
  scheduler: AutoMemoryMaintenanceScheduler | undefined,
): Promise<void> {
  try {
    await (scheduler ?? new AutoMemoryMaintenanceService(root)).maybeSchedule(projectKey, { wakeKind });
  } catch {
    // Capture hooks must remain fail-open; maintenance state/logs carry operator detail.
  }
}

function matchingRepoPath(project: Project, cwd: string): string | null {
  const resolvedCwd = resolve(cwd);
  for (const repoPath of project.config.repo_paths ?? []) {
    const resolvedRepo = resolve(repoPath);
    const rel = relative(resolvedRepo, resolvedCwd);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      return repoPath;
    }
  }
  return project.config.repo_paths?.[0] ?? null;
}
