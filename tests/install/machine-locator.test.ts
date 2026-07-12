import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  machineLocatorMode,
  promoteMachineLocator,
  readMachineLocator,
  serializeMachineLocator,
} from "../../src/install/machine-locator.ts";
import type { MachineLocatorV1 } from "../../src/runtime/launch-context.ts";

let sandbox: string | null = null;

afterEach(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
  sandbox = null;
});

test("machine locator serializes schema v1 and promotes with private modes", async () => {
  sandbox = await mkdtemp(join(tmpdir(), "myelin-locator-"));
  const path = join(sandbox, ".myelin", "install.json");
  const locator = fixture(sandbox);

  await promoteMachineLocator(path, locator);

  expect(await readMachineLocator(path)).toEqual(locator);
  expect(await machineLocatorMode(path)).toBe(0o600);
  expect((await stat(join(sandbox, ".myelin"))).mode & 0o777).toBe(0o700);
  expect(serializeMachineLocator(locator)).toEndWith("\n");
});

test("machine locator rejects incompatible and relative ownership records", () => {
  const locator = fixture("/tmp/myelin-locator-fixture");
  expect(() => serializeMachineLocator({ ...locator, schema_version: 2 } as unknown as MachineLocatorV1)).toThrow("data_root");
  expect(() => serializeMachineLocator({ ...locator, myelin_root: "relative" })).toThrow("myelin_root");
});

function fixture(root: string): MachineLocatorV1 {
  return {
    schema_version: 1,
    myelin_root: join(root, "checkout"),
    launcher: { path: join(root, "bin", "myelin"), sha256: "abc" },
    providers: {},
    installed_at: "2026-07-10T10:00:00.000Z",
    updated_at: "2026-07-10T10:00:00.000Z",
    source_revision: null,
  };
}
