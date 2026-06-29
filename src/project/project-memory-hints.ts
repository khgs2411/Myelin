import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { projectPath, resolveInside } from "../runtime/fs.ts";
import { readJsonIfExists, stableJson } from "../runtime/json.ts";
import type { ProjectMemorySectionManifest } from "./project-memory-markdown-sections.ts";

export type ProjectMemoryHintConfidence = "low" | "medium" | "high";

export type ProjectMemoryHintEntry = {
  wiki_path: string;
  section_id: string;
  section_hash: string;
  keywords: string[];
  aliases: string[];
  topics: string[];
  query_phrases: string[];
  confidence: ProjectMemoryHintConfidence;
};

export type ProjectMemoryHintFile = {
  schema_version: 1;
  project_key: string;
  category: string | null;
  generated_by: {
    flow: "project_memory_hint_generation";
    provider: string;
    model: string;
    run_ref: string;
  };
  entries: ProjectMemoryHintEntry[];
};

export type ProjectMemoryHintStatusEntry = {
  wiki_path: string;
  section_id: string;
  status: "valid" | "stale" | "orphaned" | "missing_required" | "needs_reembed" | "low_confidence";
  reason: string | null;
};

export type ProjectMemoryHintValidationResult = {
  valid_entries: ProjectMemoryHintEntry[];
  status_entries: ProjectMemoryHintStatusEntry[];
};

export type ProjectMemoryHintManifestValidation = {
  valid_entries_by_section: Map<string, ProjectMemoryHintEntry>;
  status_entries: ProjectMemoryHintStatusEntry[];
  counts: {
    valid: number;
    stale: number;
    orphaned: number;
    low_confidence: number;
  };
};

export function validateProjectMemoryHintFile(
  manifest: ProjectMemorySectionManifest,
  hintFile: ProjectMemoryHintFile,
): ProjectMemoryHintValidationResult {
  const sectionByRef = new Map(manifest.sections.map((section) => [`${section.wiki_path}#${section.section_id}`, section]));
  const valid_entries: ProjectMemoryHintEntry[] = [];
  const status_entries: ProjectMemoryHintStatusEntry[] = [];

  for (const entry of hintFile.entries) {
    const section = sectionByRef.get(`${entry.wiki_path}#${entry.section_id}`);
    if (!section) {
      status_entries.push({ wiki_path: entry.wiki_path, section_id: entry.section_id, status: "orphaned", reason: "section ref missing" });
      continue;
    }
    if (section.section_hash !== entry.section_hash) {
      status_entries.push({ wiki_path: entry.wiki_path, section_id: entry.section_id, status: "stale", reason: "section hash changed" });
      continue;
    }
    if (entry.confidence === "low") {
      status_entries.push({ wiki_path: entry.wiki_path, section_id: entry.section_id, status: "low_confidence", reason: "hint confidence is low" });
      continue;
    }
    valid_entries.push(entry);
    status_entries.push({ wiki_path: entry.wiki_path, section_id: entry.section_id, status: "valid", reason: null });
  }

  return { valid_entries, status_entries };
}

export function projectMemoryHintHash(entry: ProjectMemoryHintEntry): string {
  return `sha256:${createHash("sha256").update(stableJson(entry), "utf8").digest("hex")}`;
}

export async function writeProjectMemoryHintFile(
  root: string,
  hintFile: ProjectMemoryHintFile,
): Promise<string> {
  const relativePath = projectMemoryHintRelativePath(hintFile.project_key, hintFile.category);
  const absolutePath = resolveInside(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${stableJson(hintFile)}\n`, "utf8");
  return relativePath;
}

export async function readProjectMemoryHintFile(
  root: string,
  projectKey: string,
  category: string | null,
): Promise<ProjectMemoryHintFile | null> {
  return readJsonIfExists<ProjectMemoryHintFile>(resolveInside(root, projectMemoryHintRelativePath(projectKey, category)));
}

export async function writeProjectMemoryHintStatus(
  root: string,
  projectKey: string,
  entries: ProjectMemoryHintStatusEntry[],
): Promise<string> {
  const relativePath = `projects/${projectKey}/state/project-memory-retrieval/hint-status.json`;
  const absolutePath = resolveInside(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${stableJson({ schema_version: 1, project_key: projectKey, entries })}\n`, "utf8");
  return relativePath;
}

export async function readValidProjectMemoryHintsBySection(
  root: string,
  manifest: ProjectMemorySectionManifest,
): Promise<Map<string, ProjectMemoryHintEntry>> {
  return (await validateProjectMemoryHintsForManifest(root, manifest)).valid_entries_by_section;
}

export async function validateProjectMemoryHintsForManifest(
  root: string,
  manifest: ProjectMemorySectionManifest,
): Promise<ProjectMemoryHintManifestValidation> {
  const validEntriesBySection = new Map<string, ProjectMemoryHintEntry>();
  const statusEntries: ProjectMemoryHintStatusEntry[] = [];
  for (const hintFile of await readAllProjectMemoryHintFiles(root, manifest.project_key)) {
    const validation = validateProjectMemoryHintFile(manifest, hintFile);
    statusEntries.push(...validation.status_entries);
    for (const entry of validation.valid_entries) {
      validEntriesBySection.set(`${entry.wiki_path}#${entry.section_id}`, entry);
    }
  }
  return {
    valid_entries_by_section: validEntriesBySection,
    status_entries: statusEntries,
    counts: {
      valid: statusEntries.filter((entry) => entry.status === "valid").length,
      stale: statusEntries.filter((entry) => entry.status === "stale").length,
      orphaned: statusEntries.filter((entry) => entry.status === "orphaned").length,
      low_confidence: statusEntries.filter((entry) => entry.status === "low_confidence").length,
    },
  };
}

async function readAllProjectMemoryHintFiles(root: string, projectKey: string): Promise<ProjectMemoryHintFile[]> {
  const dir = projectPath(root, projectKey, "state", "project-memory-retrieval", "hints");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files: ProjectMemoryHintFile[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".json")) continue;
    const parsed = await readJsonIfExists<ProjectMemoryHintFile>(resolveInside(dir, entry));
    if (parsed) files.push(parsed);
  }
  return files;
}

function projectMemoryHintRelativePath(projectKey: string, category: string | null): string {
  return `projects/${projectKey}/state/project-memory-retrieval/hints/${hintCategoryFileName(category)}.json`;
}

function hintCategoryFileName(category: string | null): string {
  if (!category) return "_root";
  return category.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
