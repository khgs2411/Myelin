import { test, expect } from "bun:test";
import { createId, timestampForFilename } from "../../src/runtime/ids.ts";

test("timestampForFilename makes an ISO timestamp filesystem-safe and trims .000", () => {
  expect(timestampForFilename(new Date("2026-04-19T19:22:14Z"))).toBe("2026-04-19T19-22-14Z");
  expect(timestampForFilename(new Date("2026-04-19T19:22:14.123Z"))).toBe("2026-04-19T19-22-14.123Z");
});

test("createId is a timestamp plus a 6-char hex suffix", () => {
  const id = createId(new Date("2026-04-19T19:22:14Z"));
  expect(id).toMatch(/^2026-04-19T19-22-14Z_[0-9a-f]{6}$/);
  expect(createId()).not.toBe(createId());
});
