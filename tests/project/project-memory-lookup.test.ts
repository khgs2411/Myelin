import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupProjectMemory } from "../../src/project/project-memory-lookup.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-pm-lookup-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("markdown fallback lookup reports fallback quality without packet-wide blocking severity", async () => {
  await mkdir(join(root, "projects", "demo", "wiki", "architecture"), { recursive: true });
  await writeFile(
    join(root, "projects", "demo", "wiki", "architecture", "ranking.md"),
    "# Ranking\n\nProposal ranking uses deterministic impact scoring.\n",
    "utf8",
  );

  const result = await lookupProjectMemory(root, "demo", "proposal ranking", {
    source_kind: "project_candidate",
    source_id: "cand_1",
    mode: "create",
    limit: 5,
    allow_fallback: true,
  });

  expect(result.lookup_quality).toBe("fallback");
  expect(result.lookup_freshness).toBe("not_applicable");
  expect(result.apply_severity).toBe("advisory");
  expect(result.hits[0]?.canonical_ref?.wiki_path).toBe("wiki/architecture/ranking.md");
  expect(result.degraded_reason).toContain("fallback markdown search");
});
