import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "./registry.ts";
import { registerSchemaCommands } from "./schema.ts";
import { readJson, writeJson } from "../runtime/json.ts";
import type { SchemaContext } from "../schema/types.ts";

let root: string;
let previousCwd: string;

beforeEach(async () => {
  previousCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-schema-"));
  process.chdir(root);
  await seedProject();
  await seedValidSchema();
});

afterEach(async () => {
  process.chdir(previousCwd);
  await rm(root, { recursive: true, force: true });
});

test("schema build compiles global schema for a project with no project-local schema", async () => {
  const cli = createCli("myelin");
  registerSchemaCommands(cli);

  const result = await cli.run(["schema", "build", "demo"]);
  const context = await readJson<SchemaContext>(join(root, "projects", "demo", "state", "schema-context.json"));

  expect(result.exitCode).toBe(0);
  expect(context.schema_version).toBe("0");
  expect(context.inputs["schema/global.md"]).toMatch(/^[a-f0-9]{64}$/);
  expect(context.source_classification.source_kind).toContain("spec");
  expect(context.memory_scopes.phase_0_active).toEqual(["project_wiki", "project_state", "none"]);
  expect(context.page_taxonomy.categories).toContain("decisions");
  expect(context.cli_vocabulary.commands).toContain("schema build");
});

test("schema build --dry-run previews without writing generated state", async () => {
  const cli = createCli("myelin");
  registerSchemaCommands(cli);

  const result = await cli.run(["schema", "build", "demo", "--dry-run"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.message).schema_version).toBe("0");
  await expect(stat(join(root, "projects", "demo", "state", "schema-context.json"))).rejects.toThrow();
});

test("schema check validates generated context without mutating it", async () => {
  const cli = createCli("myelin");
  registerSchemaCommands(cli);
  await cli.run(["schema", "build", "demo"]);
  const contextPath = join(root, "projects", "demo", "state", "schema-context.json");
  const before = await readFile(contextPath, "utf8");

  const result = await cli.run(["schema", "check", "demo"]);
  const after = await readFile(contextPath, "utf8");

  expect(result.exitCode).toBe(0);
  expect(result.message).toBe("Schema check passed for demo.");
  expect(after).toBe(before);
});

test("schema build fails when authored global rules are invalid", async () => {
  await writeJson(join(root, "schema", "rules", "memory-scopes.json"), {
    rule: "memory-scopes",
    description: "Invalid because phase_0_active references an undeclared scope.",
    scopes: [{ key: "project_wiki", summary: "Curated project markdown wiki." }],
    phase_0_active: ["project_state"],
    phase_0_deferred: ["practice"],
  });
  const cli = createCli("myelin");
  registerSchemaCommands(cli);

  const result = await cli.run(["schema", "build", "demo"]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("phase_0 scope is not declared");
  await expect(stat(join(root, "projects", "demo", "state", "schema-context.json"))).rejects.toThrow();
});

async function seedProject(): Promise<void> {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
  });
}

async function seedValidSchema(): Promise<void> {
  await mkdir(join(root, "schema", "rules"), { recursive: true });
  await writeFile(join(root, "schema", "global.md"), "Global schema guidance.\n", "utf8");
  await writeJson(join(root, "schema", "rules", "source-classification.json"), {
    rule: "source-classification",
    description: "Source classification.",
    required_fields: ["source_kind", "ownership", "destination", "update_targets", "action"],
    source_kind: ["spec", "unknown"],
    ownership: ["project:<project-key>", "review-required"],
    action: ["update-existing-pages", "needs-review"],
  });
  await writeJson(join(root, "schema", "rules", "memory-scopes.json"), {
    rule: "memory-scopes",
    description: "Memory scopes.",
    scopes: [
      { key: "project_wiki", summary: "Curated project markdown wiki." },
      { key: "project_state", summary: "Generated project state." },
      { key: "none", summary: "No scope could be consulted." },
      { key: "practice", summary: "Canonical cross-project workflows." },
    ],
    phase_0_active: ["project_wiki", "project_state", "none"],
    phase_0_deferred: ["practice"],
  });
  await writeJson(join(root, "schema", "rules", "page-taxonomy.json"), {
    rule: "page-taxonomy",
    description: "Page taxonomy.",
    categories: [
      { key: "product-behavior", summary: "How features behave and why." },
      { key: "decisions", summary: "Durable decisions and their basis." },
    ],
  });
}
