import { expect, test } from "bun:test";
import {
  PROJECT_MEMORY_CURATOR_BUDGET_KEYS,
  PROJECT_MEMORY_CURATOR_MODES,
  PROJECT_MEMORY_LIFECYCLE_INTENTS,
  PROJECT_MEMORY_MAINTENANCE_OPERATIONS,
  PROJECT_MEMORY_VALIDATION_OUTCOMES,
  PROJECT_MEMORY_VALIDATOR_ISSUE_CATEGORIES,
} from "../../src/project/project-memory-curator-contracts.ts";

test("curator modes expose the create and maintain authority profiles", () => {
  expect(PROJECT_MEMORY_CURATOR_MODES).toEqual(["create", "maintain"]);
});

test("curator maintenance operations expose the pre-write operation set", () => {
  expect(PROJECT_MEMORY_MAINTENANCE_OPERATIONS).toEqual([
    "CREATE_ENTRY",
    "PATCH_ENTRY",
    "ATTACH_EVIDENCE",
    "MARK_STALE",
    "MARK_DISPUTED",
    "SUPERSEDE_ENTRY",
    "RETRACT_ENTRY",
    "NOOP",
  ]);
});

test("curator validation outcomes expose the per-item outcome set", () => {
  expect(PROJECT_MEMORY_VALIDATION_OUTCOMES).toEqual(["eligible", "rejected", "quarantined", "noop"]);
});

test("curator lifecycle intents expose the pre-write status vocabulary", () => {
  expect(PROJECT_MEMORY_LIFECYCLE_INTENTS).toEqual([
    "active",
    "stale_pending",
    "disputed",
    "superseded",
    "retracted",
  ]);
});

test("validator issue categories cover deterministic rejection and quarantine reasons", () => {
  expect(PROJECT_MEMORY_VALIDATOR_ISSUE_CATEGORIES).toEqual([
    "schema",
    "mode",
    "project_key",
    "packet_ref",
    "operation",
    "path",
    "provenance",
    "repo_citation",
    "lifecycle",
    "risk",
    "budget",
    "degraded_context",
    "protected_state",
  ]);
});

test("curator budget keys expose the pre-write budget dimensions", () => {
  expect(PROJECT_MEMORY_CURATOR_BUDGET_KEYS).toEqual(["max_items", "max_content_chars"]);
});
