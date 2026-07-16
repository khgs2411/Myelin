import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJson } from "../../src/runtime/json.ts";
import { SchemaService } from "../../src/schema/schema-service.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-schema-service-"));
  await seedProject();
  await seedValidSchema();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("schema service builds and checks project schema context", async () => {
  const service = new SchemaService(root);

  const built = await service.build({
    projectKey: "demo",
    builtAt: new Date("2026-06-15T00:00:00.000Z"),
  });
  const checked = await service.check("demo");

  expect(built.wrote).toBe(true);
  expect(built.context.built_at).toBe("2026-06-15T00:00:00.000Z");
  expect(built.context.cli_vocabulary.commands).toContain("schema build");
  expect(checked).toEqual({ ok: true, errors: [] });
});

test("schema service dry run does not write generated state", async () => {
  const service = new SchemaService(root);

  const result = await service.build({ projectKey: "demo", dryRun: true });

  expect(result.wrote).toBe(false);
  expect(result.context.schema_version).toBe("0");
  await expect(stat(join(root, "state", "demo", "schema-context.json"))).rejects.toThrow();
});

async function seedProject(): Promise<void> {
  await writeJson(join(root, "state", "demo", "project.json"), {
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
