import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, posix, relative } from "node:path";
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
import type { ProjectRepositoryIdentity } from "./project-repository-identity.ts";

export type ProjectMemoryDraftPromotionInput = {
  root: string;
  projectKey: string;
  runDir: string;
  absoluteRunDir: string;
  mode: "create" | "maintain";
  draftWikiDir: string;
  curatorOutputRef: string;
  state: ProjectMemoryAgentStateV2;
  repositoryIdentity?: ProjectRepositoryIdentity;
  requiredSubjectWikiPaths?: string[];
  sourceConsumptions: ProjectMemorySourceConsumptionRecord[];
};

export type ProjectMemoryDraftPromotionResult = ProjectMemoryApplyResult;

const PUBLICATION_VALIDATION_REF = "canonical-publication-validation.json";

export async function prepareDraftWikiForReview(input: {
  root: string;
  projectKey: string;
  absoluteRunDir: string;
  draftWikiDir: string;
  requiredSubjectWikiPaths?: string[];
}): Promise<void> {
  const draftWrites = await draftMarkdownWrites(input.projectKey, input.draftWikiDir);
  const canonicalIdentityPath = `state/${input.projectKey}/repository-identity.json`;
  const hasCanonicalIdentity = await Bun.file(resolveInside(input.root, canonicalIdentityPath)).exists();
  const publication = validateAndRewriteDraftMarkdown(
    input.projectKey,
    draftWrites,
    hasCanonicalIdentity,
    input.requiredSubjectWikiPaths ?? [],
  );
  assertDraftPublicationMinimum(publication.writes);
  await writeJson(resolveInside(input.absoluteRunDir, PUBLICATION_VALIDATION_REF), publication.validation);
  const wikiPrefix = `projects/${input.projectKey}/`;
  for (const write of publication.writes) {
    if (write.write_kind !== "wiki_page") continue;
    await writeFile(resolveInside(input.draftWikiDir, write.canonical_project_path.slice(wikiPrefix.length)), write.content, "utf8");
  }
}

export async function promoteDraftWiki(
  input: ProjectMemoryDraftPromotionInput,
): Promise<ProjectMemoryDraftPromotionResult> {
  const draftWrites = await draftMarkdownWrites(input.projectKey, input.draftWikiDir);
  const canonicalIdentityPath = `state/${input.projectKey}/repository-identity.json`;
  const hasCanonicalIdentity = Boolean(input.repositoryIdentity) ||
    await Bun.file(resolveInside(input.root, canonicalIdentityPath)).exists();
  let publication;
  try {
    publication = validateAndRewriteDraftMarkdown(
      input.projectKey,
      draftWrites,
      hasCanonicalIdentity,
      input.requiredSubjectWikiPaths ?? [],
    );
    await writeJson(resolveInside(input.absoluteRunDir, PUBLICATION_VALIDATION_REF), publication.validation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJson(resolveInside(input.absoluteRunDir, PUBLICATION_VALIDATION_REF), {
      schema_version: 1,
      status: "failed",
      project_key: input.projectKey,
      error: message,
    });
    throw error;
  }
  const markdownWrites = publication.writes;
  assertDraftPublicationMinimum(markdownWrites);
  if (input.mode === "create") await removeStaleWikiMarkdown(input.root, input.projectKey, markdownWrites);
  const writes: ProjectMemoryStagedWrite[] = [
    ...markdownWrites,
    ...(input.repositoryIdentity
      ? [{
          canonical_project_path: canonicalIdentityPath,
          content: `${JSON.stringify(input.repositoryIdentity, null, 2)}\n`,
          write_kind: "repository_identity_state" as const,
        }]
      : []),
    {
      canonical_project_path: `state/${input.projectKey}/project-memory.json`,
      content: `${JSON.stringify(input.state, null, 2)}\n`,
      write_kind: "project_state",
    },
    {
      canonical_project_path: `state/${input.projectKey}/project-memory-source-consumptions.json`,
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

function validateAndRewriteDraftMarkdown(
  projectKey: string,
  writes: ProjectMemoryStagedWrite[],
  hasCanonicalIdentity: boolean,
  requiredSubjectWikiPaths: string[],
): {
  writes: ProjectMemoryStagedWrite[];
  validation: {
    schema_version: 1;
    status: "passed";
    project_key: string;
    checked_pages: string[];
    checked_internal_links: number;
    rewritten_repo_citations: Array<{ page: string; original_target: string; repo_path: string }>;
    rewritten_repository_identity_links: Array<{ page: string; original_target: string; canonical_target: string }>;
  };
} {
  const wikiPrefix = `projects/${projectKey}/`;
  const pagePaths = new Set(writes
    .filter((write) => write.write_kind === "wiki_page")
    .map((write) => write.canonical_project_path.slice(wikiPrefix.length)));
  const rewrittenRepoCitations: Array<{ page: string; original_target: string; repo_path: string }> = [];
  const rewrittenRepositoryIdentityLinks: Array<{ page: string; original_target: string; canonical_target: string }> = [];
  let checkedInternalLinks = 0;
  const rewritten = writes.map((write) => {
    if (write.write_kind !== "wiki_page") return write;
    const page = write.canonical_project_path.slice(wikiPrefix.length);
    const linkedContent = write.content.replace(
      /(!?)\[([^\]\n]*)\]\((<?[^)\s>]+>?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g,
      (full, _image: string, label: string, rawTarget: string) => {
        const target = rawTarget.startsWith("<") && rawTarget.endsWith(">")
          ? rawTarget.slice(1, -1)
          : rawTarget;
        const pathOnly = target.split(/[?#]/, 1)[0];
        if (isRunLocalRepositoryIdentityTarget(pathOnly)) {
          if (!hasCanonicalIdentity) {
            throw new Error(`canonical publication found repository identity link without canonical state in ${page}: ${target}`);
          }
          const canonicalTarget = posix.relative(
            posix.dirname(posix.join("projects", projectKey, page)),
            posix.join("state", projectKey, "repository-identity.json"),
          );
          rewrittenRepositoryIdentityLinks.push({ page, original_target: target, canonical_target: canonicalTarget });
          return `${_image}[${label}](${canonicalTarget})`;
        }
        const repoPath = targetRepoPath(target);
        if (repoPath) {
          rewrittenRepoCitations.push({ page, original_target: target, repo_path: repoPath });
          const citation = `\`repo:${repoPath.replaceAll("`", "\\`")}\``;
          return label.trim() ? `${label} (${citation})` : citation;
        }
        if (isExternalOrAnchor(target)) return full;
        if (isAgentWorkspaceTarget(target)) {
          throw new Error(`canonical publication rejected agent-workspace link in ${page}: ${target}`);
        }
        if (!pathOnly.endsWith(".md")) return full;
        const resolved = posix.normalize(posix.join(posix.dirname(page), pathOnly));
        if (resolved.startsWith("../") || !pagePaths.has(resolved)) {
          throw new Error(`canonical publication found broken internal wiki link in ${page}: ${target}`);
        }
        checkedInternalLinks += 1;
        return full;
      },
    );
    const content = linkedContent.replace(
      /`(?:\.\.\/)*target-repo\/([^`\n]+)`/g,
      (_full, repoPath: string) => `\`repo:${repoPath}\``,
    );
    if (hasEphemeralMarkdownTarget(content)) {
      throw new Error(`canonical publication rejected an unsupported ephemeral link in ${page}`);
    }
    if (/(?:^|[\s(])(?:\.\.\/)*target-repo\//m.test(content)) {
      throw new Error(`canonical publication rejected an unsupported ephemeral source path in ${page}`);
    }
    return { ...write, content };
  });
  const canonicalIndex = rewritten.find((write) =>
    write.write_kind === "wiki_page" && write.canonical_project_path === `projects/${projectKey}/index.md`
  );
  if (canonicalIndex && /\b(?:planned canonical subjects|eventual pages|planning placeholders)\b/i.test(canonicalIndex.content)) {
    throw new Error("canonical publication rejected planner lifecycle language in index.md");
  }
  for (const wikiPath of requiredSubjectWikiPaths) {
    if (!pagePaths.has(wikiPath)) {
      throw new Error(`canonical publication is missing subject page: ${wikiPath}`);
    }
    if (!canonicalIndex?.content.includes(`](${wikiPath})`)) {
      throw new Error(`canonical publication index is missing subject link: ${wikiPath}`);
    }
  }
  return {
    writes: rewritten,
    validation: {
      schema_version: 1,
      status: "passed",
      project_key: projectKey,
      checked_pages: [...pagePaths].sort(),
      checked_internal_links: checkedInternalLinks,
      rewritten_repo_citations: rewrittenRepoCitations,
      rewritten_repository_identity_links: rewrittenRepositoryIdentityLinks,
    },
  };
}

function isRunLocalRepositoryIdentityTarget(target: string): boolean {
  const normalized = target.replaceAll("\\", "/");
  return posix.basename(normalized) === "repository-identity.json" &&
    !normalized.split("/").includes("state") &&
    !normalized.split("/").includes("target-repo");
}

function targetRepoPath(target: string): string | null {
  const normalized = target.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const marker = parts.lastIndexOf("target-repo");
  if (marker === -1 || marker === parts.length - 1) return null;
  return parts.slice(marker + 1).join("/");
}

function isExternalOrAnchor(target: string): boolean {
  return target.startsWith("#") || target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function isAgentWorkspaceTarget(target: string): boolean {
  const normalized = target.replaceAll("\\", "/");
  return normalized.includes("/runs/project-learn/") || normalized.split("/").includes("draft-wiki");
}

function hasEphemeralMarkdownTarget(content: string): boolean {
  const ephemeral = "(?:target-repo|draft-wiki|runs/project-learn)";
  return new RegExp(`(?:\\]\\(|^\\s*\\[[^\\]]+\\]:\\s*)<?[^\\n>]*${ephemeral}`, "im").test(content) ||
    new RegExp(`(?:href|src)=["'][^"']*${ephemeral}`, "i").test(content);
}

async function removeStaleWikiMarkdown(
  root: string,
  projectKey: string,
  markdownWrites: ProjectMemoryStagedWrite[],
): Promise<void> {
  const wikiDir = join(root, "projects", projectKey);
  const retained = new Set(markdownWrites.map((write) => write.canonical_project_path));
  for (const file of await listMarkdownFiles(wikiDir)) {
    const relativePath = relative(wikiDir, file).replaceAll("\\", "/");
    const canonicalPath = `projects/${projectKey}/${relativePath}`;
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
      canonical_project_path: `projects/${projectKey}/${relativePath}`,
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
