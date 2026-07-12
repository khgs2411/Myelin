import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { openMemoryDbAt } from "../../src/memory/db.ts";

test("installed command works across cwd classes and uninstalls only machine ownership", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "myelin-working-skeleton-"));
  try {
    const sourceRoot = resolve(import.meta.dir, "../..");
    const checkout = join(sandbox, "myelin-checkout");
    const home = join(sandbox, "home");
    const binDir = join(home, ".local", "bin");
    const codexRoot = join(home, ".codex");
    const externalRepo = join(sandbox, "external-repo");
    const unrelated = join(sandbox, "unrelated");
    await Promise.all([
      mkdir(checkout, { recursive: true }),
      mkdir(codexRoot, { recursive: true }),
      mkdir(externalRepo, { recursive: true }),
      mkdir(unrelated, { recursive: true }),
    ]);
    await Promise.all([
      cp(join(sourceRoot, "src"), join(checkout, "src"), { recursive: true }),
      cp(join(sourceRoot, "install"), join(checkout, "install")),
      cp(join(sourceRoot, "package.json"), join(checkout, "package.json")),
      cp(join(sourceRoot, "myelin.config"), join(checkout, "myelin.config")),
      symlink(join(sourceRoot, "node_modules"), join(checkout, "node_modules")),
    ]);
    await chmod(join(checkout, "install"), 0o755);
    const checkoutReal = await realpath(checkout);

    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      PATH: process.env.PATH,
      MYELIN_ROOT: undefined,
      MYELIN_INTERNAL_INVOCATION_KIND: undefined,
      MYELIN_INTERNAL_LAUNCHER_PATH: undefined,
      MYELIN_INTERNAL_LOCATOR_PATH: undefined,
    };
    const preview = run([join(checkout, "install"), "--command-only"], checkout, env);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("Mode: preview");
    expect(preview.stdout).toContain("is not on PATH");
    expect(await Bun.file(join(home, ".myelin", "install.json")).exists()).toBe(false);

    const applied = run([join(checkout, "install"), "--apply", "--command-only"], checkout, env);
    expect(applied.exitCode).toBe(0);
    const launcher = join(binDir, "myelin");
    const locator = join(home, ".myelin", "install.json");
    expect(await Bun.file(launcher).exists()).toBe(true);
    expect(await Bun.file(locator).exists()).toBe(true);
    expect(await realpath(JSON.parse(await readFile(locator, "utf8")).myelin_root)).toBe(checkoutReal);

    const installedEnv = { ...env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` };
    expect(run([launcher, "--help"], checkout, installedEnv).stdout).toContain("myelin status");

    const providerInstall = run([launcher, "install", "--apply", "--provider", "codex"], unrelated, installedEnv);
    expect(providerInstall.exitCode).toBe(0);
    expect(await Bun.file(join(codexRoot, ".myelin", "shim", "codex-hook")).exists()).toBe(true);
    const providerRemoval = run([launcher, "uninstall", "--apply", "--provider", "codex"], unrelated, installedEnv);
    expect(providerRemoval.exitCode).toBe(0);
    expect(await Bun.file(launcher).exists()).toBe(true);
    expect(await Bun.file(locator).exists()).toBe(true);

    const bootstrap = run([launcher, "bootstrap", "demo", "--repo", externalRepo], externalRepo, installedEnv);
    expect(bootstrap.exitCode).toBe(0);
    const db = openMemoryDbAt(join(checkout, "state", "memory.db"));
    db.close();
    const beforeHash = sha256(await readFile(join(checkout, "state", "memory.db")));

    const fromRegistered = run([launcher, "status", "--json"], externalRepo, installedEnv);
    if (fromRegistered.exitCode !== 0) throw new Error(fromRegistered.stderr || fromRegistered.stdout);
    expect(fromRegistered.exitCode).toBe(0);
    const registeredStatus = JSON.parse(fromRegistered.stdout);
    expect(registeredStatus.contract_version).toBe("myelin.status.v1");
    expect(registeredStatus.project).toMatchObject({ key: "demo", resolved_from: "cwd" });
    expect(await realpath(registeredStatus.installation.myelin_root)).toBe(checkoutReal);
    expect(registeredStatus.installation.lifecycle).toBe("installed");

    const fromUnrelated = run([launcher, "status", "demo", "--json"], unrelated, installedEnv);
    expect(fromUnrelated.exitCode).toBe(0);
    expect(JSON.parse(fromUnrelated.stdout).project.resolved_from).toBe("argument");
    const missingIdentity = run([launcher, "status", "--json"], unrelated, installedEnv);
    expect(missingIdentity.exitCode).toBe(1);
    expect(missingIdentity.stderr).toContain("Pass `myelin status <project-key>`");
    expect(sha256(await readFile(join(checkout, "state", "memory.db")))).toBe(beforeHash);

    const fullPreview = run([launcher, "uninstall"], unrelated, installedEnv);
    expect(fullPreview.exitCode).toBe(0);
    expect(await Bun.file(locator).exists()).toBe(true);
    const fullRemoval = run([launcher, "uninstall", "--apply"], unrelated, installedEnv);
    expect(fullRemoval.exitCode).toBe(0);
    expect(await Bun.file(launcher).exists()).toBe(false);
    expect(await Bun.file(locator).exists()).toBe(false);
    expect(await Bun.file(join(checkout, "myelin.config")).exists()).toBe(true);
    expect(await Bun.file(join(checkout, "state", "memory.db")).exists()).toBe(true);
    expect(await Bun.file(join(checkout, "projects", "demo", "wiki", "index.md")).exists()).toBe(true);

    for (const ownedPath of [home, binDir, codexRoot]) expect(resolve(ownedPath).startsWith(resolve(sandbox))).toBe(true);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}, 30_000);

function run(command: string[], cwd: string, env: Record<string, string | undefined>) {
  const result = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
