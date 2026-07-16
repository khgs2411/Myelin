import { dirname, relative } from "node:path";
import type {
  ProjectMemoryApplyJournal,
  ProjectMemoryExpectedWrite,
  ProjectMemoryObservedPromotion,
} from "./project-memory-apply-contracts.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const STATUSES = new Set(["staged", "promoting", "recovered", "applied", "failed"]);
const MODES = new Set(["create", "maintain"]);
const WRITE_KINDS = new Set(["wiki_page", "project_state", "repository_identity_state", "page_state", "source_consumption_state", "log"]);

export function assertProjectMemoryApplyJournal(input: {
  root: string;
  journalPath: string;
  value: unknown;
  expectedProjectKey?: string;
}): asserts input is typeof input & { value: ProjectMemoryApplyJournal } {
  const journal = object(input.value, "apply journal");
  if (journal.schema_version !== 1) fail("schema_version must be 1");
  const projectKey = nonEmptyString(journal.project_key, "project_key");
  if (!/^[a-zA-Z0-9_-]+$/.test(projectKey)) fail("project_key is invalid");
  if (input.expectedProjectKey && projectKey !== input.expectedProjectKey) fail("project_key mismatch");
  if (!MODES.has(journal.mode as string)) fail("mode is invalid");
  if (!STATUSES.has(journal.status as string)) fail("status is invalid");
  if (journal.packet_ref !== "input-packet.json") fail("packet_ref is invalid");
  if (journal.validation_ref !== "curator-validation.json") fail("validation_ref is invalid");
  safeRelativePath(journal.curator_output_ref, "curator_output_ref");
  const stagedDir = safeRelativePath(journal.staged_outputs_dir, "staged_outputs_dir");
  if (stagedDir !== "staged") fail("staged_outputs_dir must be staged");

  const runDir = safeRelativePath(journal.run_dir, "run_dir");
  const expectedRunPrefix = `projects/${projectKey}/runs/project-learn/`;
  if (!runDir.startsWith(expectedRunPrefix) || runDir.slice(expectedRunPrefix.length).includes("/")) {
    fail("run_dir does not identify this project's curator run");
  }
  const actualRunDir = relative(input.root, dirname(input.journalPath)).replaceAll("\\", "/");
  if (actualRunDir !== runDir) fail("run_dir does not match journal location");

  if (!Array.isArray(journal.expected_writes)) fail("expected_writes must be an array");
  if (!Array.isArray(journal.observed_promotions)) fail("observed_promotions must be an array");
  const expected = journal.expected_writes.map((value, index) => expectedWrite(value, projectKey, stagedDir, index));
  const expectedPaths = new Set<string>();
  const stagedRefs = new Set<string>();
  for (const write of expected) {
    if (expectedPaths.has(write.canonical_path)) fail(`duplicate canonical_path: ${write.canonical_path}`);
    if (stagedRefs.has(write.staged_output_ref)) fail(`duplicate staged_output_ref: ${write.staged_output_ref}`);
    expectedPaths.add(write.canonical_path);
    stagedRefs.add(write.staged_output_ref);
  }

  const observed = journal.observed_promotions.map((value, index) => observedPromotion(value, index));
  const observedPaths = new Set<string>();
  for (let index = 0; index < observed.length; index += 1) {
    const promotion = observed[index];
    if (observedPaths.has(promotion.canonical_path)) fail(`duplicate observed canonical_path: ${promotion.canonical_path}`);
    if (promotion.canonical_path !== expected[index]?.canonical_path) {
      fail("observed_promotions must be an ordered prefix of expected_writes");
    }
    observedPaths.add(promotion.canonical_path);
  }
  if ((journal.status === "applied" || journal.status === "recovered") && observed.length !== expected.length) {
    fail(`terminal ${journal.status} journal must observe every expected write`);
  }
  if (journal.status === "staged" && observed.length !== 0) fail("staged journal cannot contain observed promotions");

  const recovery = object(journal.recovery, "recovery");
  if (typeof recovery.required_before_new_curator !== "boolean") fail("recovery.required_before_new_curator must be boolean");
  if ((journal.status === "staged" || journal.status === "promoting" || journal.status === "failed") && !recovery.required_before_new_curator) {
    fail(`recovery is required while journal status is ${journal.status}`);
  }
  if ((journal.status === "applied" || journal.status === "recovered") && recovery.required_before_new_curator) {
    fail(`recovery cannot remain required when journal status is ${journal.status}`);
  }
  optionalIsoDate(recovery.last_attempt_at, "recovery.last_attempt_at");
  if (recovery.guidance !== undefined && typeof recovery.guidance !== "string") fail("recovery.guidance must be a string");
}

function expectedWrite(value: unknown, projectKey: string, stagedDir: string, index: number): ProjectMemoryExpectedWrite {
  const write = object(value, `expected_writes[${index}]`);
  const kind = nonEmptyString(write.write_kind, `expected_writes[${index}].write_kind`);
  if (!WRITE_KINDS.has(kind)) fail(`expected_writes[${index}].write_kind is invalid`);
  const canonical = safeRelativePath(write.canonical_path, `expected_writes[${index}].canonical_path`);
  assertCanonicalPath(kind as ProjectMemoryExpectedWrite["write_kind"], canonical, projectKey);
  const staged = safeRelativePath(write.staged_output_ref, `expected_writes[${index}].staged_output_ref`);
  if (!staged.startsWith(`${stagedDir}/`)) fail(`expected_writes[${index}].staged_output_ref is outside staged outputs`);
  if (write.before_sha256 !== null && (typeof write.before_sha256 !== "string" || !SHA256.test(write.before_sha256))) {
    fail(`expected_writes[${index}].before_sha256 is invalid`);
  }
  if (write.write_order !== index + 1) fail("expected_writes must have contiguous write_order values in promotion order");
  optionalStringArray(write.page_ids, `expected_writes[${index}].page_ids`);
  optionalStringArray(write.item_ids, `expected_writes[${index}].item_ids`);
  return write as unknown as ProjectMemoryExpectedWrite;
}

function observedPromotion(value: unknown, index: number): ProjectMemoryObservedPromotion {
  const promotion = object(value, `observed_promotions[${index}]`);
  safeRelativePath(promotion.canonical_path, `observed_promotions[${index}].canonical_path`);
  if (typeof promotion.after_sha256 !== "string" || !SHA256.test(promotion.after_sha256)) {
    fail(`observed_promotions[${index}].after_sha256 is invalid`);
  }
  isoDate(promotion.promoted_at, `observed_promotions[${index}].promoted_at`);
  return promotion as unknown as ProjectMemoryObservedPromotion;
}

function assertCanonicalPath(kind: ProjectMemoryExpectedWrite["write_kind"], path: string, projectKey: string): void {
  const projectPrefix = `projects/${projectKey}/`;
  if (!path.startsWith(projectPrefix)) fail(`canonical_path is outside project ${projectKey}`);
  const local = path.slice(projectPrefix.length);
  if (kind === "wiki_page" && (!local.startsWith("wiki/") || !local.endsWith(".md"))) fail("wiki_page canonical_path is invalid");
  if (kind === "project_state" && local !== "state/project-memory.json") fail("project_state canonical_path is invalid");
  if (kind === "repository_identity_state" && local !== "state/repository-identity.json") {
    fail("repository_identity_state canonical_path is invalid");
  }
  if (kind === "source_consumption_state" && local !== "state/project-memory-source-consumptions.json") {
    fail("source_consumption_state canonical_path is invalid");
  }
  if (kind === "page_state" && !local.startsWith("state/")) fail("page_state canonical_path is invalid");
  if (kind === "log" && !local.startsWith("log/")) fail("log canonical_path is invalid");
}

function safeRelativePath(value: unknown, name: string): string {
  const path = nonEmptyString(value, name).replaceAll("\\", "/");
  if (path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail(`${name} must be a normalized relative path`);
  }
  return path;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${name} must be a non-empty string`);
  return value;
}

function optionalStringArray(value: unknown, name: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) fail(`${name} must be a string array`);
}

function optionalIsoDate(value: unknown, name: string): void {
  if (value !== undefined) isoDate(value, name);
}

function isoDate(value: unknown, name: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${name} must be an ISO timestamp`);
  }
}

function fail(message: string): never {
  throw new Error(`invalid project memory apply journal: ${message}`);
}
