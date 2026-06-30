import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { createHandoffInstruction } from "../../src/memory/handoffs.ts";
import {
  PROJECT_MEMORY_PROMPT_TARGET_CHARS,
  buildPromptBudgetedProjectMemoryPacket,
} from "../../src/project/project-memory-prompt-budget.ts";
import { PROMPT_SIZE_LIMIT } from "../../src/runtime/llm-client.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-project-prompt-budget-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("reduces lookup breadth before invoking the Project Memory curator", async () => {
  await seedLargeLookupProject();
  seedPendingInputs();

  const result = await buildPromptBudgetedProjectMemoryPacket({
    root,
    projectKey: "demo",
    runDir: "projects/demo/runs/project-learn/run-1",
  });

  expect(result.status).toBe("ok");
  expect(result.artifact.adjusted).toBe(true);
  expect(result.prompt.length).toBeLessThanOrEqual(PROMPT_SIZE_LIMIT);
  expect(result.artifact.attempts[0].prompt_chars).toBeGreaterThan(PROJECT_MEMORY_PROMPT_TARGET_CHARS);
  expect(result.artifact.attempts[result.artifact.selected_attempt_index].fits_hard_limit).toBe(true);
  expect(
    result.packet.degraded_reasons.some((reason) =>
      reason.includes("Project Memory packet context was reduced by prompt budget preflight"),
    ),
  ).toBe(true);
});

test("artifact-reference transport keeps full packet evidence out of the prompt", async () => {
  await seedLargeLookupProject();
  seedPendingInputs();

  const result = await buildPromptBudgetedProjectMemoryPacket({
    root,
    projectKey: "demo",
    runDir: "projects/demo/runs/project-learn/run-1",
    transport: "artifact_reference",
  });

  expect(result.status).toBe("ok");
  expect(result.artifact.transport).toBe("artifact_reference");
  expect(result.artifact.adjusted).toBe(false);
  expect(result.prompt).toContain("Read input-packet.json before answering.");
  expect(result.prompt).toContain("Absolute path: projects/demo/runs/project-learn/run-1/input-packet.json");
  expect(result.prompt).toContain("Read curator-output-contract.json before answering.");
  expect(result.prompt).toContain("Absolute path: projects/demo/runs/project-learn/run-1/curator-output-contract.json");
  expect(result.prompt).toContain("You are running from the target repository cwd");
  expect(result.prompt).toContain("Do not run broad repository searches.");
  expect(result.prompt).toContain("use the contract artifact");
  expect(result.prompt).toContain("project_state refs are only `bootstrap_state`, `project_memory`, `freshness`, or `pages_manifest`");
  expect(result.prompt).toContain("prefer short aliases `lookup:0`, `lookup:1`");
  expect(result.prompt).toContain("wiki target paths are relative to the project wiki root");
  expect(result.prompt).toContain("every apply payload page or entry with empty repo_citations must include a non-null inference object");
  expect(result.prompt).toContain("unresolved or insufficient-evidence inputs belong in noop_inputs");
  expect(result.prompt).toContain("explicit_noop_decisions with source_packet_refs and checked_existing_memory_refs only for auto-applyable reasons");
  expect(result.prompt).toContain("do not propose auto-apply writes when target selection, dedupe, or supersession depends on fallback lookup");
  expect(result.prompt).not.toContain("ProjectMemoryMaintenanceProposal contract summary:");
  expect(result.prompt).not.toContain("Evidence refs must be objects, never strings");
  expect(result.prompt).not.toContain("sharedterm project memory context");
  expect(result.artifact.attempts[0].packet_chars).toBeGreaterThan(PROJECT_MEMORY_PROMPT_TARGET_CHARS);
  expect(result.artifact.attempts[0].prompt_chars).toBeLessThan(4_000);
  expect(result.packet.lookup.results[0]?.hits.length).toBe(5);
  expect(result.packet.lookup.quality_summary.proposal_scoped_result_ids.length).toBeGreaterThan(0);
});

test("creation prompt spells out applyable page targets and evidence ref shapes", async () => {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
  await writeJson(join(root, "projects", "demo", "state", "bootstrap-state.json"), { status: "uncurated" });
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Project Memory\n\nProject Memory has not been curated yet.\n", "utf8");

  const result = await buildPromptBudgetedProjectMemoryPacket({
    root,
    projectKey: "demo",
    runDir: "projects/demo/runs/project-learn/run-create",
    transport: "artifact_reference",
  });

  expect(result.status).toBe("ok");
  expect(result.prompt).toContain("Curator output contract artifact: projects/demo/runs/project-learn/run-create/curator-output-contract.json");
  expect(result.prompt).toContain("Your output must match curator-output-contract.json");
  expect(result.prompt).toContain("read a bounded repo orientation set");
  expect(result.prompt).toContain("every page draft and apply payload page must include direct repo_citations");
  expect(result.prompt).toContain("packet/session/candidate evidence alone is not enough to mark Project Memory curated");
  expect(result.prompt).toContain("apply_payload.pages must contain exactly one page");
  expect(result.prompt).toContain("create separate page drafts for separate wiki pages");
  expect(result.prompt).toContain("full Project Memory documentation set");
  expect(result.prompt).toContain("index.md plus at least 3 non-index pages");
  expect(result.prompt).toContain("product purpose, runtime/commands, architecture/data flow, and operations/current work");
  expect(result.prompt).toContain("use `index.md`, not `wiki/index.md`");
  expect(result.prompt).not.toContain("ProjectMemoryCreationDraft contract summary:");
  expect(result.prompt).not.toContain("use target:{\"path\":\"index.md\",\"path_kind\":\"new_wiki_page\"}");
  expect(result.prompt).not.toContain("Project Memory has not been curated yet.");
});

async function seedLargeLookupProject(): Promise<void> {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
  await writeJson(join(root, "projects", "demo", "state", "bootstrap-state.json"), { status: "curated" });
  await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "curated" });
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  const body = `${"sharedterm project memory context ".repeat(20)}\n`;
  for (let index = 0; index < 220; index += 1) {
    await writeFile(join(root, "projects", "demo", "wiki", `page-${index.toString().padStart(3, "0")}.md`), `# Page ${index}\n\n${body}`, "utf8");
  }
}

function seedPendingInputs(): void {
  const db = openMemoryDb(root);
  try {
    for (let index = 0; index < 20; index += 1) {
      createHandoffInstruction(db, {
        id: `handoff_${index}`,
        target_scope: "project",
        project_key: "demo",
        status: "pending",
        objective: `Document sharedterm handoff ${index}`,
        prompt_text: "Check existing Project Memory before proposing durable updates.",
        source_session_memory_ids: [],
        source_event_refs: [`tomb_${index}`],
        suggested_actions: ["query project memory"],
        reason: "sharedterm should retrieve existing pages",
        confidence: "medium",
        risk: "low",
        now: `2026-06-20T10:${index.toString().padStart(2, "0")}:00.000Z`,
      });
    }
    for (let index = 0; index < 5; index += 1) {
      createMemoryCandidate(db, {
        id: `cand_${index}`,
        project_key: "demo",
        scope: "project",
        status: "needs_review",
        candidate_type: "project.inbox",
        title: `sharedterm candidate ${index}`,
        summary: "Runtime inbox candidate should retrieve existing sharedterm pages.",
        source_event_refs: [`inbox_${index}`],
        evidence: {},
        proposed_payload: {},
        confidence: "medium",
        risk: "medium",
        reason: "sharedterm candidate lookup",
        now: `2026-06-20T11:${index.toString().padStart(2, "0")}:00.000Z`,
      });
    }
  } finally {
    db.close();
  }
}
