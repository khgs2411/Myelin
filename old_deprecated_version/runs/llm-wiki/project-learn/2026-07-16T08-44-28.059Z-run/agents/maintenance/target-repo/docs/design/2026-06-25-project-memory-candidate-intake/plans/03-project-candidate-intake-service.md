# Chunk 03: Project Candidate Intake Service

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `01-runtime-inbox-contract-and-writer.md`  
**Enables:** `04-memory-inbox-intake-command.md`, `05-project-learn-intake-integration.md`

## Goal

Add `ProjectMemoryCandidateIntakeService`, a provider-free service that reads validated project runtime inbox source items, normalizes them into deterministic `project.inbox` `memory_candidates`, and reports created, existing, terminal duplicate, skipped, unsupported, invalid, degraded, and blocking outcomes without mutating source files.

## Source Artifacts

- `../spec.md`: Intake Boundary, Learn Integration ordering, Data / State, Error Handling, Acceptance Criteria.
- `../agenda.md`: Questions 2, 3, 4, 5, and 6.
- `../pseudocode/ProjectMemoryCandidateIntakeService.ts`
- `../pseudocode/CandidateIdAndDedupeContract.md`
- `../pseudocode/CandidateIntakeReliabilityBoundary.md`
- `../pseudocode/RuntimeInboxItemJsonFormat.md`
- Code context: `src/memory/candidates.ts`, `src/memory/db.ts`, `src/memory/ingest-types.ts`, `src/project/project-memory-source-consumption-reconciler.ts`, `src/project/project-memory-packet.ts`.
- Test context: `tests/memory/candidates.test.ts`, `tests/project/project-memory-source-consumption-reconciler.test.ts`.

## Relationships

- **Depends on:** runtime inbox validation/path/source-ref helpers from Chunk 01.
- **Enables:** deterministic command access in Chunk 04 and `project learn` composition in Chunk 05.
- **Shared contracts:** candidate id derivation, `project.inbox`, `inbox:<id>`, `needs_review`, terminal duplicate behavior.
- **Integration points:** root SQLite `memory_candidates`, existing `createMemoryCandidate` and `getMemoryCandidate` helpers.

## File Responsibility Map

**Create:**

- `src/project/project-memory-candidate-intake-service.ts` - project runtime inbox source-to-candidate normalization and result aggregation.
- `tests/project/project-memory-candidate-intake-service.test.ts` - service behavior, idempotency, malformed item isolation, unsupported layer handling.

**Modify:**

- None.

**Test:**

- `tests/project/project-memory-candidate-intake-service.test.ts` - service-level contract.

## Implementation Tasks

### Task 1: Add Failing Intake Service Tests

**Files:**

- Create: `tests/project/project-memory-candidate-intake-service.test.ts`

- [ ] **Step 1: Add service tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCandidate, getMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { createRuntimeInboxItem, runtimeInboxItemPath } from "../../src/inbox/runtime-inbox-items.ts";
import { ProjectMemoryCandidateIntakeService } from "../../src/project/project-memory-candidate-intake-service.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-candidate-intake-"));
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("normalizes a project runtime inbox item into one needs-review project candidate", async () => {
  const created = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox source material",
    body: "Runtime inbox proposals are preserved source material.",
    rationale: "Project Memory curator should verify and decide what becomes durable.",
    evidenceRefs: ["docs/design/spec.md"],
    targetHint: "wiki/architecture/index.md",
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (created.status !== "created") throw new Error("failed to create inbox fixture");

  const result = await new ProjectMemoryCandidateIntakeService(root).intakeProjectInbox("demo", new Date("2026-06-25T11:00:00.000Z"));

  expect(result).toMatchObject({
    project_key: "demo",
    created_candidate_ids: ["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"],
    existing_candidate_ids: [],
    terminal_duplicate_candidate_ids: [],
    degraded: false,
    blocking: false,
  });
  const db = openMemoryDb(root);
  try {
    const candidate = getMemoryCandidate(db, "project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3");
    expect(candidate).toMatchObject({
      project_key: "demo",
      scope: "project",
      status: "needs_review",
      candidate_type: "project.inbox",
      title: "Runtime inbox source material",
      confidence: "high",
      risk: "medium",
      reason: "Project Memory curator should verify and decide what becomes durable.",
    });
    expect(JSON.parse(candidate?.source_event_refs_json ?? "[]")).toEqual(["inbox:2026-06-25T10-00-00Z_a1b2c3"]);
    expect(JSON.parse(candidate?.proposed_payload_json ?? "{}")).toMatchObject({
      body: "Runtime inbox proposals are preserved source material.",
      target_hint: "wiki/architecture/index.md",
      creator: "operator:test",
    });
  } finally {
    db.close();
  }
});

test("intake is idempotent for existing and terminal candidates", async () => {
  const created = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Idempotent proposal",
    body: "Proposal body.",
    rationale: "Proposal rationale.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (created.status !== "created") throw new Error("failed to create inbox fixture");
  const service = new ProjectMemoryCandidateIntakeService(root);

  const first = await service.intakeProjectInbox("demo", new Date("2026-06-25T11:00:00.000Z"));
  const second = await service.intakeProjectInbox("demo", new Date("2026-06-25T11:01:00.000Z"));
  const db = openMemoryDb(root);
  try {
    db.query("UPDATE memory_candidates SET status = 'processed' WHERE id = ?").run(first.created_candidate_ids[0]);
  } finally {
    db.close();
  }
  const third = await service.intakeProjectInbox("demo", new Date("2026-06-25T11:02:00.000Z"));

  expect(first.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
  expect(second.existing_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
  expect(third.terminal_duplicate_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
});

test("malformed and unsupported inbox files degrade without blocking valid intake", async () => {
  const valid = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Valid proposal",
    body: "Valid body.",
    rationale: "Valid rationale.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (valid.status !== "created") throw new Error("failed to create inbox fixture");
  await writeFile(runtimeInboxItemPath(root, "demo", "2026-06-25T10-00-01Z_badbad"), "{not json", "utf8");
  await writeJson(runtimeInboxItemPath(root, "demo", "2026-06-25T10-00-02Z_b2c3d4"), {
    schema_version: 1,
    id: "2026-06-25T10-00-02Z_b2c3d4",
    project_key: "demo",
    created_at: "2026-06-25T10:00:02.000Z",
    creator: "operator:test",
    target_layer: "personal",
    target_scope: "demo",
    title: "Unsupported",
    body: "Unsupported body.",
    rationale: "Unsupported rationale.",
    evidence_refs: [],
    target_hint: null,
    confidence: "medium",
    risk: "low",
    tags: [],
  });

  const result = await new ProjectMemoryCandidateIntakeService(root).intakeProjectInbox("demo", new Date("2026-06-25T11:00:00.000Z"));

  expect(result.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
  expect(result.invalid_source_refs).toEqual(["inbox:2026-06-25T10-00-01Z_badbad"]);
  expect(result.unsupported_source_refs).toEqual(["inbox:2026-06-25T10-00-02Z_b2c3d4"]);
  expect(result.degraded).toBe(true);
  expect(result.blocking).toBe(false);
});

test("unknown projects block instead of becoming inbox noops", async () => {
  const result = await new ProjectMemoryCandidateIntakeService(root).intakeProjectInbox(
    "missing",
    new Date("2026-06-25T11:00:00.000Z"),
  );

  expect(result).toMatchObject({
    project_key: "missing",
    created_candidate_ids: [],
    degraded: true,
    blocking: true,
    degraded_reasons: ["Unknown project: missing"],
  });
  expect(await Bun.file(join(root, "projects", "missing")).exists()).toBe(false);
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-candidate-intake-service.test.ts`  
Expected: fails because `src/project/project-memory-candidate-intake-service.ts` does not exist.

### Task 2: Implement `ProjectMemoryCandidateIntakeService`

**Files:**

- Create: `src/project/project-memory-candidate-intake-service.ts`

- [ ] **Step 1: Add the service implementation**

```ts
import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Database } from "bun:sqlite";
import { createMemoryCandidate, getMemoryCandidate } from "../memory/candidates.ts";
import { openMemoryDb } from "../memory/db.ts";
import { findProject } from "../runtime/projects.ts";
import {
  runtimeInboxDir,
  runtimeInboxSourceRef,
  validateRuntimeInboxFilename,
  validateRuntimeInboxItem,
  type RuntimeInboxItem,
} from "../inbox/runtime-inbox-items.ts";

export type ProjectInboxIntakeSummary = {
  project_key: string;
  created_candidate_ids: string[];
  existing_candidate_ids: string[];
  terminal_duplicate_candidate_ids: string[];
  skipped_source_refs: string[];
  unsupported_source_refs: string[];
  invalid_source_refs: string[];
  degraded: boolean;
  blocking: boolean;
  degraded_reasons: string[];
};

export type ProjectInboxIntakeItemResult =
  | { status: "created"; candidate_id: string; source_ref: string }
  | { status: "existing"; candidate_id: string; source_ref: string; current_status: "pending" | "needs_review" }
  | { status: "terminal_duplicate"; candidate_id: string; source_ref: string; current_status: "processed" | "rejected" }
  | { status: "skipped"; source_ref: string; reason: string }
  | { status: "unsupported_layer"; source_ref: string; layer: string }
  | { status: "invalid_item"; source_ref: string; reason: string }
  | { status: "blocked"; reason: string };

export class ProjectMemoryCandidateIntakeService {
  constructor(private readonly root: string) {}

  async intakeProjectInbox(projectKey: string, now: Date = new Date()): Promise<ProjectInboxIntakeSummary> {
    const summary: ProjectInboxIntakeSummary = {
      project_key: projectKey,
      created_candidate_ids: [],
      existing_candidate_ids: [],
      terminal_duplicate_candidate_ids: [],
      skipped_source_refs: [],
      unsupported_source_refs: [],
      invalid_source_refs: [],
      degraded: false,
      blocking: false,
      degraded_reasons: [],
    };

    try {
      await findProject(this.root, projectKey);
    } catch (error) {
      return {
        ...summary,
        degraded: true,
        blocking: true,
        degraded_reasons: [errorMessage(error)],
      };
    }

    let entries: string[];
    try {
      entries = (await readdir(runtimeInboxDir(this.root, projectKey))).filter((entry) => entry.endsWith(".json")).sort();
    } catch (error) {
      if (isEnoent(error)) return summary;
      return { ...summary, degraded: true, blocking: true, degraded_reasons: [errorMessage(error)] };
    }

    const db = openMemoryDb(this.root);
    try {
      for (const entry of entries) {
        const result = await this.intakeFile(db, projectKey, entry, now);
        applyItemResult(summary, result);
      }
    } finally {
      db.close();
    }
    summary.degraded = summary.degraded_reasons.length > 0;
    return summary;
  }

  intakeInboxItem(db: Database, projectKey: string, item: RuntimeInboxItem, now: Date = new Date()): ProjectInboxIntakeItemResult {
    const sourceRef = runtimeInboxSourceRef(item.id);
    if (item.target_layer !== "project") return { status: "unsupported_layer", source_ref: sourceRef, layer: item.target_layer };
    if (item.project_key !== projectKey || item.target_scope !== projectKey) {
      return { status: "invalid_item", source_ref: sourceRef, reason: "runtime inbox item project scope does not match intake project" };
    }

    const candidateId = this.candidateIdFor(projectKey, item);
    const existing = getMemoryCandidate(db, candidateId);
    if (existing) {
      if (existing.status === "pending" || existing.status === "needs_review") {
        return { status: "existing", candidate_id: candidateId, source_ref: sourceRef, current_status: existing.status };
      }
      if (existing.status === "processed" || existing.status === "rejected") {
        return { status: "terminal_duplicate", candidate_id: candidateId, source_ref: sourceRef, current_status: existing.status };
      }
      return { status: "skipped", source_ref: sourceRef, reason: `unsupported existing candidate status: ${existing.status}` };
    }

    createMemoryCandidate(db, {
      id: candidateId,
      project_key: projectKey,
      scope: "project",
      status: "needs_review",
      candidate_type: "project.inbox",
      title: item.title,
      summary: item.body,
      source_event_refs: [sourceRef],
      evidence: {
        source_ref: sourceRef,
        evidence_refs: item.evidence_refs,
        target_hint: item.target_hint,
        created_at: item.created_at,
        creator: item.creator,
      },
      proposed_payload: {
        layer: item.target_layer,
        scope: item.target_scope,
        title: item.title,
        body: item.body,
        rationale: item.rationale,
        evidence_refs: item.evidence_refs,
        target_hint: item.target_hint,
        creator: item.creator,
        confidence: item.confidence,
        risk: item.risk,
        created_at: item.created_at,
        tags: item.tags,
      },
      confidence: item.confidence,
      risk: item.risk,
      reason: item.rationale,
      now: now.toISOString(),
    });

    return { status: "created", candidate_id: candidateId, source_ref: sourceRef };
  }

  candidateIdFor(projectKey: string, item: RuntimeInboxItem): string {
    return `project_inbox:${projectKey}:${item.id}`;
  }

  private async intakeFile(db: Database, projectKey: string, entry: string, now: Date): Promise<ProjectInboxIntakeItemResult> {
    let itemId = entry;
    try {
      itemId = validateRuntimeInboxFilename(entry);
    } catch (error) {
      return { status: "invalid_item", source_ref: `inbox:${basename(entry, ".json")}`, reason: errorMessage(error) };
    }
    const sourceRef = runtimeInboxSourceRef(itemId);
    try {
      const parsed = JSON.parse(await readFile(`${runtimeInboxDir(this.root, projectKey)}/${entry}`, "utf8"));
      const item = validateRuntimeInboxItem(parsed, entry);
      return this.intakeInboxItem(db, projectKey, item, now);
    } catch (error) {
      return { status: "invalid_item", source_ref: sourceRef, reason: errorMessage(error) };
    }
  }
}

function applyItemResult(summary: ProjectInboxIntakeSummary, result: ProjectInboxIntakeItemResult): void {
  if (result.status === "created") summary.created_candidate_ids.push(result.candidate_id);
  else if (result.status === "existing") summary.existing_candidate_ids.push(result.candidate_id);
  else if (result.status === "terminal_duplicate") summary.terminal_duplicate_candidate_ids.push(result.candidate_id);
  else if (result.status === "skipped") {
    summary.skipped_source_refs.push(result.source_ref);
    summary.degraded_reasons.push(`${result.source_ref}: ${result.reason}`);
  } else if (result.status === "unsupported_layer") {
    summary.unsupported_source_refs.push(result.source_ref);
    summary.degraded_reasons.push(`${result.source_ref}: unsupported layer ${result.layer}`);
  } else if (result.status === "invalid_item") {
    summary.invalid_source_refs.push(result.source_ref);
    summary.degraded_reasons.push(`${result.source_ref}: ${result.reason}`);
  } else {
    summary.blocking = true;
    summary.degraded_reasons.push(result.reason);
  }
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 2: Run focused tests**

Run: `bun test tests/project/project-memory-candidate-intake-service.test.ts`  
Expected: passes.

## Verification

- Run: `bun test tests/inbox/runtime-inbox-items.test.ts`  
  Expected: pass, proving the source contract still works.
- Run: `bun test tests/project/project-memory-candidate-intake-service.test.ts`  
  Expected: pass, including create, existing, terminal duplicate, malformed, and unsupported-layer cases.
- Run: `bun run typecheck`  
  Expected: pass with no TypeScript errors.
- Run: `rtk git diff --check`  
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- `memory inbox intake` service boundary exists independently of CLI formatting.
- Valid project inbox items become `needs_review` `project.inbox` candidates.
- Candidate source refs use `inbox:<item-id>`.
- Repeated intake does not duplicate candidates.
- Existing terminal candidates are not recreated.
- Malformed single inbox items are skipped/degraded without reaching curator packet.
- Unknown projects block instead of becoming missing-inbox noops.
- Runtime inbox files are not rewritten by intake.

## Risks And Rollback

- Risk: candidate id spelling becomes part of idempotency. Mitigation: this chunk resolves it as `project_inbox:<project-key>:<item-id>` and tests repeated intake.
- Risk: opening the DB in intake creates `state/memory.db`. This is acceptable because intake is a write boundary; `project packet` remains read-only.
- Rollback: remove `src/project/project-memory-candidate-intake-service.ts` and its tests. Chunks 04 and 05 must not proceed without this service.

## Non-Goals

- No CLI command.
- No `project learn` integration.
- No source file lifecycle mutation.
- No Practice/Personal candidate creation.
- No gap/stale producer routing.

## Type And Name Consistency

- Service class: `ProjectMemoryCandidateIntakeService`.
- Service method: `intakeProjectInbox`.
- Per-item method: `intakeInboxItem`.
- Candidate id format: `project_inbox:<project-key>:<item-id>`.
- Candidate type: `project.inbox`.
- Candidate status: `needs_review`.
- Source ref: `inbox:<item-id>`.
