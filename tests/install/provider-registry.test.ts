import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRegistry } from "../../src/install/provider-registry.ts";

let root: string;
let codexRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-provider-registry-"));
  codexRoot = join(root, ".codex");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("bare selection handles zero, one, and several detected providers", async () => {
  const none = await new ProviderRegistry({ codexRoot }).select({ explicit: [], commandOnly: false });
  expect(none.selected).toEqual([]);
  expect(none.warnings[0]).toContain("command only");

  await mkdir(codexRoot, { recursive: true });
  expect((await new ProviderRegistry({ codexRoot }).select({ explicit: [], commandOnly: false })).selected).toEqual([
    "codex",
  ]);

  await expect(
    new ProviderRegistry({
      codexRoot,
      detectedProviders: ["codex", "future"],
      supportedProviders: ["codex", "future"],
    }).select({ explicit: [], commandOnly: false }),
  ).rejects.toThrow("Multiple providers detected");
});

test("explicit selection is repeatable, supported, and available", async () => {
  const registry = new ProviderRegistry({ codexRoot, detectedProviders: ["codex"] });
  expect((await registry.select({ explicit: ["codex", "codex"], commandOnly: false })).selected).toEqual(["codex"]);
  await expect(
    new ProviderRegistry({ codexRoot, detectedProviders: [] }).select({ explicit: ["codex"], commandOnly: false }),
  ).rejects.toThrow("not available");
  await expect(registry.select({ explicit: ["unknown"], commandOnly: false })).rejects.toThrow("Unsupported provider");
  expect((await registry.select({ explicit: [], commandOnly: true })).selected).toEqual([]);
});
