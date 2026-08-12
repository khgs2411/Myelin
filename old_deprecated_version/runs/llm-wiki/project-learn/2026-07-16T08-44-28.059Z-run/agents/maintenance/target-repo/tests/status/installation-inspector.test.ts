import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceRegistry } from "../../src/status/contracts.ts";
import { inspectInstallation } from "../../src/status/installation-inspector.ts";
import { planInstalledVersion, promoteInstalledVersion } from "../../src/install/version-store.ts";
import { launcherSha256, promoteLauncher, renderLauncher } from "../../src/install/launcher.ts";
import { promoteMachineLocator } from "../../src/install/machine-locator.ts";
import type { InstalledVersion } from "../../src/install/version-contracts.ts";

let sandbox: string;
let root: string;
let storeRoot: string;
let locatorPath: string;
let launcherPath: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "myelin-install-status-"));
  root = join(sandbox, "checkout");
  storeRoot = join(sandbox, "store");
  locatorPath = join(sandbox, "home", ".myelin", "install.json");
  launcherPath = join(sandbox, "home", ".local", "bin", "myelin");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "cli.ts"), "console.log('fixture');\n", "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ version: "1.0.0" })}\n`, "utf8");
  await writeFile(join(root, "myelin.config"), "", "utf8");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

test("reports a verified managed installation as healthy", async () => {
  const active = await installVersion("tx-1");
  await writeLocator(active, null);

  const result = await inspectInstallation({ root, locatorPath, evidence: new EvidenceRegistry(root) });

  expect(result.section).toMatchObject({ state: "healthy", lifecycle: "installed_managed", locator_schema_version: 2 });
  expect(result.warnings).toEqual([]);
});

test("blocks when active immutable runtime bytes no longer match the manifest", async () => {
  const active = await installVersion("tx-1");
  await writeLocator(active, null);
  await writeFile(join(active.path, "src", "cli.ts"), "tampered\n", "utf8");

  const result = await inspectInstallation({ root, locatorPath, evidence: new EvidenceRegistry(root) });

  expect(result.section.state).toBe("blocked");
  expect(result.warnings[0].message).toContain("content hash mismatch");
});

test("reports missing previous version as attention while active installation remains valid", async () => {
  const previous = await installVersion("tx-1");
  await writeFile(join(root, "src", "cli.ts"), "console.log('v2');\n", "utf8");
  const active = await installVersion("tx-2");
  await writeLocator(active, previous);
  await rm(previous.path, { recursive: true, force: true });

  const result = await inspectInstallation({ root, locatorPath, evidence: new EvidenceRegistry(root) });

  expect(result.section.state).toBe("attention");
  expect(result.warnings[0].code).toBe("INSTALLATION_ROLLBACK_UNAVAILABLE");
});

async function installVersion(transactionId: string): Promise<InstalledVersion> {
  const plan = await planInstalledVersion({ sourceRoot: root, storeRoot, installedAt: "2026-07-12T12:00:00.000Z" });
  await promoteInstalledVersion({ sourceRoot: root, storeRoot, transactionId, plan });
  return plan.version;
}

async function writeLocator(active: InstalledVersion, previous: InstalledVersion | null): Promise<void> {
  const launcher = renderLauncher(locatorPath);
  await promoteLauncher(launcherPath, launcher);
  await promoteMachineLocator(locatorPath, {
    schema_version: 2,
    data_root: root,
    store_root: storeRoot,
    active_version: active,
    previous_version: previous,
    launcher: { path: launcherPath, sha256: launcherSha256(launcher) },
    providers: {},
    installed_at: "2026-07-12T12:00:00.000Z",
    updated_at: "2026-07-12T12:00:00.000Z",
  });
}
