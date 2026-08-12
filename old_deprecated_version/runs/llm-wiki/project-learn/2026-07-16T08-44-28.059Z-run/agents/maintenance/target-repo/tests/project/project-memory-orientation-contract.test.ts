import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES,
  missingRequiredOrientationSurfaces,
} from "../../src/project/project-memory-orientation-contract.ts";

describe("Project Memory orientation contract", () => {
  test("includes repo docs, command, roadmap, and CLI defaults", () => {
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("AGENTS.md");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("MYELIN.md");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("CONTEXT.md");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("docs/ROADMAP.md");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("src/cli.ts");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("src/project/");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("src/memory/");
    expect(PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES).toContain("src/runtime/");
  });

  test("reports present default surfaces that were not inspected", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-orientation-contract-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "AGENTS.md"), "agents\n", "utf8");
      await writeFile(join(root, "docs", "ROADMAP.md"), "roadmap\n", "utf8");
      await writeFile(join(root, "src", "cli.ts"), "cli\n", "utf8");

      const missing = await missingRequiredOrientationSurfaces({
        targetRepoRoot: root,
        inspected: ["AGENTS.md"],
      });

      expect(missing).toEqual([
        "required orientation surface not inspected: docs/ROADMAP.md",
        "required orientation surface not inspected: src/cli.ts",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not block absent defaults recorded as not present", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-orientation-contract-"));
    try {
      const missing = await missingRequiredOrientationSurfaces({
        targetRepoRoot: root,
        inspected: [],
        missing: [{ path: "MYELIN.md", reason: "not_present" }],
      });

      expect(missing).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("directory defaults are satisfied by inspected child files", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-orientation-contract-"));
    try {
      await mkdir(join(root, "src", "project"), { recursive: true });
      await writeFile(join(root, "src", "project", "service.ts"), "service\n", "utf8");

      const missing = await missingRequiredOrientationSurfaces({
        targetRepoRoot: root,
        inspected: ["src/project/service.ts"],
        missing: [{ path: "src/project/", reason: "present_not_inspected" }],
      });

      expect(missing).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports existing defaults even when curator records them as not present", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-orientation-contract-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(join(root, "docs", "ROADMAP.md"), "roadmap\n", "utf8");

      const missing = await missingRequiredOrientationSurfaces({
        targetRepoRoot: root,
        inspected: [],
        missing: [{ path: "docs/ROADMAP.md", reason: "not_present" }],
      });

      expect(missing).toContain("required orientation surface not inspected: docs/ROADMAP.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
