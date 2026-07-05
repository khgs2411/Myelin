import { describe, expect, test } from "bun:test";
import {
  resolveSectionTarget,
  sectionTargetKey,
  type ProjectMemorySectionTargetRef,
} from "../../src/project/project-memory-section-targets.ts";
import type { ProjectMemoryMarkdownSection } from "../../src/project/project-memory-markdown-sections.ts";

describe("Project Memory section targets", () => {
  test("formats section target keys from canonical wiki path and section id", () => {
    expect(sectionTargetKey({ wiki_path: "wiki/runtime.md", section_id: "commands" })).toBe("wiki/runtime.md#commands");
  });

  test("marks missing section targets as unresolved", () => {
    const ref: ProjectMemorySectionTargetRef = { wiki_path: "wiki/runtime.md", section_id: "commands" };

    const result = resolveSectionTarget([], ref);

    expect(result).toEqual({ status: "missing_section", ref });
  });

  test("resolves matching section targets", () => {
    const section = sectionFixture({ wiki_path: "wiki/runtime.md", section_id: "commands", section_hash: "sha256:abc" });

    const result = resolveSectionTarget([section], {
      wiki_path: "wiki/runtime.md",
      section_id: "commands",
      expected_section_hash: "sha256:abc",
    });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.section).toBe(section);
  });

  test("marks matching section targets stale when hash changed", () => {
    const ref = { wiki_path: "wiki/runtime.md", section_id: "commands", expected_section_hash: "sha256:old" };

    const result = resolveSectionTarget([sectionFixture({ section_hash: "sha256:new" })], ref);

    expect(result).toEqual({ status: "stale_hash", ref, actual_hash: "sha256:new" });
  });
});

function sectionFixture(overrides: Partial<ProjectMemoryMarkdownSection> = {}): ProjectMemoryMarkdownSection {
  return {
    project_key: "demo",
    wiki_path: "wiki/runtime.md",
    category: null,
    page_title: "Runtime",
    section_id: "commands",
    heading_path: ["Runtime", "Commands"],
    section_hash: "sha256:section",
    heading_level: 2,
    heading_text: "Commands",
    body_text: "Command details.",
    snippet: "Command details.",
    start_line: 3,
    end_line: 8,
    ...overrides,
  };
}
