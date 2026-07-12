import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  parseMachineLocator,
  readMachineLocator,
  type MachineLocatorV1,
} from "../runtime/launch-context.ts";

export { parseMachineLocator, readMachineLocator, type MachineLocatorV1 };

export function serializeMachineLocator(locator: MachineLocatorV1): string {
  parseMachineLocator(locator);
  return `${JSON.stringify(locator, null, 2)}\n`;
}

export async function readMachineLocatorIfExists(path: string): Promise<MachineLocatorV1 | null> {
  try {
    await stat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  return await readMachineLocator(path);
}

export async function promoteMachineLocator(path: string, locator: MachineLocatorV1): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  await writeFile(temporary, serializeMachineLocator(locator), { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function machineLocatorMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

export async function machineLocatorText(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
