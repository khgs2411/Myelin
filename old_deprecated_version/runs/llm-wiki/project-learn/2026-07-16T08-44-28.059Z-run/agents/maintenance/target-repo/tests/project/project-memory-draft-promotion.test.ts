import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  promoteDraftWiki,
  type ProjectMemoryDraftPromotionInput,
} from "../../src/project/project-memory-draft-promotion.ts";

describe("promoteDraftWiki", () => {
  test("promotes draft markdown and v2 state through the apply journal", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-1");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(join(draftWiki, "index.md"), "# Demo\n\n- [Runtime](runtime.md)\n", "utf8");
    await writeFile(
      join(draftWiki, "runtime.md"),
      "# Runtime\n\nHow the runtime works. [Source](../target-repo/src/runtime.ts#L2). Regression: `target-repo/tests/runtime.test.ts`.\n",
      "utf8",
    );

    const result = await promoteDraftWiki(validInput(root, runDir, draftWiki));

    expect(result.status).toBe("applied");
    expect(await readFile(join(root, "projects", "demo", "index.md"), "utf8")).toContain("# Demo");
    const runtime = await readFile(join(root, "projects", "demo", "runtime.md"), "utf8");
    expect(runtime).toContain("Source (`repo:src/runtime.ts#L2`)");
    expect(runtime).toContain("`repo:tests/runtime.test.ts`");
    expect(runtime).not.toContain("target-repo");
    const publication = JSON.parse(await readFile(join(runDir, "canonical-publication-validation.json"), "utf8"));
    expect(publication).toMatchObject({ status: "passed", checked_internal_links: 1 });
    expect(publication.rewritten_repo_citations).toHaveLength(1);
    const state = JSON.parse(await readFile(join(root, "state", "demo", "project-memory.json"), "utf8"));
    expect(state.schema_version).toBe(2);
    expect(state.content_quality.status).toBe("not_evaluated");
    expect(await readFile(join(runDir, "project-memory-apply-result.json"), "utf8")).toContain('"status": "applied"');
    expect(await readFile(join(runDir, "project-memory-changeset.json"), "utf8")).toContain('"schema_version": 1');
  });

  test("rejects a draft without index markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-2");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(join(draftWiki, "runtime.md"), "# Runtime\n", "utf8");

    await expect(promoteDraftWiki(validInput(root, runDir, draftWiki))).rejects.toThrow("draft wiki must include index.md");
  });

  test("promotes nested markdown paths inside the draft wiki", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-3");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(join(draftWiki, "nested"), { recursive: true });
    await writeFile(join(draftWiki, "index.md"), "# Demo\n", "utf8");
    await writeFile(join(draftWiki, "nested", "topic.md"), "# Topic\n", "utf8");

    const result = await promoteDraftWiki(validInput(root, runDir, draftWiki));
    expect(result.changed_files.map((file) => file.path)).toContain("projects/demo/nested/topic.md");
  });

  test("create mode removes stale canonical wiki markdown absent from the draft", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-4");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await mkdir(join(root, "projects", "demo"), { recursive: true });
    await writeFile(join(root, "projects", "demo", "old.md"), "# Old\n", "utf8");
    await writeFile(join(draftWiki, "index.md"), "# Demo\n", "utf8");

    await promoteDraftWiki(validInput(root, runDir, draftWiki));

    expect(await Bun.file(join(root, "projects", "demo", "old.md")).exists()).toBe(false);
  });

  test("rewrites source citations on maintenance pages without changing internal wiki links", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-5");
    const draftWiki = join(runDir, "agents", "maintenance", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(join(draftWiki, "index.md"), "# Demo\n\n- [Runtime](runtime.md)\n", "utf8");
    await writeFile(join(draftWiki, "runtime.md"), "# Runtime\n\n[Contract](target-repo/docs/contract.md); test `target-repo/tests/contract.test.ts`.\n", "utf8");

    await promoteDraftWiki({ ...validInput(root, runDir, draftWiki), mode: "maintain" });

    expect(await readFile(join(root, "projects", "demo", "index.md"), "utf8"))
      .toContain("[Runtime](runtime.md)");
    expect(await readFile(join(root, "projects", "demo", "runtime.md"), "utf8"))
      .toContain("Contract (`repo:docs/contract.md`)");
    expect(await readFile(join(root, "projects", "demo", "runtime.md"), "utf8"))
      .toContain("`repo:tests/contract.test.ts`");
  });

  test("rejects broken internal wiki links before canonical writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-6");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(join(draftWiki, "index.md"), "# Demo\n\n[Missing](missing.md)\n", "utf8");

    await expect(promoteDraftWiki(validInput(root, runDir, draftWiki)))
      .rejects.toThrow("broken internal wiki link in index.md: missing.md");
    expect(await Bun.file(join(root, "projects", "demo", "index.md")).exists()).toBe(false);
    const publication = JSON.parse(await readFile(join(runDir, "canonical-publication-validation.json"), "utf8"));
    expect(publication.status).toBe("failed");
  });

  test("publishes repository identity state and rewrites run-local identity links", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-identity");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(
      join(draftWiki, "index.md"),
      "# Demo\n\n[Checkout evidence](../repository-identity.json)\n",
      "utf8",
    );
    const repositoryIdentity = {
      schema_version: 1 as const,
      project_key: "demo",
      registered_repo_path: "/tmp/demo",
      status: "available" as const,
      repository_root: "/tmp/demo",
      remotes: [{ name: "origin", urls: ["https://example.com/demo.git"] }],
      current_branch: "master",
      head_commit: "0123456789abcdef",
      diagnostics: [],
    };

    await promoteDraftWiki({ ...validInput(root, runDir, draftWiki), repositoryIdentity });

    expect(await readFile(join(root, "projects", "demo", "index.md"), "utf8"))
      .toContain("[Checkout evidence](../../state/demo/repository-identity.json)");
    expect(JSON.parse(await readFile(join(root, "state", "demo", "repository-identity.json"), "utf8")))
      .toEqual(repositoryIdentity);
    const publication = JSON.parse(await readFile(join(runDir, "canonical-publication-validation.json"), "utf8"));
    expect(publication.rewritten_repository_identity_links).toEqual([{
      page: "index.md",
      original_target: "../repository-identity.json",
      canonical_target: "../../state/demo/repository-identity.json",
    }]);
  });

  test("rejects planner lifecycle language at the canonical publication boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-planner-index");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(
      join(draftWiki, "index.md"),
      "# Demo\n\n## Planned canonical subjects\n\nThe eventual pages will be added later.\n",
      "utf8",
    );

    await expect(promoteDraftWiki(validInput(root, runDir, draftWiki)))
      .rejects.toThrow("planner lifecycle language");
    expect(await Bun.file(join(root, "projects", "demo", "index.md")).exists()).toBe(false);
  });
});

function validInput(root: string, runDir: string, draftWiki: string): ProjectMemoryDraftPromotionInput {
  return {
    root,
    projectKey: "demo",
    runDir: relative(root, runDir),
    absoluteRunDir: runDir,
    mode: "create",
    draftWikiDir: draftWiki,
    curatorOutputRef: "documentation-create-result.json",
    state: {
      schema_version: 2,
      project_key: "demo",
      status: "curated",
      source_run_dir: relative(root, runDir),
      updated_at: "2026-07-06T00:00:00.000Z",
      provider_mode: "stub",
      curation_kind: "agent_authored",
      run_kind: "create",
      create: {
        status: "completed",
        planner_status: "completed",
        subject_writer_status: "completed",
        subject_count: 0,
        subject_writer_concurrency_limit: 4,
        subject_writer_retry_limit: 1,
        subject_report_refs: [],
      },
      retrieval_readiness: { status: "pending", checked_at: "2026-07-06T00:00:00.000Z" },
      content_quality: {
        status: "not_evaluated",
        reason: "agent_authored_documentation_has_no_schema_quality_gate",
      },
    },
    sourceConsumptions: [],
  };
}
