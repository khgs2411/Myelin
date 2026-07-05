import { describe, expect, test } from "bun:test";
import { insertMarkdownSection, patchMarkdownSection } from "../../src/project/project-memory-section-renderer.ts";

describe("Project Memory section renderer", () => {
  test("patches only the resolved duplicate-heading range", () => {
    const page = "# Runtime\n\n## Commands\n\nfirst\n\n## Commands\n\nsecond\n";
    const next = patchMarkdownSection(page, {
      section: {
        wiki_path: "wiki/runtime.md",
        section_id: "runtime/commands-2",
        section_hash: "hash_before",
        heading_path: ["Runtime", "Commands"],
        start_line: 7,
        end_line: 9,
      },
      expected_section_hash: "hash_before",
      body: "run new\n",
    });

    expect(next).toContain("## Commands\n\nfirst");
    expect(next).toContain("## Commands\n\nrun new");
    expect(next).not.toContain("second");
  });

  test("rejects stale section hashes before patching", () => {
    expect(() =>
      patchMarkdownSection("# Runtime\n\n## Commands\n\nrun old\n", {
        section: {
          wiki_path: "wiki/runtime.md",
          section_id: "runtime/commands",
          section_hash: "actual_hash",
          heading_path: ["Runtime", "Commands"],
          start_line: 3,
          end_line: 5,
        },
        expected_section_hash: "stale_hash",
        body: "run new\n",
      }),
    ).toThrow("stale section hash");
  });

  test("inserts a new section at the end of an owned page", () => {
    const next = insertMarkdownSection("# Runtime\n\nOverview.\n", {
      heading: "Commands",
      level: 2,
      body: "Command details.",
    });

    expect(next).toBe("# Runtime\n\nOverview.\n\n## Commands\n\nCommand details.\n");
  });
});
