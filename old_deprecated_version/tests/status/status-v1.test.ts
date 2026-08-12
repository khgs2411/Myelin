import { expect, test } from "bun:test";
import healthy from "../fixtures/status/healthy.json";
import blocked from "../fixtures/status/blocked.json";
import type { OperationalStatusResult } from "../../src/status/contracts.ts";
import { unavailableSessionCurrentContinuity } from "../../src/memory/session-current-continuity.ts";
import { serializeStatusV1, type ProjectOperationalStatusV1 } from "../../src/status/status-v1.ts";

const LEGACY = ["answer", "confidence", "memory_scope", "citations", "candidate_ids", "degraded", "degraded_reason", "source_tools"];

test("serializes the exact healthy V1 fixture", () => {
  expect(serializeStatusV1(normalized(healthy))).toEqual(withBriefing(healthy));
});

test("serializes the exact blocked V1 fixture", () => {
  expect(serializeStatusV1(normalized(blocked))).toEqual(withBriefing(blocked));
});

test("V1 owns exact top-level keys and excludes every shallow legacy field", () => {
  const output = serializeStatusV1(normalized(healthy));
  expect(Object.keys(output)).toEqual(["contract_version", "kind", "generated_at", "overall_state", "project", "installation", "session_memory", "project_memory", "briefing", "warnings", "actions", "evidence"]);
  const keys = allKeys(output);
  for (const key of LEGACY) expect(keys.has(key)).toBe(false);
});

test("serializer deterministically orders public collections", () => {
  const input = normalized(healthy);
  input.project.repo_paths = ["/z", "/a"];
  input.installation.providers = [
    { name: "z", lifecycle: "installed", hooks_path: "/z", shim_path: "/z" },
    { name: "a", lifecycle: "installed", hooks_path: "/a", shim_path: "/a" },
  ];
  expect(serializeStatusV1(input).project.repo_paths).toEqual(["/a", "/z"]);
  expect(serializeStatusV1(input).installation.providers.map((item) => item.name)).toEqual(["a", "z"]);
});

function normalized(fixture: any): OperationalStatusResult {
  const { contract_version: _version, kind: _kind, ...result } = structuredClone(fixture);
  return { ...result, session_continuity: unavailableSessionCurrentContinuity() } as OperationalStatusResult;
}

function withBriefing(fixture: any): ProjectOperationalStatusV1 {
  return {
    ...structuredClone(fixture),
    briefing: {
      contract_version: "myelin.status.briefing.v1",
      session_continuity: unavailableSessionCurrentContinuity(),
    },
  } as ProjectOperationalStatusV1;
}

function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) allKeys(item, keys);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { keys.add(key); allKeys(item, keys); }
  return keys;
}
