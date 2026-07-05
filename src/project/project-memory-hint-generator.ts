import { relative } from "node:path";
import type { Database } from "bun:sqlite";
import { createRunDir, timestampRunId } from "../runtime/artifacts.ts";
import type { Provider } from "../runtime/config.ts";
import { resolveInside } from "../runtime/fs.ts";
import { invokeLlm, type ProcessRunner } from "../runtime/llm-client.ts";
import { stableJson, writeJson } from "../runtime/json.ts";
import {
  markProjectMemoryHintJobCompleted,
  markProjectMemoryHintJobFailed,
  markProjectMemoryHintJobRunning,
} from "../memory/project-memory-hint-jobs.ts";
import type { ProjectMemoryMarkdownSection, ProjectMemorySectionManifest } from "./project-memory-markdown-sections.ts";
import {
  validateProjectMemoryHintFile,
  writeProjectMemoryHintFile,
  writeProjectMemoryHintStatus,
  type ProjectMemoryHintEntry,
  type ProjectMemoryHintFile,
} from "./project-memory-hints.ts";

export type ProjectMemoryHintGenerationResult = {
  status: "completed" | "failed" | "skipped";
  project_key: string;
  category: string | null;
  required: boolean;
  accepted_entries: number;
  rejected_entries: number;
  run_ref: string;
  degraded: boolean;
  degraded_reason?: string;
};

export async function generateProjectMemoryHints(input: {
  root: string;
  projectKey: string;
  category: string | null;
  manifest: ProjectMemorySectionManifest;
  sections: ProjectMemoryMarkdownSection[];
  provider?: Provider;
  model?: string;
  required?: boolean;
  refresh?: boolean;
  now?: Date;
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
  db?: Database;
  job_id?: string;
}): Promise<ProjectMemoryHintGenerationResult> {
  const now = input.now ?? new Date();
  const runId = timestampRunId(now);
  const absoluteRunDir = await createRunDir(input.root, input.projectKey, runId, "project-memory-hints");
  const runRef = relative(input.root, absoluteRunDir).replaceAll("\\", "/");
  const prompt = hintPrompt(input.projectKey, input.category, input.sections);
  await writeJson(resolveInside(absoluteRunDir, "hint-generation-prompt.json"), { schema_version: 1, prompt });
  if (input.db && input.job_id) {
    markProjectMemoryHintJobRunning(input.db, {
      id: input.job_id,
      run_ref: runRef,
      provider: input.provider,
      model: input.model,
      now: now.toISOString(),
    });
  }

  let response: unknown;
  try {
    response = (await invokeLlm({
      root: input.root,
      workload: "pipeline",
      stageId: "project-memory-hints",
      prompt,
      provider: input.provider,
      modelOverride: input.model,
      runner: input.runner,
      env: input.env,
      cwd: input.root,
    })).response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await writeJson(resolveInside(absoluteRunDir, "hint-generation-output.json"), { error: reason });
    if (input.db && input.job_id) {
      markProjectMemoryHintJobFailed(input.db, { id: input.job_id, failure_reason: reason, now: now.toISOString() });
    }
    return failedResult(input, runRef, reason);
  }

  await writeJson(resolveInside(absoluteRunDir, "hint-generation-output.json"), response);
  const hintFile = normalizeHintFile(input, response, runRef);
  if (!hintFile) {
    const reason = "hint generation output did not match ProjectMemoryHintFile";
    if (input.db && input.job_id) {
      markProjectMemoryHintJobFailed(input.db, { id: input.job_id, failure_reason: reason, now: now.toISOString() });
    }
    return failedResult(input, runRef, reason);
  }

  const validation = validateProjectMemoryHintFile(input.manifest, hintFile);
  await writeJson(resolveInside(absoluteRunDir, "hint-generation-validation.json"), validation);
  await writeProjectMemoryHintStatus(input.root, input.projectKey, validation.status_entries);
  if (validation.valid_entries.length === 0 && input.required) {
    const reason = "required hint generation produced no valid entries";
    if (input.db && input.job_id) {
      markProjectMemoryHintJobFailed(input.db, { id: input.job_id, failure_reason: reason, now: now.toISOString() });
    }
    return failedResult(input, runRef, reason, validation.status_entries.length);
  }

  const acceptedHintFile: ProjectMemoryHintFile = { ...hintFile, entries: validation.valid_entries };
  await writeProjectMemoryHintFile(input.root, acceptedHintFile);
  if (input.db && input.job_id) {
    markProjectMemoryHintJobCompleted(input.db, { id: input.job_id, run_ref: runRef, now: now.toISOString() });
  }
  return {
    status: "completed",
    project_key: input.projectKey,
    category: input.category,
    required: Boolean(input.required),
    accepted_entries: validation.valid_entries.length,
    rejected_entries: validation.status_entries.length - validation.valid_entries.length,
    run_ref: runRef,
    degraded: validation.status_entries.length !== validation.valid_entries.length,
    degraded_reason:
      validation.status_entries.length !== validation.valid_entries.length ? "some generated hints were rejected" : undefined,
  };
}

function hintPrompt(projectKey: string, category: string | null, sections: ProjectMemoryMarkdownSection[]): string {
  return [
    "You are the Project Memory retrieval hint generator.",
    "Return ONLY strict JSON.",
    "Do not write files. Do not decide canonical memory truth.",
    "Generate semantic retrieval hints for the provided canonical markdown sections.",
    "Each entry must include wiki_path, section_id, section_hash, keywords, aliases, topics, query_phrases, and confidence.",
    "",
    stableJson({
      schema_version: 1,
      project_key: projectKey,
      category,
      sections: sections.map((section) => ({
        wiki_path: section.wiki_path,
        section_id: section.section_id,
        section_hash: section.section_hash,
        page_title: section.page_title,
        heading_path: section.heading_path,
        snippet: section.snippet,
      })),
    }),
  ].join("\n");
}

function normalizeHintFile(
  input: { projectKey: string; category: string | null; provider?: Provider; model?: string },
  response: unknown,
  runRef: string,
): ProjectMemoryHintFile | null {
  if (!isRecord(response) || response.schema_version !== 1 || response.project_key !== input.projectKey) return null;
  if ((response.category ?? null) !== input.category) return null;
  if (!Array.isArray(response.entries)) return null;
  const entries: ProjectMemoryHintEntry[] = [];
  for (const entry of response.entries) {
    if (!isHintEntry(entry)) return null;
    entries.push(entry);
  }
  return {
    schema_version: 1,
    project_key: input.projectKey,
    category: input.category,
    generated_by: {
      flow: "project_memory_hint_generation",
      provider: input.provider ?? "default",
      model: input.model ?? "default",
      run_ref: runRef,
    },
    entries,
  };
}

function failedResult(
  input: { projectKey: string; category: string | null; required?: boolean },
  runRef: string,
  reason: string,
  rejectedEntries = 0,
): ProjectMemoryHintGenerationResult {
  return {
    status: "failed",
    project_key: input.projectKey,
    category: input.category,
    required: Boolean(input.required),
    accepted_entries: 0,
    rejected_entries: rejectedEntries,
    run_ref: runRef,
    degraded: true,
    degraded_reason: reason,
  };
}

function isHintEntry(value: unknown): value is ProjectMemoryHintEntry {
  return (
    isRecord(value) &&
    typeof value.wiki_path === "string" &&
    typeof value.section_id === "string" &&
    typeof value.section_hash === "string" &&
    isStringArray(value.keywords) &&
    isStringArray(value.aliases) &&
    isStringArray(value.topics) &&
    isStringArray(value.query_phrases) &&
    (value.confidence === "low" || value.confidence === "medium" || value.confidence === "high")
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
