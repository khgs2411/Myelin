import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCodexInstall, planCodexInstall, uninstallCodex } from "./codex.ts";

let root: string;
let codexRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-install-"));
  codexRoot = join(root, ".codex");
  await mkdir(codexRoot, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("preview reports create actions without writing", async () => {
  const plan = await planCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "preview" });

  expect(plan.detected).toBe(true);
  expect(plan.actions).toContain("create hooks.json");
  expect(await Bun.file(join(codexRoot, "hooks.json")).exists()).toBe(false);
});

test("apply creates hooks, shim, manifest, and backup directory", async () => {
  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });

  const hooks = JSON.parse(await readFile(join(codexRoot, "hooks.json"), "utf8"));
  expect(JSON.stringify(hooks)).toContain(".myelin/shim/codex-hook");
  expect(await Bun.file(join(codexRoot, ".myelin", "shim", "codex-hook")).exists()).toBe(true);
  expect(await readFile(join(codexRoot, ".myelin", "shim", "codex-hook"), "utf8")).toContain(
    `MYELIN_ROOT=${JSON.stringify(root)}`,
  );
  expect(await Bun.file(join(codexRoot, ".myelin", "install-manifest.json")).exists()).toBe(true);
  expect((await stat(join(codexRoot, ".myelin", "backups"))).isDirectory()).toBe(true);
});

test("apply preserves unrelated hooks and is idempotent", async () => {
  await writeFile(
    join(codexRoot, "hooks.json"),
    JSON.stringify({ hooks: { Stop: [{ command: "echo unrelated" }] } }, null, 2),
    "utf8",
  );

  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });
  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });

  const hooksText = await readFile(join(codexRoot, "hooks.json"), "utf8");
  expect(hooksText.match(/echo unrelated/g)?.length).toBe(1);
  expect(hooksText.match(/codex-hook/g)?.length).toBe(3);
});

test("uninstall removes only myelin-owned hook entries", async () => {
  await writeFile(
    join(codexRoot, "hooks.json"),
    JSON.stringify({ hooks: { Stop: [{ command: "echo unrelated" }] } }, null, 2),
    "utf8",
  );
  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });
  await uninstallCodex({ providerRoot: codexRoot, myelinRoot: root, mode: "uninstall" });

  const hooksText = await readFile(join(codexRoot, "hooks.json"), "utf8");
  expect(hooksText).toContain("echo unrelated");
  expect(hooksText).not.toContain("codex-hook");
  expect(await Bun.file(join(codexRoot, ".myelin", "shim", "codex-hook")).exists()).toBe(false);
});
