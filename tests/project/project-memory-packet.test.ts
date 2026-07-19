import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { createHandoffInstruction } from "../../src/memory/handoffs.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";
import { buildProjectMemoryPacket } from "../../src/project/project-memory-packet.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-project-packet-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("builds a bounded Project Memory packet with pending inputs and deterministic lookup", async () => {
  await seedProject();
  await seedMemoryDb();

  const packet = await buildProjectMemoryPacket(root, "demo");

  expect(packet.schema_version).toBe(1);
  expect(packet.project_key).toBe("demo");
  expect(packet.mode).toBe("create");
  expect(packet.wiki.page_count).toBe(3);
  expect(packet.wiki.sections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        wiki_path: "setup/index.md",
        section_id: "setup",
        heading_path: ["Setup"],
        start_line: 1,
        end_line: 4,
      }),
    ]),
  );
  const setupSection = packet.wiki.sections.find((section) => section.wiki_path === "setup/index.md");
  expect(setupSection?.section_hash).toMatch(/^sha256:/);
  expect(packet.pending.project_handoffs.map((handoff) => handoff.id)).toEqual(["handoff_1"]);
  expect(packet.pending.project_candidates.map((candidate) => candidate.id).sort()).toEqual(["cand_1", "cand_2"]);
  expect(packet.pending.project_candidates.find((candidate) => candidate.id === "cand_1")).toMatchObject({
    priority: "normal",
    producer_kind: "normalized",
    evidence: {
      observed_facts: ["Bootstrap shell repair is part of project setup."],
      relevant_paths: ["src/runtime/project-shell.ts"],
      uncertainties: [],
    },
    proposed_payload: {
      durable_facts: ["Project bootstrap repairs the canonical shell."],
      change_kind: "architecture.setup",
      suggested_subjects: ["project setup"],
      verification_needed: ["Verify the runtime implementation."],
    },
  });
  expect(packet.pending.project_handoffs[0]).toMatchObject({
    priority: "normal",
    producer_kind: "normalized",
  });
  expect(Object.keys(packet.pending)).toEqual(["project_handoffs", "project_candidates"]);
  expect(packet.session_memory.selected.map((memory) => memory.id)).toEqual(["mem_1"]);
  expect(packet.lookup.queries.map((query) => query.source_kind).sort()).toEqual([
    "project_candidate",
    "project_candidate",
    "project_handoff",
    "session_memory",
  ]);
  expect(
    packet.lookup.results.some((result) =>
      result.hits.some((hit) => hit.canonical_ref?.wiki_path === "setup/index.md"),
    ),
  ).toBe(true);
  expect(
    packet.lookup.results.some((result) =>
      result.hits.some((hit) => hit.canonical_ref?.wiki_path === "deep/index.md"),
    ),
  ).toBe(true);
  expect(packet.lookup.results.every((result) => result.lookup_quality === "fallback")).toBe(true);
  expect(packet.lookup.quality_summary.blocking).toBe(false);
  expect(packet.lookup.quality_summary.advisory_reasons).toEqual(
    expect.arrayContaining([expect.stringContaining("fallback markdown search")]),
  );
  expect(packet.degraded).toBe(false);
  expect(packet.degraded_reasons).not.toContain(
    "Project Memory lookup is markdown text search only; derived metadata/vector indexes are not implemented.",
  );
});

test("does not create a memory database when packet inputs are unavailable", async () => {
  await seedProject();

  const packet = await buildProjectMemoryPacket(root, "demo");

  expect(packet.pending.project_handoffs).toEqual([]);
  expect(packet.pending.project_candidates).toEqual([]);
  expect(packet.session_memory.selected).toEqual([]);
  expect(packet.wiki.sections.length).toBeGreaterThan(0);
  expect(packet.degraded_reasons).toContain(
    "state/memory/memory.db is missing; Session Memory and pending handoff inputs are unavailable",
  );
  expect(await Bun.file(join(root, "state", "memory", "memory.db")).exists()).toBe(false);
});

test("uses maintain mode for a legacy degraded canonical baseline", async () => {
  await seedProject();
  await writeJson(join(root, "state", "demo", "project-memory.json"), {
    schema_version: 2,
    status: "degraded",
    maintenance: { status: "degraded" },
  });

  const packet = await buildProjectMemoryPacket(root, "demo");

  expect(packet.mode).toBe("maintain");
});

async function seedProject(): Promise<void> {
  await writeJson(join(root, "state", "demo", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
  await writeJson(join(root, "state", "demo", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "demo", "setup"), { recursive: true });
  await mkdir(join(root, "projects", "demo", "deep"), { recursive: true });
  await writeFile(
    join(root, "projects", "demo", "index.md"),
    "# Project Memory\n\nProject Memory has not been curated yet.\n",
    "utf8",
  );
  await writeFile(
    join(root, "projects", "demo", "setup", "index.md"),
    [
      "# Setup",
      "",
      "Bootstrap shell repair and legacy project filtering are represented here.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "projects", "demo", "deep", "index.md"),
    ["# Deep", "", `${"background ".repeat(70)}lateonlytoken project memory marker.`].join("\n"),
    "utf8",
  );
}

async function seedMemoryDb(): Promise<void> {
  const db = openMemoryDb(root);
  try {
    createSessionMemory(db, {
      id: "mem_1",
      project_key: "demo",
      source_event_refs: ["tomb_1"],
      memory_kind: "continuity",
      title: "Legacy filtering",
      summary: "Legacy project filtering excludes V1-only projects from active discovery.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-06-20T10:00:00.000Z",
      embedding_contract: null,
    });
    createMemoryCandidate(db, {
      id: "cand_1",
      project_key: "demo",
      scope: "project",
      status: "pending",
      candidate_type: "project.setup",
      title: "Bootstrap shell repair",
      summary: "Bootstrap shell repair should be captured in Project Memory.",
      source_event_refs: ["tomb_1"],
      evidence: {
        observed_facts: ["Bootstrap shell repair is part of project setup."],
        relevant_paths: ["src/runtime/project-shell.ts"],
        uncertainties: [],
      },
      proposed_payload: {
        durable_facts: ["Project bootstrap repairs the canonical shell."],
        change_kind: "architecture.setup",
        suggested_subjects: ["project setup"],
        verification_needed: ["Verify the runtime implementation."],
      },
      confidence: "medium",
      risk: "low",
      reason: "Durable project setup behavior",
      now: "2026-06-20T10:01:00.000Z",
    });
    createMemoryCandidate(db, {
      id: "cand_2",
      project_key: "demo",
      scope: "project",
      status: "pending",
      candidate_type: "project.lookup",
      title: "Full markdown lookup",
      summary: "Project Memory lookup should find lateonlytoken beyond the bounded emitted snippet.",
      source_event_refs: ["tomb_2"],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "low",
      reason: "The curator packet lookup must not be capped by packet page snippets",
      now: "2026-06-20T10:01:30.000Z",
    });
    createHandoffInstruction(db, {
      id: "handoff_1",
      target_scope: "project",
      project_key: "demo",
      status: "pending",
      objective: "Document legacy project filtering",
      prompt_text: "Check whether Project Memory already documents legacy project filtering.",
      source_session_memory_ids: ["mem_1"],
      source_event_refs: ["tomb_1"],
      suggested_actions: ["lookup Project Memory"],
      reason: "Session Memory found durable Project Memory signal",
      confidence: "medium",
      risk: "low",
      now: "2026-06-20T10:02:00.000Z",
    });
  } finally {
    db.close();
  }
}
