import { readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ProjectMemoryAgentStateV2 } from "./project-memory-agent-contracts.ts";
import type {
  ProjectMemoryChangeset,
  ProjectMemoryApplyResult,
  ProjectMemorySourceConsumptionRecord,
} from "./project-memory-apply-contracts.ts";
import {
  ProjectMemoryMarkdownApplier,
  type ProjectMemoryStagedWrite,
} from "./project-memory-markdown-applier.ts";
import { resolveInside } from "../runtime/fs.ts";
import { writeJson } from "../runtime/json.ts";

export type ProjectMemoryDraftPromotionInput = {
  root: string;
  projectKey: string;
  runDir: string;
  absoluteRunDir: string;
  mode: "create" | "maintain";
  draftWikiDir: string;
  curatorOutputRef: string;
  state: ProjectMemoryAgentStateV2;
  sourceConsumptions: ProjectMemorySourceConsumptionRecord[];
};

export type ProjectMemoryDraftPromotionResult = ProjectMemoryApplyResult;

export async function promoteDraftWiki(
  input: ProjectMemoryDraftPromotionInput,
): Promise<ProjectMemoryDraftPromotionResult> {
  const markdownWrites = await draftMarkdownWrites(input.projectKey, input.draftWikiDir);
  assertDraftPublicationMinimum(markdownWrites);
  if (input.mode === "create") await removeStaleWikiMarkdown(input.root, input.projectKey, markdownWrites);
  const writes: ProjectMemoryStagedWrite[] = [
    ...markdownWrites,
    {
      canonical_project_path: `projects/${input.projectKey}/state/project-memory.json`,
      content: `${JSON.stringify(input.state, null, 2)}\n`,
      write_kind: "project_state",
    },
    {
      canonical_project_path: `projects/${input.projectKey}/state/project-memory-source-consumptions.json`,
      content: `${JSON.stringify(
        {
          schema_version: 1,
          project_key: input.projectKey,
          records: input.sourceConsumptions,
        },
        null,
        2,
      )}\n`,
      write_kind: "source_consumption_state",
    },
  ];

  const promoted = await new ProjectMemoryMarkdownApplier(input.root).promoteStagedWrites({
    project_key: input.projectKey,
    run_dir: input.runDir,
    mode: input.mode,
    absolute_run_dir: input.absoluteRunDir,
    curator_output_ref: input.curatorOutputRef,
    staged_outputs_dir: join(input.absoluteRunDir, "staged"),
    writes,
  });
  const result: ProjectMemoryApplyResult = {
    ...promoted,
    applied_page_ids: promoted.changed_files.flatMap((file) => file.page_ids),
    applied_item_ids: input.sourceConsumptions.map((record) => record.source_ref),
    source_consumptions: input.sourceConsumptions,
  };
  await writeDraftApplyArtifacts(input, result);
  return result;
}

async function removeStaleWikiMarkdown(
  root: string,
  projectKey: string,
  markdownWrites: ProjectMemoryStagedWrite[],
): Promise<void> {
  const wikiDir = join(root, "projects", projectKey, "wiki");
  const retained = new Set(markdownWrites.map((write) => write.canonical_project_path));
  for (const file of await listMarkdownFiles(wikiDir)) {
    const relativePath = relative(wikiDir, file).replaceAll("\\", "/");
    const canonicalPath = `projects/${projectKey}/wiki/${relativePath}`;
    if (!retained.has(canonicalPath)) await rm(file, { force: true });
  }
}

async function writeDraftApplyArtifacts(
  input: ProjectMemoryDraftPromotionInput,
  result: ProjectMemoryApplyResult,
): Promise<void> {
  const changeset: ProjectMemoryChangeset = {
    schema_version: 1,
    project_key: input.projectKey,
    run_dir: input.runDir,
    packet_ref: { artifact: "input-packet.json", packet_schema_version: 1 },
    curator_output_ref: input.curatorOutputRef,
    validation_ref: "curator-validation.json",
    applied_at: new Date().toISOString(),
    risk: { level: "low", reasons: [], requires_quarantine: false },
    file_changes: result.changed_files,
    page_changes: [],
    item_changes: [],
    source_consumptions: result.source_consumptions,
  };
  await writeJson(resolveInside(input.absoluteRunDir, "project-memory-apply-result.json"), result);
  await writeJson(resolveInside(input.absoluteRunDir, "project-memory-changeset.json"), changeset);
}

async function draftMarkdownWrites(
  projectKey: string,
  draftWikiDir: string,
): Promise<ProjectMemoryStagedWrite[]> {
  const files = (await listMarkdownFiles(draftWikiDir)).sort();
  return await Promise.all(files.map(async (file) => {
    const relativePath = relative(draftWikiDir, file).replaceAll("\\", "/");
    if (relativePath.startsWith("..")) throw new Error(`draft markdown escaped draft wiki: ${file}`);
    return {
      canonical_project_path: `projects/${projectKey}/wiki/${relativePath}`,
      content: await readFile(file, "utf8"),
      write_kind: "wiki_page" as const,
      page_ids: [relativePath],
    };
  }));
}

function assertDraftPublicationMinimum(writes: ProjectMemoryStagedWrite[]): void {
  const markdown = writes.filter((write) => write.write_kind === "wiki_page");
  if (!markdown.some((write) => write.canonical_project_path.endsWith("/index.md"))) {
    throw new Error("draft wiki must include index.md");
  }
  if (markdown.length < 1) throw new Error("draft wiki must include at least one markdown page");
}

async function listMarkdownFiles(path: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const next = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await listMarkdownFiles(next));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(next);
  }
  return files;
}
