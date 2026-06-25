import { expect, test } from "bun:test";
import {
  boundedSnippetForText,
  renderEntryBlock,
  renderPageDraft,
  updateEntryLifecycle,
  upsertEntryBlock,
} from "../../src/project/project-memory-markdown-renderer.ts";
import type { ProjectMemoryEntryDraft, ProjectMemoryPageDraft } from "../../src/project/project-memory-apply-contracts.ts";

test("renders entry blocks with stable markers and visible provenance", () => {
  const rendered = renderEntryBlock(entryDraft());

  expect(rendered).toContain('<!-- myelin-entry id="setup.cli" lifecycle="active" -->');
  expect(rendered).toContain("### Setup CLI");
  expect(rendered).toContain("Document CLI setup command.");
  expect(rendered).toContain("Provenance:");
  expect(rendered).toContain("- Evidence: project_candidate:cand_1 - durable setup");
  expect(rendered).toContain("- Repo: src/commands/project.ts:1-20 - CLI command registration");
  expect(rendered).toContain("<!-- /myelin-entry -->");
});

test("renders page drafts as human-readable markdown", () => {
  const rendered = renderPageDraft(pageDraft());

  expect(rendered.startsWith("# Setup\n")).toBe(true);
  expect(rendered).toContain("Setup workflows.");
  expect(rendered).toContain("Provenance:");
});

test("upserts entry blocks by exact entry id", () => {
  const original = ["# Setup", "", renderEntryBlock(entryDraft({ title: "Old Setup CLI", body: { paragraphs: ["Old text."] } })), ""].join("\n");
  const next = upsertEntryBlock(original, "setup.cli", renderEntryBlock(entryDraft()));

  expect(next).toContain("### Setup CLI");
  expect(next).toContain("Document CLI setup command.");
  expect(next).not.toContain("Old text.");
});

test("appends missing entry blocks under Project Memory Updates", () => {
  const next = upsertEntryBlock("# Setup\n", "setup.cli", renderEntryBlock(entryDraft()));

  expect(next).toContain("## Project Memory Updates");
  expect(next).toContain('id="setup.cli"');
});

test("updates lifecycle marker and appends lifecycle provenance", () => {
  const original = renderEntryBlock(entryDraft());
  const next = updateEntryLifecycle(original, "setup.cli", "stale_pending", "Lifecycle note.");

  expect(next).toContain('id="setup.cli" lifecycle="stale_pending"');
  expect(next).toContain("Lifecycle note.");
});

test("rejects marker-breaking entry content", () => {
  expect(() => renderEntryBlock(entryDraft({ body: { paragraphs: ["<!-- /myelin-entry -->"] } }))).toThrow(
    "Entry content cannot contain myelin-entry markers",
  );
});

test("extracts bounded snippets with truncation signal", () => {
  const snippet = boundedSnippetForText("wiki/setup/index.md", "setup.cli", "x".repeat(600), 120);

  expect(snippet.path).toBe("wiki/setup/index.md");
  expect(snippet.anchor).toBe("setup.cli");
  expect(snippet.text.length).toBeLessThanOrEqual(120);
  expect(snippet.truncated).toBe(true);
});

function entryDraft(overrides: Partial<ProjectMemoryEntryDraft> = {}): ProjectMemoryEntryDraft {
  return {
    entry_id: "setup.cli",
    title: "Setup CLI",
    body: { paragraphs: ["Document CLI setup command."] },
    lifecycle: "active",
    evidence_refs: [{ kind: "project_candidate", ref: "cand_1", note: "durable setup" }],
    repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }],
    applicability: { commands: ["myelin project learn demo"] },
    ...overrides,
  };
}

function pageDraft(): ProjectMemoryPageDraft {
  return {
    page_path: "setup/index.md",
    title: "Setup",
    purpose: "Setup workflows.",
    body: { paragraphs: ["Setup workflows."] },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [{ path: "src/runtime/project-shell.ts", reason: "Project shell setup" }],
  };
}
