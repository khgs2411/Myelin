import { afterEach, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectLauncher,
  launcherSha256,
  promoteLauncher,
  renderLauncher,
} from "../../src/install/launcher.ts";

let sandbox: string | null = null;

afterEach(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
  sandbox = null;
});

test("launcher promotion copies deterministic executable content instead of a symlink", async () => {
  sandbox = await mkdtemp(join(tmpdir(), "myelin-launcher-"));
  const path = join(sandbox, "bin", "myelin");
  const locator = join(sandbox, ".myelin", "install.json");
  const content = renderLauncher(locator);

  await promoteLauncher(path, content);

  expect((await lstat(path)).isSymbolicLink()).toBe(false);
  expect((await lstat(path)).mode & 0o777).toBe(0o755);
  expect(await readFile(path, "utf8")).toBe(content);
  expect(await inspectLauncher(path, launcherSha256(content))).toEqual({
    status: "owned",
    sha256: launcherSha256(content),
  });
});

test("launcher inspection distinguishes missing, changed, and symlink artifacts", async () => {
  sandbox = await mkdtemp(join(tmpdir(), "myelin-launcher-inspect-"));
  const path = join(sandbox, "myelin");
  expect((await inspectLauncher(path, "abc")).status).toBe("missing");
  await writeFile(path, "changed", "utf8");
  expect((await inspectLauncher(path, "abc")).status).toBe("mismatch");
  await rm(path);
  await symlink(join(sandbox, "target"), path);
  expect((await inspectLauncher(path, "abc")).status).toBe("symlink");
});
