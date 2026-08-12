import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  INTERNAL_INVOCATION_KIND_ENV,
  INTERNAL_LAUNCHER_PATH_ENV,
  INTERNAL_LOCATOR_PATH_ENV,
} from "../runtime/launch-context.ts";

export type LauncherInspection =
  | { status: "missing"; sha256: null }
  | { status: "owned" | "mismatch"; sha256: string }
  | { status: "symlink"; sha256: null };

export function renderLauncher(locatorPath: string): string {
  return [
    "#!/usr/bin/env bun",
    'import { readFileSync, statSync } from "node:fs";',
    'import { isAbsolute, join } from "node:path";',
    `const locatorPath = ${JSON.stringify(locatorPath)};`,
    "try {",
    '  const locator = JSON.parse(readFileSync(locatorPath, "utf8"));',
    '  if ((locator?.schema_version !== 1 && locator?.schema_version !== 2) || !isAbsolute(locator?.launcher?.path ?? "")) throw new Error("invalid locator");',
    "  const dataRoot = locator.schema_version === 2 ? locator.data_root : locator.myelin_root;",
    "  const runtimeRoot = locator.schema_version === 2 ? locator.active_version?.path : locator.myelin_root;",
    '  if (!isAbsolute(dataRoot ?? "") || !isAbsolute(runtimeRoot ?? "")) throw new Error("invalid locator roots");',
    '  if (!statSync(dataRoot).isDirectory()) throw new Error(`recorded Myelin data root is missing: ${dataRoot}`);',
    '  if (!statSync(runtimeRoot).isDirectory()) throw new Error(`recorded Myelin runtime root is missing: ${runtimeRoot}`);',
    `  process.env.${INTERNAL_INVOCATION_KIND_ENV} ||= "installed";`,
    `  process.env.${INTERNAL_LAUNCHER_PATH_ENV} = locator.launcher.path;`,
    `  process.env.${INTERNAL_LOCATOR_PATH_ENV} = locatorPath;`,
    "  process.env.MYELIN_ROOT = dataRoot;",
    '  const child = Bun.spawnSync([process.execPath, join(runtimeRoot, "src", "cli.ts"), ...process.argv.slice(2)], {',
    "    cwd: process.cwd(),",
    "    env: process.env,",
    '    stdin: "inherit", stdout: "inherit", stderr: "inherit",',
    "  });",
    "  process.exit(child.exitCode);",
    "} catch (error) {",
    '  console.error(`Myelin launcher failed using ${locatorPath}: ${error instanceof Error ? error.message : String(error)}. Re-run install --apply from the Myelin checkout.`);',
    "  process.exit(1);",
    "}",
    "",
  ].join("\n");
}

export function launcherSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function inspectLauncher(path: string, expectedSha256: string): Promise<LauncherInspection> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return { status: "symlink", sha256: null };
    if (!metadata.isFile()) return { status: "mismatch", sha256: "non-file" };
    const sha256 = launcherSha256(await readFile(path, "utf8"));
    return { status: sha256 === expectedSha256 ? "owned" : "mismatch", sha256 };
  } catch (error) {
    if (hasCode(error, "ENOENT")) return { status: "missing", sha256: null };
    throw error;
  }
}

export async function promoteLauncher(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o755 });
  await chmod(temporary, 0o755);
  await rename(temporary, path);
  await chmod(path, 0o755);
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
