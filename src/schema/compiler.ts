import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveInside } from "../runtime/fs.ts";
import { readJson, readJsonIfExists, stableJson, writeJson } from "../runtime/json.ts";
import { findProject } from "../runtime/projects.ts";
import { statePath } from "../runtime/state.ts";
import {
  memoryScopesRuleSchema,
  pageTaxonomyRuleSchema,
  schemaContextSchema,
  sourceClassificationRuleSchema,
} from "./validators.ts";
import type { MemoryScopesRule, PageTaxonomyRule, SchemaContext, SourceClassificationRule } from "./types.ts";

export type SchemaValidationResult = {
  ok: boolean;
  errors: string[];
};

type LoadedSchema = {
  globalMarkdown: string;
  inputs: Record<string, string>;
  sourceClassification: SourceClassificationRule;
  memoryScopes: MemoryScopesRule;
  pageTaxonomy: PageTaxonomyRule;
};

const CONTEXT_FILE = "schema-context.json";
const REQUIRED_CONTEXT_COMMANDS = [
  "bootstrap",
  "project learn",
  "project ingest",
  "memory query",
  "status",
  "schema check",
  "schema build",
  "session close",
];
const REQUIRED_PROVENANCE = ["file_path_line", "commit_pointer", "source_snippet", "inference_label"];

export async function checkSchema(root: string, projectKey: string): Promise<SchemaValidationResult> {
  const errors: string[] = [];

  try {
    await findProject(root, projectKey);
    const loaded = await loadGlobalSchema(root);
    const context = await readJsonIfExists<unknown>(statePath(root, projectKey, CONTEXT_FILE));
    if (context) {
      const parsed = schemaContextSchema.safeParse(context);
      if (!parsed.success) {
        errors.push(...formatIssues(`projects/${projectKey}/state/${CONTEXT_FILE}`, parsed.error.issues));
      } else if (stableJson(parsed.data.inputs) !== stableJson(loaded.inputs)) {
        errors.push(`projects/${projectKey}/state/${CONTEXT_FILE}: inputs are stale; run schema build ${projectKey}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return { ok: errors.length === 0, errors };
}

export async function buildSchemaContext(
  root: string,
  projectKey: string,
  options: { dryRun?: boolean; builtAt?: Date } = {},
): Promise<{ context: SchemaContext; wrote: boolean; path: string }> {
  await findProject(root, projectKey);
  const loaded = await loadGlobalSchema(root);
  const contextPath = statePath(root, projectKey, CONTEXT_FILE);
  const existing = await readJsonIfExists<unknown>(contextPath);

  const existingParsed = schemaContextSchema.safeParse(existing);
  const context =
    existingParsed.success && stableJson(existingParsed.data.inputs) === stableJson(loaded.inputs)
      ? existingParsed.data
      : compileContext(loaded, options.builtAt ?? new Date());

  if (options.dryRun) return { context, wrote: false, path: contextPath };
  if (existingParsed.success && stableJson(existingParsed.data) === stableJson(context)) {
    return { context, wrote: false, path: contextPath };
  }

  await writeJson(contextPath, context);
  return { context, wrote: true, path: contextPath };
}

export async function validateSchemaContext(value: unknown): Promise<SchemaContext> {
  return schemaContextSchema.parse(value);
}

async function loadGlobalSchema(root: string): Promise<LoadedSchema> {
  const schemaRoot = resolveInside(root, "schema");
  const globalPath = join(schemaRoot, "global.md");
  const rulesRoot = join(schemaRoot, "rules");
  const globalMarkdown = await readFile(globalPath, "utf8");
  if (globalMarkdown.trim().length === 0) throw new Error("schema/global.md is empty");

  const ruleFiles = (await readdir(rulesRoot)).filter((file) => file.endsWith(".json")).sort();
  const inputs: Record<string, string> = {
    [toSchemaRelative(root, globalPath)]: sha256(globalMarkdown),
  };

  for (const file of ruleFiles) {
    const path = join(rulesRoot, file);
    inputs[toSchemaRelative(root, path)] = sha256(await readFile(path, "utf8"));
  }

  return {
    globalMarkdown,
    inputs,
    sourceClassification: parseRule(
      "schema/rules/source-classification.json",
      sourceClassificationRuleSchema,
      await readJson(join(rulesRoot, "source-classification.json")),
    ),
    memoryScopes: parseRule(
      "schema/rules/memory-scopes.json",
      memoryScopesRuleSchema,
      await readJson(join(rulesRoot, "memory-scopes.json")),
    ),
    pageTaxonomy: parseRule(
      "schema/rules/page-taxonomy.json",
      pageTaxonomyRuleSchema,
      await readJson(join(rulesRoot, "page-taxonomy.json")),
    ),
  };
}

function compileContext(loaded: LoadedSchema, builtAt: Date): SchemaContext {
  return {
    schema_version: "0",
    built_at: builtAt.toISOString(),
    inputs: loaded.inputs,
    source_classification: {
      required_fields: loaded.sourceClassification.required_fields,
      source_kind: loaded.sourceClassification.source_kind,
      ownership: loaded.sourceClassification.ownership,
      action: loaded.sourceClassification.action,
    },
    memory_scopes: {
      scopes: loaded.memoryScopes.scopes.map((scope) => scope.key),
      phase_0_active: loaded.memoryScopes.phase_0_active,
      phase_0_deferred: loaded.memoryScopes.phase_0_deferred,
    },
    page_taxonomy: {
      categories: loaded.pageTaxonomy.categories.map((category) => category.key),
    },
    provenance: {
      required: REQUIRED_PROVENANCE,
    },
    cli_vocabulary: {
      commands: REQUIRED_CONTEXT_COMMANDS,
    },
  };
}

function parseRule<T>(label: string, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(`${label}: ${formatIssues("", parsed.error.issues).join("; ")}`);
}

function formatIssues(label: string, issues: unknown[]): string[] {
  return issues.map((issue) => {
    const item = issue as { path?: (string | number)[]; message?: string };
    const path = item.path?.length ? `.${item.path.join(".")}` : "";
    return `${label}${path}: ${item.message ?? "invalid value"}`;
  });
}

function toSchemaRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
