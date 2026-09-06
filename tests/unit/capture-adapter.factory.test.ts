import { expect, test } from "bun:test";
import { CaptureAdapterFactory } from "../../src/capture/capture-adapter.factory.ts";

test("the trusted fixture route supplies a usable capture adapter", () => {
  const adapter = new CaptureAdapterFactory().create("development.fixture");
  expect(adapter.normalize({ fixtureReference: "factory", itemIndex: 0, workingDirectory: "/project", content: null }))
    .toMatchObject({ nativeEventKind: "fixture.input", normalizedContent: null });
});

test.each(["unknown.provider", "", "development.fixture "])("unsupported route %p never falls back", (source) => {
  expect(() => new CaptureAdapterFactory().create(source))
    .toThrow(expect.objectContaining({ code: "capture:unsupported-source" }));
});
