import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { InstallJournalV1, MachineActionId, MachineInstallAction } from "./types.ts";
import { parseMachineLocator } from "../runtime/launch-context.ts";

export function createInstallJournal(input: {
  transactionId: string;
  operation: InstallJournalV1["operation"];
  myelinRoot: string;
  launcherPath: string;
  locatorPath: string;
  desiredManifest: InstallJournalV1["desired_manifest"];
  actions: MachineInstallAction[];
  createdAt: string;
}): InstallJournalV1 {
  return {
    schema_version: 1,
    transaction_id: input.transactionId,
    operation: input.operation,
    myelin_root: input.myelinRoot,
    launcher_path: input.launcherPath,
    locator_path: input.locatorPath,
    desired_manifest: input.desiredManifest,
    actions: input.actions.map((action) => ({ ...action, state: "pending" })),
    created_at: input.createdAt,
  };
}

export async function readInstallJournalIfExists(path: string): Promise<InstallJournalV1 | null> {
  try {
    await stat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`Myelin install journal is malformed at ${path}. Complete recovery before another operation.`);
  }
  return parseInstallJournal(value, path);
}

export function parseInstallJournal(value: unknown, path = "install journal"): InstallJournalV1 {
  if (!isRecord(value) || value.schema_version !== 1) throw invalid(path, "unsupported schema");
  if (!isNonEmpty(value.transaction_id)) throw invalid(path, "transaction_id is required");
  if (value.operation !== "install" && value.operation !== "uninstall") throw invalid(path, "operation is invalid");
  for (const [key, field] of [
    ["myelin_root", value.myelin_root],
    ["launcher_path", value.launcher_path],
    ["locator_path", value.locator_path],
  ] as const) {
    if (typeof field !== "string" || !isAbsolute(field)) throw invalid(path, `${key} must be absolute`);
  }
  if (value.desired_manifest !== null) parseMachineLocator(value.desired_manifest, path);
  if (!Array.isArray(value.actions)) throw invalid(path, "actions must be an array");
  for (const action of value.actions) parseAction(action, path);
  if (!isNonEmpty(value.created_at)) throw invalid(path, "created_at is required");
  return value as InstallJournalV1;
}

export async function writeInstallJournal(path: string, journal: InstallJournalV1): Promise<void> {
  parseInstallJournal(journal, path);
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function markInstallActionComplete(
  path: string,
  journal: InstallJournalV1,
  actionId: MachineActionId,
): Promise<void> {
  const action = journal.actions.find((candidate) => candidate.id === actionId);
  if (!action) throw new Error(`Install journal does not contain action ${actionId}.`);
  action.state = "complete";
  await writeInstallJournal(path, journal);
}

export async function removeInstallJournal(path: string): Promise<void> {
  await rm(path, { force: true });
}

function parseAction(value: unknown, path: string): void {
  if (!isRecord(value)) throw invalid(path, "action must be an object");
  const id = String(value.id);
  const fixedIds = ["promote_launcher", "promote_locator", "remove_launcher", "remove_locator"];
  if (!fixedIds.includes(id) && id !== "apply_provider:codex" && id !== "remove_provider:codex") {
    throw invalid(path, "action id is invalid");
  }
  if (!isNonEmpty(value.description) || !isNonEmpty(value.path) || !isAbsolute(value.path)) {
    throw invalid(path, "action path/description is invalid");
  }
  if (value.expected_sha256 !== null && !isNonEmpty(value.expected_sha256)) throw invalid(path, "action hash is invalid");
  if (value.state !== "pending" && value.state !== "complete") throw invalid(path, "action state is invalid");
  if (value.backup_path !== null && (typeof value.backup_path !== "string" || !isAbsolute(value.backup_path))) {
    throw invalid(path, "backup_path is invalid");
  }
}

function invalid(path: string, detail: string): Error {
  return new Error(`Invalid Myelin install journal at ${path}: ${detail}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
