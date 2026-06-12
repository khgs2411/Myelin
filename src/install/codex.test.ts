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
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
    const handlers = myelinHandlers(hooks, event);
    expect(handlers).toHaveLength(1);
    expect(handlers[0].type).toBe("command");
    expect(handlers[0].command).toContain(".myelin/shim/codex-hook");
  }
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
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo unrelated" }] }] } }, null, 2),
    "utf8",
  );

  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });
  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });

  const hooks = JSON.parse(await readFile(join(codexRoot, "hooks.json"), "utf8"));
  expect(JSON.stringify(hooks).match(/echo unrelated/g)?.length).toBe(1);
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
    expect(myelinHandlers(hooks, event)).toHaveLength(1);
  }
});

test("apply replaces legacy invalid myelin hook entries", async () => {
  await writeFile(
    join(codexRoot, "hooks.json"),
    JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [
            { command: join(codexRoot, ".myelin", "shim", "codex-hook") },
            { hooks: [{ type: "command", command: "echo unrelated" }] },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });

  const hooks = JSON.parse(await readFile(join(codexRoot, "hooks.json"), "utf8"));
  expect(hooks.hooks.UserPromptSubmit.some((entry: { command?: string }) => entry.command?.includes("codex-hook"))).toBe(
    false,
  );
  expect(JSON.stringify(hooks)).toContain("echo unrelated");
  expect(myelinHandlers(hooks, "UserPromptSubmit")).toHaveLength(1);
  expect(myelinHandlers(hooks, "UserPromptSubmit")[0].type).toBe("command");
});

test("uninstall removes only myelin-owned hook entries", async () => {
  await writeFile(
    join(codexRoot, "hooks.json"),
    JSON.stringify(
      {
        hooks: {
          Stop: [
            { command: "echo legacy unrelated" },
            { hooks: [{ type: "command", command: "echo grouped unrelated" }] },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await applyCodexInstall({ providerRoot: codexRoot, myelinRoot: root, mode: "apply" });
  await uninstallCodex({ providerRoot: codexRoot, myelinRoot: root, mode: "uninstall" });

  const hooksText = await readFile(join(codexRoot, "hooks.json"), "utf8");
  expect(hooksText).toContain("echo legacy unrelated");
  expect(hooksText).toContain("echo grouped unrelated");
  expect(hooksText).not.toContain("codex-hook");
  expect(await Bun.file(join(codexRoot, ".myelin", "shim", "codex-hook")).exists()).toBe(false);
});

function myelinHandlers(hooks: { hooks: Record<string, unknown> }, event: string): Array<{ type?: string; command?: string }> {
  const groups = hooks.hooks[event];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => {
    if (!group || typeof group !== "object" || !("hooks" in group)) return [];
    const handlers = (group as { hooks?: unknown }).hooks;
    if (!Array.isArray(handlers)) return [];
    return handlers.filter(
      (handler): handler is { type?: string; command?: string } =>
        Boolean(
          handler &&
            typeof handler === "object" &&
            "command" in handler &&
            typeof (handler as { command?: unknown }).command === "string" &&
            (handler as { command: string }).command.includes(".myelin/shim/codex-hook"),
        ),
    );
  });
}
