import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("class-kit session memory validation questions name expected target ids", async () => {
  const fixture = JSON.parse(
    await readFile(join(import.meta.dir, "fixtures", "class-kit-session-memory-questions.json"), "utf8"),
  ) as {
    project_key?: unknown;
    questions?: Array<{ question?: unknown; expected_any_ids?: unknown }>;
  };

  expect(fixture.project_key).toBe("class-kit");
  expect(fixture.questions).toHaveLength(5);
  for (const item of fixture.questions ?? []) {
    expect(typeof item.question).toBe("string");
    expect(Array.isArray(item.expected_any_ids)).toBe(true);
    expect((item.expected_any_ids as unknown[]).length).toBeGreaterThan(0);
  }
});
