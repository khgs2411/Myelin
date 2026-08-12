# Chunk 04: Evidence Map Builder

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `02-answer-domain-contracts.md`
**Enables:** `05-create-mode-schema-validator.md`, `06-curator-writer-flow.md`, `07-independent-usefulness-critique.md`

## Goal

Add a deterministic create-mode evidence-map artifact that maps required answer domains to concrete repo/docs/state/test/ADR evidence before curator writing. Candidates and Session Memory remain leads; the evidence map is the bounded repo-grounded bridge to documentation.

## Source Artifacts

- `../spec.md`: Two-Pass Evidence Workflow, Product Boundary, Create-Mode Coverage Requirements.
- `../agenda.md`: Question 2.
- `../../../adr/0064-use-two-pass-project-memory-evidence-workflow.md`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-curator-service.ts`
- `src/runtime/project-run-infrastructure.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-packet.test.ts`

## Relationships

- **Depends on:** Answer-domain constants.
- **Enables:** Schema/validator can require evidence-map refs; writer flow can consume the map; usefulness critique can review it.
- **Shared contracts:** `project-memory-evidence-map.json`, `ProjectMemoryEvidenceMap`, `ProjectMemoryEvidenceMapDomain`.
- **Integration points:** Written as a run artifact before `curator-output-contract.json` and prompt construction for create mode.
- **Runtime dependency:** create-mode evidence discovery requires `rg`/ripgrep on PATH. Missing `rg` is a deterministic infrastructure failure, not permission to skip bounded search or publish weaker documentation.

## File Responsibility Map

**Create:**
- `src/project/project-memory-evidence-map.ts` - deterministic builder and artifact contract.
- `tests/project/project-memory-evidence-map.test.ts` - unit coverage for required domains and leads.

**Modify:**
- `src/project/project-memory-curator-contracts.ts` - export artifact name and evidence-map types if preferred from central contract module.
- `src/project/project-memory-curator-service.ts` - call builder for create mode and write artifact.

**Test:**
- `tests/project/project-memory-curator-service.test.ts` - run artifacts include evidence map in create mode.

## Implementation Tasks

### Task 1: Define Evidence Map Contract

**Files:**
- Create: `src/project/project-memory-evidence-map.ts`
- Test: `tests/project/project-memory-evidence-map.test.ts`

- [ ] **Step 1: Add artifact name and types**

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_MEMORY_ANSWER_DOMAINS, type ProjectMemoryAnswerDomain } from "./project-memory-quality-contract.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

export const PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT = "project-memory-evidence-map.json" as const;

export type ProjectMemoryEvidenceMap = {
  schema_version: 1;
  project_key: string;
  packet_ref: "input-packet.json";
  domains: ProjectMemoryEvidenceMapDomain[];
  leads_considered: ProjectMemoryEvidenceLead[];
  discovery_steps: ProjectMemoryEvidenceDiscoveryStep[];
  missing_domains: ProjectMemoryAnswerDomain[];
};

export type ProjectMemoryEvidenceMapDomain = {
  domain: ProjectMemoryAnswerDomain;
  representative_questions: string[];
  inspected_paths: string[];
  search_terms: string[];
  search_results: ProjectMemoryEvidenceSearchResult[];
  evidence_refs: ProjectMemoryEvidenceMapRef[];
  missing_evidence: string[];
};

export type ProjectMemoryEvidenceDiscoveryStep = {
  kind: "default_path_read" | "bounded_repo_search" | "packet_lead_scan";
  domain?: ProjectMemoryAnswerDomain;
  detail: string;
};

export type ProjectMemoryEvidenceSearchResult = {
  path: string;
  line: number | null;
  term: string;
  excerpt: string;
};

export type ProjectMemoryEvidenceMapRef = {
  kind: "repo_path" | "doc" | "test" | "adr" | "state" | "candidate" | "session_memory" | "handoff";
  ref: string;
  reason: string;
};

export type ProjectMemoryEvidenceLead = {
  kind: "project_candidate" | "project_handoff" | "session_memory";
  ref: string;
  summary: string;
  mapped_domains: ProjectMemoryAnswerDomain[];
};
```

### Task 2: Build Deterministic Domain Evidence

**Files:**
- Modify: `src/project/project-memory-evidence-map.ts`
- Test: `tests/project/project-memory-evidence-map.test.ts`

- [ ] **Step 1: Add default discovery surfaces**

```ts
const MAX_SEARCH_RESULTS_PER_DOMAIN = 12;
const MAX_READ_CHARS_PER_FILE = 20_000;

const DOMAIN_QUERIES: Record<ProjectMemoryAnswerDomain, { questions: string[]; pathHints: string[]; terms: string[] }> = {
  product_memory_model: {
    questions: ["What is Myelin Project Memory?", "How do Session Memory and Project Memory differ?"],
    pathHints: ["MYELIN.md", "MY_VISION.md", "docs/ROADMAP.md", "CONTEXT.md"],
    terms: ["Project Memory", "Session Memory", "living repo documentation"],
  },
  storage_retrieval: {
    questions: ["Where is SQLite state stored?", "How do retrieval rows point back to markdown?"],
    pathHints: ["src/memory/db.ts", "src/memory/migrations.ts", "src/query/project-memory-query-service.ts"],
    terms: ["state/memory.db", "session_memories", "project memory retrieval"],
  },
  command_workflows: {
    questions: ["Which CLI commands operate Project Memory?"],
    pathHints: ["src/commands/project.ts", "src/commands/memory.ts", "Makefile", "AGENTS.md"],
    terms: ["project learn", "memory query", "memory index session"],
  },
  curation_apply_lifecycle: {
    questions: ["How does project learn create, validate, apply, and index Project Memory?"],
    pathHints: ["src/project/project-memory-curator-service.ts", "src/project/project-memory-markdown-applier.ts"],
    terms: ["validateCuratorOutput", "applyCreationDraft", "curator-validation.json"],
  },
  evidence_provenance_candidates: {
    questions: ["How are candidates and handoffs treated as leads?"],
    pathHints: ["src/project/project-memory-candidate-intake-service.ts", "src/project/project-memory-source-consumption-reconciler.ts"],
    terms: ["project_candidate", "project_handoff", "lead"],
  },
  current_work_roadmap_decisions: {
    questions: ["Where are roadmap and durable decisions captured?"],
    pathHints: [
      "docs/ROADMAP.md",
      "docs/adr/0063-use-answer-domain-project-memory-documentation-map.md",
      "docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md",
      "docs/adr/0065-require-independent-first-create-usefulness-critique.md",
      "docs/adr/0066-allow-clean-project-shell-rebootstrap-reset.md",
      "docs/design/2026-07-05-project-memory-rendered-create-contract/spec.md",
    ],
    terms: ["Step 5", "Step 6", "ADR"],
  },
};
```

- [ ] **Step 2: Add bounded repo-local search**

Implement deterministic repo search with `rg` so the evidence map can discover repo-specific files outside static path hints. The implementation must cap result count and read size, and it must exclude generated/runtime-heavy paths.

`rg` is an accepted Myelin runtime dependency for this slice. If `execFileAsync("rg", ...)` fails because the binary is missing (`ENOENT`), throw a typed/clear discovery error such as `Project Memory evidence discovery requires rg on PATH`. The curator service and later promotion-state chunk must surface that as a blocked failed-run diagnostic before canonical wiki writes. Do not silently fall back to static path hints only.

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function boundedRepoSearch(input: {
  repoPath: string;
  domain: ProjectMemoryAnswerDomain;
  terms: string[];
}): Promise<{ results: ProjectMemoryEvidenceSearchResult[]; steps: ProjectMemoryEvidenceDiscoveryStep[] }> {
  const results: ProjectMemoryEvidenceSearchResult[] = [];
  const steps: ProjectMemoryEvidenceDiscoveryStep[] = [];

  for (const term of input.terms) {
    if (results.length >= MAX_SEARCH_RESULTS_PER_DOMAIN) break;
    steps.push({ kind: "bounded_repo_search", domain: input.domain, detail: `rg search for ${term}` });
    const output = await execFileAsync("rg", [
      "--line-number",
      "--fixed-strings",
      "--ignore-case",
      "--max-count",
      "3",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.git/**",
      "--glob",
      "!projects/*/runs/**",
      "--glob",
      "!projects/*/logs/**",
      "--glob",
      "!state/**",
      term,
      input.repoPath,
    ], { maxBuffer: 128_000 }).catch((error: unknown) => {
      const maybe = error as { code?: number; stdout?: string };
      if (maybe.code === 1) return { stdout: "" };
      throw error;
    });

    const stdout = typeof output.stdout === "string" ? output.stdout : "";
    for (const line of stdout.split("\n")) {
      if (!line.trim() || results.length >= MAX_SEARCH_RESULTS_PER_DOMAIN) continue;
      const match = line.match(/^(.*?):(\d+):(.*)$/);
      if (!match) continue;
      const [, absolutePath, lineNumber, excerpt] = match;
      const relativePath = absolutePath.startsWith(`${input.repoPath}/`)
        ? absolutePath.slice(input.repoPath.length + 1)
        : absolutePath;
      results.push({
        path: relativePath,
        line: Number(lineNumber),
        term,
        excerpt: excerpt.slice(0, 240),
      });
    }
  }

  return { results, steps };
}
```

- [ ] **Step 3: Implement builder**

```ts
export async function buildProjectMemoryEvidenceMap(input: {
  root: string;
  projectKey: string;
  packet: ProjectMemoryPacket;
  repoPath: string;
}): Promise<ProjectMemoryEvidenceMap> {
  const discovery_steps: ProjectMemoryEvidenceDiscoveryStep[] = [];
  const domains: ProjectMemoryEvidenceMapDomain[] = [];

  for (const domain of PROJECT_MEMORY_ANSWER_DOMAINS) {
    const query = DOMAIN_QUERIES[domain];
    const evidence_refs: ProjectMemoryEvidenceMapRef[] = [];
    const inspected_paths: string[] = [];

    for (const pathHint of query.pathHints) {
      const absolute = join(input.repoPath, pathHint);
      if (!existsSync(absolute)) continue;
      inspected_paths.push(pathHint);
      discovery_steps.push({ kind: "default_path_read", domain, detail: pathHint });
      const text = (await readFile(absolute, "utf8").catch(() => "")).slice(0, MAX_READ_CHARS_PER_FILE);
      const matched = query.terms.some((term) => text.toLowerCase().includes(term.toLowerCase()));
      evidence_refs.push({
        kind: pathHint.includes("test") ? "test" : pathHint.includes("docs/adr") ? "adr" : pathHint.startsWith("docs/") ? "doc" : "repo_path",
        ref: pathHint,
        reason: matched ? `matched domain terms for ${domain}` : `default orientation surface for ${domain}`,
      });
    }

    const search = await boundedRepoSearch({ repoPath: input.repoPath, domain, terms: query.terms });
    discovery_steps.push(...search.steps);
    for (const result of search.results) {
      if (!inspected_paths.includes(result.path)) inspected_paths.push(result.path);
      evidence_refs.push({
        kind: result.path.includes("test") ? "test" : result.path.includes("docs/adr") ? "adr" : result.path.startsWith("docs/") ? "doc" : "repo_path",
        ref: result.line ? `${result.path}:${result.line}` : result.path,
        reason: `bounded repo search matched "${result.term}" for ${domain}`,
      });
    }

    domains.push({
      domain,
      representative_questions: query.questions,
      inspected_paths,
      search_terms: query.terms,
      search_results: search.results,
      evidence_refs,
      missing_evidence: evidence_refs.length === 0 ? [`no evidence found for ${domain}`] : [],
    });
  }

  const leads_considered = leadsFromPacket(input.packet);
  return {
    schema_version: 1,
    project_key: input.projectKey,
    packet_ref: "input-packet.json",
    domains,
    leads_considered,
    discovery_steps: [
      ...discovery_steps,
      { kind: "packet_lead_scan", detail: "packet candidate/handoff/session lead scan" },
    ],
    missing_domains: domains.filter((domain) => domain.evidence_refs.length === 0).map((domain) => domain.domain),
  };
}
```

- [ ] **Step 4: Test search-discovered evidence**

Add a test fixture with a file that is not in `pathHints` but contains one domain term. Assert the bounded search adds it to `search_results`, `inspected_paths`, and `evidence_refs`.

```ts
test("buildProjectMemoryEvidenceMap includes bounded search-discovered evidence", async () => {
  await writeFile(join(repo, "src/project/extra-storage-note.ts"), "export const note = 'state/memory.db retrieval pointer';");
  const map = await buildProjectMemoryEvidenceMap({ root, repoPath: repo, projectKey: "llm-wiki", packet });
  const storage = map.domains.find((domain) => domain.domain === "storage_retrieval");

  expect(storage?.search_results.some((result) => result.path === "src/project/extra-storage-note.ts")).toBe(true);
  expect(storage?.inspected_paths).toContain("src/project/extra-storage-note.ts");
  expect(storage?.evidence_refs.some((ref) => ref.ref.includes("extra-storage-note.ts"))).toBe(true);
});
```

Implement `leadsFromPacket` by reading `packet.pending.project_candidates`, `packet.pending.project_handoffs`, and `packet.session_memory.selected`, mapping summaries to domains with term matching against `DOMAIN_QUERIES`.

### Task 3: Write Evidence Map Artifact In Create Mode

**Files:**
- Modify: `src/project/project-memory-curator-service.ts`
- Test: `tests/project/project-memory-curator-service.test.ts`

- [ ] **Step 1: Build after packet construction**

After `await writeRunArtifact(run, "input-packet.json", packet);`, add:

```ts
let evidenceMap: ProjectMemoryEvidenceMap | undefined;
if (packet.mode === "create") {
  evidenceMap = await buildProjectMemoryEvidenceMap({
    root: this.root,
    projectKey: input.projectKey,
    packet,
    repoPath: project.config.repo_paths?.[0] ?? this.root,
  });
  await writeRunArtifact(run, PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT, evidenceMap);
}
```

Also add `evidence_map?: "project-memory-evidence-map.json"` to `ProjectMemoryCuratorRunResult.artifacts` in the appropriate contract/result shape if it does not already exist.

- [ ] **Step 2: Include artifact in terminal result**

Add an optional `evidenceMap` boolean to `writeTerminalArtifacts` and `buildResult`, then set:

```ts
evidence_map: input.evidenceMap ? PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT : undefined,
```

## Verification

- Run: `bun test tests/project/project-memory-evidence-map.test.ts`
  - Expected: exits 0; all required answer domains appear, at least default llm-wiki paths are inspected in fixtures, bounded search can discover non-hint files, and missing `rg` is represented as a deterministic discovery failure in the relevant unit coverage or service coverage.
- Run: `bun test tests/project/project-memory-curator-service.test.ts`
  - Expected: exits 0; create-mode run result includes `artifacts.evidence_map`.
- Run: `bun run typecheck`
  - Expected: exits 0 with artifact type wired through run results.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Evidence map precedes curator writing.
- Candidates/session leads are treated as leads, not durable truth.
- Missing evidence is explicit in run artifacts.

## Risks And Rollback

- Risk: bounded `rg` search can be noisy. Keep result caps, generated-path exclusions, and read-size limits deterministic so the artifact remains reviewable.
- Risk: machines without `rg` cannot run first-create evidence discovery. This is accepted for the current plan set; document the dependency and fail closed before writes. A Node fallback is a future packaging hardening task, not part of this chunk.
- Rollback: remove the evidence-map call and artifact type; no canonical wiki/state writes depend on this chunk until later chunks.

## Non-Goals

- No provider/model invocation.
- No writer prompt consumption yet.
- No independent critique.

## Type And Name Consistency

Before finishing, verify `PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT`, `ProjectMemoryEvidenceMap`, and `artifacts.evidence_map` are spelled consistently.
