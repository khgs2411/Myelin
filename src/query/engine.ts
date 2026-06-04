import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readProjectStateIfExists } from "../runtime/state.ts";
import { schemaContextSchema } from "../schema/validators.ts";
import type { SchemaContext } from "../schema/types.ts";
import { planQuery, type QueryPlan } from "./planner.ts";

export type FacadeResponse = {
  answer: string;
  confidence: number;
  memory_scope: string;
  citations: string[];
  candidate_ids: string[];
  degraded: boolean;
  degraded_reason: string | null;
  source_tools: string[];
};

export type QueryResponse = FacadeResponse & {
  route?: QueryPlan;
};

export async function queryMemory(options: {
  root: string;
  projectKey: string;
  question: string;
  includeRoute?: boolean;
}): Promise<QueryResponse> {
  const schema = await loadValidSchemaContext(options.root, options.projectKey);
  if (!schema.ok) return degradedResponse(schema.reason);

  let plan: QueryPlan;
  try {
    plan = await planQuery({
      root: options.root,
      projectKey: options.projectKey,
      question: options.question,
      schemaContext: schema.context,
    });
  } catch (error) {
    return degradedResponse(error instanceof Error ? error.message : String(error));
  }

  const citations = plan.selected_pages.map((page) => `projects/${options.projectKey}/${page.path}`);
  const snippets = await readPageSnippets(options.root, options.projectKey, plan.selected_pages.map((page) => page.path));
  const answer =
    snippets.length > 0
      ? snippets.map((page) => `${page.title}: ${page.snippet}`).join("\n\n")
      : "No project wiki pages matched the question.";

  return {
    answer,
    confidence: plan.route_confidence,
    memory_scope: plan.memory_scope,
    citations,
    candidate_ids: [],
    degraded: false,
    degraded_reason: null,
    source_tools: ["schema-context", "query-planner", "project-wiki"],
    ...(options.includeRoute ? { route: plan } : {}),
  };
}

async function loadValidSchemaContext(
  root: string,
  projectKey: string,
): Promise<{ ok: true; context: SchemaContext } | { ok: false; reason: string }> {
  let value: unknown;
  try {
    value = await readProjectStateIfExists<unknown>(root, projectKey, "schema-context.json");
  } catch (error) {
    return { ok: false, reason: schemaProblem(error instanceof Error ? error.message : String(error)) };
  }
  if (value === null) return { ok: false, reason: schemaProblem("missing projects/<key>/state/schema-context.json") };

  const parsed = schemaContextSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `.${issue.path.join(".")}` : "";
    return { ok: false, reason: schemaProblem(`invalid schema-context.json${path}: ${issue?.message ?? "invalid value"}`) };
  }
  return { ok: true, context: parsed.data };
}

function degradedResponse(reason: string): QueryResponse {
  return {
    answer: reason,
    confidence: 0,
    memory_scope: "none",
    citations: [],
    candidate_ids: [],
    degraded: true,
    degraded_reason: reason,
    source_tools: ["schema-context"],
  };
}

function schemaProblem(detail: string): string {
  return `Memory query requires a valid schema context and failed closed: ${detail}. Run \`myelin schema build <key>\` or \`myelin schema check <key>\`.`;
}

async function readPageSnippets(
  root: string,
  projectKey: string,
  pagePaths: string[],
): Promise<{ title: string; snippet: string }[]> {
  const snippets: { title: string; snippet: string }[] = [];
  for (const pagePath of pagePaths) {
    try {
      const content = await readFile(join(root, "projects", projectKey, pagePath), "utf8");
      const snippet = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .slice(0, 3)
        .join(" ");
      snippets.push({ title: pagePath, snippet: snippet || "(empty page)" });
    } catch {
      continue;
    }
  }
  return snippets;
}
