import { describe, expect, test } from "bun:test";
import { DevelopmentCaptureAdapter } from "../../src/development/development-capture.adapter.ts";

const INPUT = {
  fixtureReference: "fixture:alpha",
  itemIndex: 7,
  workingDirectory: "/registered/project/src",
  content: "Decision recorded",
};

describe("DevelopmentCaptureAdapter", () => {
  const adapter = new DevelopmentCaptureAdapter();

  test("maps fixture facts and retains the complete native source", () => {
    const input = { ...INPUT, occurredAt: "2026-09-05T08:30:00.000Z", extra: { preserved: [1, null] } };
    const result = adapter.normalize(input);
    expect(result).toMatchObject({
      nativeEventKind: "fixture.input",
      nativeSessionReference: INPUT.fixtureReference,
      nativeInteractionReference: "7",
      workingDirectory: INPUT.workingDirectory,
      normalizedContent: INPUT.content,
      nativeOccurredAt: input.occurredAt,
    });
    expect(result.sourceMaterial.format).toBe("json.v1");
    expect(JSON.parse(new TextDecoder().decode(result.sourceMaterial.content))).toEqual(input);
    expect(adapter.normalize(INPUT).nativeOccurredAt).toBeUndefined();
  });

  test.each(["", null])("preserves valid empty content %p", (content) => {
    expect(adapter.normalize({ ...INPUT, content }).normalizedContent).toBe(content);
  });

  test.each([
    null, [], "input", {},
    ...["fixtureReference", "itemIndex", "workingDirectory", "content"].map((missing) =>
      Object.fromEntries(Object.entries(INPUT).filter(([key]) => key !== missing))),
    ...["", "  ", 5].map((fixtureReference) => ({ ...INPUT, fixtureReference })),
    ...["", "\t", null].map((workingDirectory) => ({ ...INPUT, workingDirectory })),
    ...[-1, -0, 0.5, Number.MAX_SAFE_INTEGER + 1, "7", null].map((itemIndex) => ({ ...INPUT, itemIndex })),
    { ...INPUT, content: 5 },
    { ...INPUT, extra: undefined },
  ].map((input, index) => ({ input, index })))("rejects invalid native input $index", ({ input }) => {
    expect(() => adapter.normalize(input)).toThrow(expect.objectContaining({ code: "capture:invalid-input" }));
  });

  test.each([0, Number.MAX_SAFE_INTEGER])("accepts valid index boundary %p", (itemIndex) => {
    expect(adapter.normalize({ ...INPUT, itemIndex }).nativeInteractionReference).toBe(String(itemIndex));
  });

  test.each(["not-a-date", "2026-02-30T00:00:00.000Z", "2026-09-05", "2026-09-05T08:30:00Z", "2026-09-05T10:30:00.000+02:00", 0, null])(
    "rejects invalid or non-canonical time %p", (occurredAt) => {
      expect(() => adapter.normalize({ ...INPUT, occurredAt })).toThrow(expect.objectContaining({ code: "capture:invalid-input" }));
    },
  );

  test("keeps replay identity independent of content and workspace observations", () => {
    const first = adapter.normalize(INPUT);
    const changed = adapter.normalize({ ...INPUT, content: "Changed", workingDirectory: "/elsewhere", extra: true });
    expect(changed.replay).toEqual(first.replay);
    expect(changed.sourceMaterial.content).not.toEqual(first.sourceMaterial.content);
  });

  test("distinguishes both replay coordinates without delimiter ambiguity", () => {
    const coordinates = [["a:1", 2], ["a", 12], ["a", 2], ['a",2]', 2]] as const;
    const keys = coordinates.map(([fixtureReference, itemIndex]) =>
      adapter.normalize({ ...INPUT, fixtureReference, itemIndex }).replay.key);
    expect(new Set(keys).size).toBe(coordinates.length);
  });

  test("matches the independently calculated v1 replay vector", () => {
    // SHA-256 of UTF-8 ["fixture:alpha",7], calculated independently with Python hashlib.
    expect(adapter.normalize(INPUT).replay).toEqual({
      scheme: "development-fixture/v1",
      key: "26e823382df4a0d1d8278336dd241ec9a8309fbdfc72ee5c6c4aa322ba06440e",
    });
  });
});
