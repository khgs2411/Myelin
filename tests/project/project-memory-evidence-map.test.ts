import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectMemoryEvidenceMap,
  PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT,
} from "../../src/project/project-memory-evidence-map.ts";
import type { ProjectMemoryPacket } from "../../src/project/project-memory-packet.ts";
import { PROJECT_MEMORY_ANSWER_DOMAINS } from "../../src/project/project-memory-quality-contract.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-evidence-map-"));
  repo = join(root, "repo");
  await mkdir(join(repo, "src", "memory"), { recursive: true });
  await mkdir(join(repo, "src", "project"), { recursive: true });
  await mkdir(join(repo, "src", "commands"), { recursive: true });
  await mkdir(join(repo, "docs", "adr"), { recursive: true });
  await mkdir(join(repo, "docs", "design", "2026-07-05-project-memory-rendered-create-contract"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("builds required answer-domain evidence from concrete repo paths", async () => {
  await seedEvidenceFiles();

  const map = await buildProjectMemoryEvidenceMap({
    root,
    projectKey: "demo",
    packet: packetFixture(),
    repoPath: repo,
  });

  expect(PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT).toBe("project-memory-evidence-map.json");
  expect(map.schema_version).toBe(1);
  expect(map.packet_ref).toBe("input-packet.json");
  expect(map.domains.map((domain) => domain.domain).sort()).toEqual([...PROJECT_MEMORY_ANSWER_DOMAINS].sort());
  expect(map.missing_domains).toEqual([]);

  const storage = map.domains.find((domain) => domain.domain === "storage_retrieval");
  expect(storage?.inspected_paths).toContain("src/memory/db.ts");
  expect(storage?.search_terms).toContain("state/memory.db");
  expect(storage?.evidence_refs[0]).toMatchObject({
    kind: "repo_path",
    ref: "src/memory/db.ts",
  });
  expect(map.discovery_steps.some((step) => step.kind === "default_path_read")).toBe(true);
  expect(map.discovery_steps.some((step) => step.kind === "bounded_repo_search")).toBe(true);

  const product = map.domains.find((domain) => domain.domain === "product_memory_model");
  expect(product?.inspected_paths).toContain("README.md");
});

test("includes bounded search-discovered evidence outside default path hints", async () => {
  await seedEvidenceFiles();
  await writeFile(join(repo, "src", "project", "extra-storage-note.ts"), "export const note = 'state/memory.db retrieval pointer';\n", "utf8");

  const map = await buildProjectMemoryEvidenceMap({
    root,
    projectKey: "demo",
    packet: packetFixture(),
    repoPath: repo,
  });

  const storage = map.domains.find((domain) => domain.domain === "storage_retrieval");
  expect(storage?.search_results.some((result) => result.path === "src/project/extra-storage-note.ts")).toBe(true);
  expect(storage?.inspected_paths).toContain("src/project/extra-storage-note.ts");
  expect(storage?.evidence_refs.some((ref) => ref.ref.includes("extra-storage-note.ts"))).toBe(true);
});

test("treats rg no-match as empty search results", async () => {
  const map = await buildProjectMemoryEvidenceMap({
    root,
    projectKey: "demo",
    packet: packetFixture(),
    repoPath: repo,
  });

  expect(map.domains.every((domain) => domain.search_results.length === 0)).toBe(true);
  expect(map.missing_domains).toEqual([...PROJECT_MEMORY_ANSWER_DOMAINS]);
});

test("maps packet candidates, handoffs, and session memories as leads instead of durable evidence", async () => {
  await seedEvidenceFiles();

  const map = await buildProjectMemoryEvidenceMap({
    root,
    projectKey: "demo",
    packet: packetFixture(),
    repoPath: repo,
  });

  expect(map.leads_considered.map((lead) => lead.kind)).toEqual(["project_candidate", "project_handoff", "session_memory"]);
  expect(map.leads_considered[0]).toMatchObject({
    kind: "project_candidate",
    ref: "cand_1",
    mapped_domains: ["storage_retrieval"],
  });
  expect(map.domains.flatMap((domain) => domain.evidence_refs).some((ref) => ref.kind === "candidate")).toBe(false);
  expect(map.domains.flatMap((domain) => domain.evidence_refs).some((ref) => ref.kind === "session_memory")).toBe(false);
  expect(map.domains.flatMap((domain) => domain.evidence_refs).some((ref) => ref.kind === "handoff")).toBe(false);
});

async function seedEvidenceFiles(): Promise<void> {
  await writeFile(join(repo, "MY_VISION.md"), "Project Memory is living repo documentation built from Session Memory leads.\n", "utf8");
  await writeFile(join(repo, "README.md"), "Myelin stores Project Memory as curated markdown for a repository.\n", "utf8");
  await writeFile(join(repo, "docs", "ROADMAP.md"), "Step 5 and Step 6 cover the current roadmap.\n", "utf8");
  await writeFile(join(repo, "src", "memory", "db.ts"), "export const path = 'state/memory.db'; // sqlite embeddings\n", "utf8");
  await writeFile(join(repo, "src", "commands", "project.ts"), "project learn and memory inbox intake command workflows\n", "utf8");
  await writeFile(join(repo, "src", "project", "project-memory-curator-service.ts"), "validateCuratorOutput applyCreationDraft\n", "utf8");
  await writeFile(join(repo, "src", "project", "project-memory-candidate-intake-service.ts"), "project_candidate project_handoff lead\n", "utf8");
  await writeFile(join(repo, "docs", "adr", "0063-use-answer-domain-project-memory-documentation-map.md"), "ADR answer domain map\n", "utf8");
  await writeFile(
    join(repo, "docs", "design", "2026-07-05-project-memory-rendered-create-contract", "spec.md"),
    "Ready for Development roadmap spec\n",
    "utf8",
  );
}

function packetFixture(): ProjectMemoryPacket {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    project: {
      key: "demo",
      name: "Demo",
      lifecycle: "active",
      repo_paths: [repo],
    },
    state: {
      bootstrap_state: null,
      project_memory: null,
      freshness: null,
      pages_manifest: null,
    },
    wiki: {
      page_count: 0,
      pages: [],
      sections: [],
    },
    pending: {
      project_handoffs: [
        {
          id: "handoff_1",
          status: "pending",
          priority: "normal",
          producer_kind: "session_memory",
          objective: "Document project learn command workflows",
          prompt_text: "Inspect CLI commands for project learn and memory query.",
          source_session_memory_ids: ["mem_1"],
          source_event_refs: ["evt_1"],
          suggested_actions: ["inspect repo"],
          confidence: "high",
          risk: "low",
          reason: "command workflows changed",
        },
      ],
      project_candidates: [
        {
          id: "cand_1",
          status: "pending",
          priority: "normal",
          producer_kind: "session_memory",
          candidate_type: "project.fact",
          title: "SQLite storage",
          summary: "The project stores session_memories in state/memory.db with embeddings.",
          source_event_refs: ["evt_1"],
          confidence: "high",
          risk: "low",
          reason: "storage retrieval memory",
        },
      ],
    },
    session_memory: {
      selected: [
        {
          id: "mem_1",
          memory_kind: "session_summary",
          title: "Project Memory vision",
          summary: "Session Memory creates leads for living repo documentation.",
          source_event_refs: ["evt_1"],
          confidence: "high",
          risk: "low",
          created_at: "2026-07-05T10:00:00.000Z",
          updated_at: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
    lookup: {
      queries: [],
      results: [],
      quality_summary: {
        blocking: false,
        blocking_reasons: [],
        advisory_reasons: [],
        proposal_scoped_result_ids: [],
      },
    },
    degraded: false,
    degraded_reasons: [],
  };
}
