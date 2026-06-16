import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallService } from "../../src/install/install-service.ts";

let root: string;
let codexRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-install-service-"));
  codexRoot = join(root, ".codex");
  await mkdir(codexRoot, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("install service owns preview and apply provider workflow", async () => {
  const service = new InstallService({ myelinRoot: root, codexRoot, isInteractive: false });

  const preview = await service.install({ apply: false, provider: null });
  const applied = await service.install({ apply: true, provider: "codex" });

  expect(preview.mode).toBe("preview");
  expect(preview.plan.provider).toBe("codex");
  expect(applied.mode).toBe("apply");
  expect(await Bun.file(join(codexRoot, "hooks.json")).exists()).toBe(true);
});

test("install service requires explicit provider when non-interactive apply detects multiple providers", async () => {
  const service = new InstallService({
    myelinRoot: root,
    codexRoot,
    isInteractive: false,
    detectedProviders: ["codex", "future-provider"],
  });

  await expect(service.install({ apply: true, provider: null })).rejects.toThrow("Multiple providers detected");
});
