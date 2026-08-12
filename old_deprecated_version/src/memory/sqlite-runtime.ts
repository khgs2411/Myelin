import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { resolveInside } from "../runtime/fs.ts";

const HOMEBREW_SQLITE_DYLIB_PATHS = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
];

let configured = false;

export function configureBunSQLite(root?: string): string | null {
  if (configured) return null;
  configured = true;

  const path = resolveCustomSQLitePath(root);
  if (!path) return null;
  Database.setCustomSQLite(path);
  return path;
}

export function resolveCustomSQLitePath(root?: string): string | null {
  const configuredPath =
    process.env.MYELIN_SQLITE_DYLIB_PATH ??
    process.env.SQLITE_DYLIB_PATH ??
    valueFromLocalFile(root, ".env", "MYELIN_SQLITE_DYLIB_PATH") ??
    valueFromLocalFile(root, ".env", "SQLITE_DYLIB_PATH") ??
    valueFromLocalFile(root, "myelin.config", "MYELIN_SQLITE_DYLIB_PATH") ??
    valueFromLocalFile(root, "myelin.config", "SQLITE_DYLIB_PATH");

  if (configuredPath) return configuredPath;

  const vendoredPath = vendoredSQLitePath();
  if (vendoredPath && existsSync(vendoredPath)) return vendoredPath;

  if (process.platform !== "darwin") return null;
  return HOMEBREW_SQLITE_DYLIB_PATHS.find((path) => existsSync(path)) ?? null;
}

export function vendoredSQLitePath(): string | null {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return join(import.meta.dir, "..", "..", "vendor", "sqlite", "darwin-arm64", "libsqlite3.dylib");
  }
  return null;
}

function valueFromLocalFile(root: string | undefined, fileName: string, key: string): string | undefined {
  if (!root) return undefined;
  const path = resolveInside(root, fileName);
  if (!existsSync(path)) return undefined;
  const values = parseDotenv(readFileSync(path, "utf8"));
  return values[key];
}

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}
