import { expect, test } from "bun:test";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("repo installer is an executable regular delegator to the shared install command", async () => {
  const path = resolve("install");
  const metadata = await lstat(path);
  const source = await readFile(path, "utf8");

  expect(metadata.isFile()).toBe(true);
  expect(metadata.isSymbolicLink()).toBe(false);
  expect(metadata.mode & 0o111).not.toBe(0);
  expect(source).toContain('"$ROOT/src/cli.ts" install "$@"');
  expect(source).not.toContain("~/.myelin");
});
