import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planInstalledVersion,
  promoteInstalledVersion,
  pruneInstalledVersions,
  verifyInstalledVersion,
} from "../../src/install/version-store.ts";

let sandbox: string;
let sourceRoot: string;
let storeRoot: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "myelin-version-store-"));
  sourceRoot = join(sandbox, "source");
  storeRoot = join(sandbox, "store");
  await mkdir(join(sourceRoot, "src"), { recursive: true });
  await writeFile(join(sourceRoot, "src", "cli.ts"), "console.log('v1');\n", "utf8");
  await writeFile(join(sourceRoot, "package.json"), `${JSON.stringify({ version: "1.2.3", type: "module" })}\n`, "utf8");
  await writeFile(join(sourceRoot, "bun.lock"), "lock-v1\n", "utf8");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

test("plans and promotes a deterministic immutable runtime snapshot", async () => {
  const first = await plan();
  const second = await plan();
  expect(second.version.id).toBe(first.version.id);
  expect(first.manifest.bun_lock_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(first.manifest.entrypoint).toBe("src/cli.ts");

  await promoteInstalledVersion({ sourceRoot, storeRoot, transactionId: "tx-1", plan: first });
  await verifyInstalledVersion(first.version);
  await writeFile(join(sourceRoot, "src", "cli.ts"), "console.log('changed checkout');\n", "utf8");

  expect(await readFile(join(first.version.path, "src", "cli.ts"), "utf8")).toBe("console.log('v1');\n");
  expect((await plan()).version.id).not.toBe(first.version.id);
});

test("fails promotion when source bytes change after planning", async () => {
  const planned = await plan();
  await writeFile(join(sourceRoot, "src", "cli.ts"), "console.log('changed');\n", "utf8");

  await expect(
    promoteInstalledVersion({ sourceRoot, storeRoot, transactionId: "tx-drift", plan: planned }),
  ).rejects.toThrow("source changed");
  expect(await Bun.file(planned.version.manifest_path).exists()).toBe(false);
});

test("rejects runtime symlinks that escape the source snapshot", async () => {
  await symlink("/tmp", join(sourceRoot, "src", "outside"));
  await expect(plan()).rejects.toThrow("symlink escapes");
});

test("garbage collection removes only manifest-owned inactive versions", async () => {
  const first = await plan();
  await promoteInstalledVersion({ sourceRoot, storeRoot, transactionId: "tx-1", plan: first });
  await writeFile(join(sourceRoot, "src", "cli.ts"), "console.log('v2');\n", "utf8");
  const second = await plan();
  await promoteInstalledVersion({ sourceRoot, storeRoot, transactionId: "tx-2", plan: second });
  const unknown = join(storeRoot, "versions", "operator-owned");
  await mkdir(unknown, { recursive: true });
  await writeFile(join(unknown, "note.txt"), "preserve\n", "utf8");

  expect(await pruneInstalledVersions({ storeRoot, retainIds: [second.version.id] })).toEqual([first.version.id]);
  expect(await Bun.file(first.version.manifest_path).exists()).toBe(false);
  expect(await Bun.file(second.version.manifest_path).exists()).toBe(true);
  expect(await Bun.file(join(unknown, "note.txt")).exists()).toBe(true);
});

function plan() {
  return planInstalledVersion({ sourceRoot, storeRoot, installedAt: "2026-07-12T12:00:00.000Z" });
}
