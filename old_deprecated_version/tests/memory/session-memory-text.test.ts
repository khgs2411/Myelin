import { expect, test } from "bun:test";
import {
  normalizeSessionMemoryForEmbedding,
  sessionMemoryNormalizedTextHash,
} from "../../src/memory/session-memory-text.ts";

test("normalizes title summary kind and safe scalar payload fields", () => {
  const text = normalizeSessionMemoryForEmbedding({
    title: "Review gate",
    summary: "Reviewer accepted the Symphony card.",
    memory_kind: "verification",
    payload_json: JSON.stringify({
      branch: "myelin/example",
      command: "rtk bun test",
      nested: { ignored: true },
      transcript: "must not appear",
    }),
  });

  expect(text).toContain("title: Review gate");
  expect(text).toContain("summary: Reviewer accepted the Symphony card.");
  expect(text).toContain("kind: verification");
  expect(text).toContain("branch: myelin/example");
  expect(text).toContain("command: rtk bun test");
  expect(text).not.toContain("must not appear");
  expect(text).not.toContain("nested");
});

test("falls back when payload json is invalid", () => {
  expect(
    normalizeSessionMemoryForEmbedding({
      title: null,
      summary: "Useful continuity.",
      memory_kind: "continuity",
      payload_json: "{",
    }),
  ).toBe("summary: Useful continuity.\nkind: continuity");
});

test("skips unsafe payload values", () => {
  const text = normalizeSessionMemoryForEmbedding({
    title: null,
    summary: "Useful continuity.",
    memory_kind: "continuity",
    payload_json: JSON.stringify({
      branch: "x".repeat(501),
      status: "ready",
      url: ["https://example.test"],
    }),
  });

  expect(text).toContain("status: ready");
  expect(text).not.toContain("branch:");
  expect(text).not.toContain("url:");
});

test("hashes the normalized Session Memory document with one shared deterministic primitive", () => {
  const normalized = "title: Review gate\nsummary: Approved.\nkind: verification";

  expect(sessionMemoryNormalizedTextHash(normalized)).toBe(
    "3397b23ff45d95412836acabf8568a78f7d8f1c984e5d7c5aee048ae54fdce05",
  );
  expect(sessionMemoryNormalizedTextHash(normalized)).toHaveLength(64);
});
