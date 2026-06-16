import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runProjectPipeline } from "../../src/pipeline/runner.ts";
import { buildSchemaContext } from "../../src/schema/compiler.ts";
import { writeJson } from "../../src/runtime/json.ts";
import type { RunProcessOptions, RunProcessResult } from "../../src/runtime/process.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pipeline-"));
  await seedProject(root);
  await seedSchema(root);
  await seedStages(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("learn runs sense through validate, verifies schema, and stops before deferred reconcile paths", async () => {
  const result = await runProjectPipeline(root, "trygga", "learn", {
    dryRun: true,
    runner: stubRunner,
    env: { ...process.env, LLM_STUB_RESPONSES_DIR: "" },
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  expect(result.status).toBe("completed");
  expect(result.stages.map((stage) => stage.stage_id)).toEqual(["01-sense", "02-impact", "03-propose", "04-apply", "06-validate"]);
  expect(result.stages.some((stage) => stage.stage_id === "07-reconcile")).toBe(false);
  expect(result.validation.ok).toBe(true);

  await expect(readFile(join(root, "projects", "trygga", "state", "schema-context.json"), "utf8")).rejects.toThrow();
  expect(result.schema_context_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.changed_files).toContain("pipeline-result.json");
});

test("ingest runs queued-source stages with existing schema context and no auto-reconcile", async () => {
  await buildSchemaContext(root, "trygga", { builtAt: new Date("2026-06-04T11:00:00.000Z") });

  const result = await runProjectPipeline(root, "trygga", "ingest", {
    dryRun: true,
    runner: stubRunner,
    env: { ...process.env, LLM_STUB_RESPONSES_DIR: "" },
  });

  expect(result.status).toBe("completed");
  expect(result.stages.map((stage) => stage.stage_id)).toEqual(["08-ingest", "04-apply", "06-validate"]);
  expect(result.stages.some((stage) => stage.stage_id === "09-self-correct")).toBe(false);
  expect(result.validation.findings).toEqual([]);
});

test("review-risk proposals surface validate failure instead of reconciling automatically", async () => {
  await buildSchemaContext(root, "trygga");
  const result = await runProjectPipeline(root, "trygga", "learn", {
    dryRun: true,
    review: true,
    runner: stubRunner,
    env: { ...process.env, LLM_STUB_RESPONSES_DIR: "" },
  });

  expect(result.status).toBe("failed");
  expect(result.stopped_reason).toContain("requires human review");
  expect(result.stages.map((stage) => stage.stage_id)).toEqual(["01-sense", "02-impact", "03-propose", "04-apply", "06-validate"]);
});

async function seedProject(repoRoot: string): Promise<void> {
  await writeJson(join(repoRoot, "projects", "trygga", "state", "project.json"), {
    key: "trygga",
    name: "Trygga",
    repo_paths: [join(repoRoot, "repos", "trygga")],
  });
  await mkdir(join(repoRoot, "projects", "trygga", "wiki"), { recursive: true });
  await writeFile(join(repoRoot, "projects", "trygga", "index.md"), "# Trygga\n", "utf8");
}

async function seedSchema(repoRoot: string): Promise<void> {
  await mkdir(join(repoRoot, "schema", "rules"), { recursive: true });
  await writeFile(join(repoRoot, "schema", "global.md"), "Use concise project memory.\n", "utf8");
  await writeJson(join(repoRoot, "schema", "rules", "source-classification.json"), {
    rule: "source-classification",
    description: "classify sources before integration",
    required_fields: ["source_kind", "ownership", "destination", "update_targets", "action"],
    source_kind: ["spec", "unknown"],
    ownership: ["project:<project-key>", "review-required"],
    action: ["update-existing-pages", "needs-review"],
  });
  await writeJson(join(repoRoot, "schema", "rules", "memory-scopes.json"), {
    rule: "memory-scopes",
    description: "allowed memory scopes",
    scopes: [
      { key: "project_wiki", summary: "curated wiki" },
      { key: "project_state", summary: "state JSON" },
      { key: "none", summary: "degraded" },
    ],
    phase_0_active: ["project_wiki", "project_state", "none"],
    phase_0_deferred: ["none"],
  });
  await writeJson(join(repoRoot, "schema", "rules", "page-taxonomy.json"), {
    rule: "page-taxonomy",
    description: "page taxonomy",
    categories: [{ key: "current-state", summary: "current work state" }],
  });
}

async function seedStages(repoRoot: string): Promise<void> {
  for (const [id, stage] of [
    ["01-sense", "sense"],
    ["02-impact", "impact"],
    ["03-propose", "propose"],
    ["04-apply", "apply"],
    ["06-validate", "validate"],
    ["08-ingest", "ingest"],
  ]) {
    await mkdir(join(repoRoot, "stages", id), { recursive: true });
    await writeFile(join(repoRoot, "stages", id, "instructions.md"), `${stage} instructions\n`, "utf8");
    await writeJson(join(repoRoot, "stages", id, "config.json"), { stage });
  }
}

async function stubRunner(_command: string[], _options?: RunProcessOptions): Promise<RunProcessResult> {
  return {
    exitCode: 0,
    stdout: JSON.stringify({ approved: true, units: [], source_evidence: [] }),
    stderr: "",
  };
}
