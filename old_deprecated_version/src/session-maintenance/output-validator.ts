import type { SessionMaintenanceOutput, SessionMaintenanceProjection } from "./output-contract.ts";

export const sessionMaintenanceOutputRef = {
  sessionMemory: (id: string): string => `session_memories/${id}`,
  memoryCandidate: (id: string): string => `memory_candidates/${id}`,
  handoffInstruction: (id: string): string => `handoff_instructions/${id}`,
  memoryDisposition: (memoryId: string): string => `memory_dispositions/${memoryId}`,
};

export type SessionMaintenanceValidationIssueCode =
  | "duplicate_expected_active_memory"
  | "duplicate_expected_source_event"
  | "duplicate_memory_disposition"
  | "missing_memory_disposition"
  | "lifecycle_target_outside_snapshot"
  | "duplicate_source_event_disposition"
  | "missing_source_event_disposition"
  | "source_event_outside_snapshot"
  | "duplicate_output_id"
  | "new_memory_id_collides_with_active_memory"
  | "invalid_supersession_replacement"
  | "duplicate_handoff_source_memory_ref"
  | "handoff_source_memory_ref_not_found"
  | "duplicate_source_event_ref"
  | "source_event_ref_outside_snapshot"
  | "source_event_disposition_conflict"
  | "output_ref_mismatch";

export type SessionMaintenanceValidationIssue = {
  code: SessionMaintenanceValidationIssueCode;
  path: string;
  message: string;
};

export type SessionMaintenanceValidationResult =
  | { valid: true; issues: [] }
  | { valid: false; issues: SessionMaintenanceValidationIssue[] };

export class SessionMaintenanceOutputValidationError extends Error {
  constructor(readonly issues: SessionMaintenanceValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "SessionMaintenanceOutputValidationError";
  }
}

export function inspectSessionMaintenanceOutput(input: {
  output: SessionMaintenanceOutput;
  expectedActiveMemoryIds: readonly string[];
  expectedSourceEventIds: readonly string[];
}): SessionMaintenanceValidationResult {
  const issues: SessionMaintenanceValidationIssue[] = [];
  const expectedMemoryIds = checkedExpectedSet(
    input.expectedActiveMemoryIds,
    "expectedActiveMemoryIds",
    "duplicate_expected_active_memory",
    issues,
  );
  const expectedSourceIds = checkedExpectedSet(
    input.expectedSourceEventIds,
    "expectedSourceEventIds",
    "duplicate_expected_source_event",
    issues,
  );

  validateMemoryDispositions(input.output, expectedMemoryIds, issues);
  validateSourceEventDispositions(input.output, expectedSourceIds, issues);
  validateOutputIdsAndReplacements(input.output, expectedMemoryIds, issues);
  validateHandoffSourceMemoryReferences(input.output, expectedMemoryIds, issues);
  validateSourceReferences(input.output, expectedSourceIds, issues);
  validateDeclaredOutputReferences(input.output, issues);

  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

export function validateSessionMaintenanceOutput(input: {
  output: SessionMaintenanceOutput;
  expectedActiveMemoryIds: readonly string[];
  expectedSourceEventIds: readonly string[];
}): SessionMaintenanceOutput {
  const result = inspectSessionMaintenanceOutput(input);
  if (!result.valid) throw new SessionMaintenanceOutputValidationError(result.issues);
  return input.output;
}

export function inspectSessionMaintenanceProjection(input: {
  projection: SessionMaintenanceProjection;
  expectedAffectedMemoryIds: readonly string[];
  expectedSourceEventIds: readonly string[];
  inheritedSourceEventIds?: readonly string[];
}): SessionMaintenanceValidationResult {
  const issues: SessionMaintenanceValidationIssue[] = [];
  const expectedMemoryIds = checkedExpectedSet(
    input.expectedAffectedMemoryIds,
    "expectedAffectedMemoryIds",
    "duplicate_expected_active_memory",
    issues,
  );
  const expectedSourceIds = checkedExpectedSet(
    input.expectedSourceEventIds,
    "expectedSourceEventIds",
    "duplicate_expected_source_event",
    issues,
  );
  const seenMemories = new Set<string>();
  input.projection.memory_dispositions.forEach((item, index) => {
    if (seenMemories.has(item.memory_id)) {
      issue(issues, "duplicate_memory_disposition", `memory_dispositions[${index}].memory_id`, `duplicate disposition for ${item.memory_id}`);
    }
    seenMemories.add(item.memory_id);
    if (!expectedMemoryIds.has(item.memory_id)) {
      issue(issues, "lifecycle_target_outside_snapshot", `memory_dispositions[${index}].memory_id`, `${item.memory_id} is not in the affected work set`);
    }
  });
  for (const id of sorted(expectedMemoryIds)) {
    if (!seenMemories.has(id)) issue(issues, "missing_memory_disposition", "memory_dispositions", `missing disposition for ${id}`);
  }
  const seenSources = new Set<string>();
  input.projection.source_event_dispositions.forEach((item, index) => {
    if (seenSources.has(item.source_event_id)) {
      issue(issues, "duplicate_source_event_disposition", `source_event_dispositions[${index}].source_event_id`, `duplicate disposition for ${item.source_event_id}`);
    }
    seenSources.add(item.source_event_id);
    if (!expectedSourceIds.has(item.source_event_id)) {
      issue(issues, "source_event_outside_snapshot", `source_event_dispositions[${index}].source_event_id`, `${item.source_event_id} is not selected evidence`);
    }
  });
  for (const id of sorted(expectedSourceIds)) {
    if (!seenSources.has(id)) issue(issues, "missing_source_event_disposition", "source_event_dispositions", `missing disposition for ${id}`);
  }
  const legacyView: SessionMaintenanceOutput = {
    schema_version: 1,
    session_memories: input.projection.session_memories,
    memory_candidates: input.projection.memory_candidates,
    handoff_instructions: input.projection.handoff_instructions,
    memory_dispositions: input.projection.memory_dispositions.map((item) => {
      const { revision_identity: _revision, work_kind: _workKind, ...legacy } = item;
      return legacy;
    }),
    source_event_dispositions: input.projection.source_event_dispositions,
    terminal_summary: null,
  };
  validateOutputIdsAndReplacements(legacyView, expectedMemoryIds, issues);
  validateHandoffSourceMemoryReferences(legacyView, expectedMemoryIds, issues);
  validateSourceReferences(
    legacyView,
    new Set([...expectedSourceIds, ...(input.inheritedSourceEventIds ?? [])]),
    issues,
  );
  validateProjectionDeclaredOutputReferences(legacyView, issues);
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

function validateProjectionDeclaredOutputReferences(
  output: SessionMaintenanceOutput,
  issues: SessionMaintenanceValidationIssue[],
): void {
  const resolvable = new Set(outputsWithSourceRefs(output).map((item) => item.outputRef));
  const provenanceBySource = new Map<string, Set<string>>();
  for (const source of outputsWithSourceRefs(output)) {
    for (const sourceId of source.sourceEventRefs) {
      const refs = provenanceBySource.get(sourceId) ?? new Set<string>();
      refs.add(source.outputRef);
      provenanceBySource.set(sourceId, refs);
    }
  }
  output.source_event_dispositions.forEach((item, index) => {
    const required = provenanceBySource.get(item.source_event_id) ?? new Set<string>();
    const path = `source_event_dispositions[${index}]`;
    if (item.disposition === "no_output") {
      if (required.size > 0) {
        issue(issues, "source_event_disposition_conflict", path, `${item.source_event_id} is marked no_output but is cited by ${sorted(required).join(", ")}`);
      }
      return;
    }
    const declared = new Set(item.output_refs);
    if (declared.size !== item.output_refs.length) {
      issue(issues, "output_ref_mismatch", `${path}.output_refs`, "output_refs contains duplicates");
    }
    for (const ref of declared) {
      if (!resolvable.has(ref)) {
        issue(issues, "output_ref_mismatch", `${path}.output_refs`, `${ref} does not resolve in the accepted projection`);
      }
    }
    for (const ref of required) {
      if (!declared.has(ref)) {
        issue(issues, "output_ref_mismatch", `${path}.output_refs`, `missing provenance reference ${ref}`);
      }
    }
  });
}

function validateHandoffSourceMemoryReferences(
  output: SessionMaintenanceOutput,
  expectedMemoryIds: ReadonlySet<string>,
  issues: SessionMaintenanceValidationIssue[],
): void {
  const allowedMemoryIds = new Set([
    ...expectedMemoryIds,
    ...output.session_memories.map((memory) => memory.id),
  ]);

  output.handoff_instructions.forEach((handoff, handoffIndex) => {
    const seen = new Set<string>();
    handoff.source_session_memory_ids.forEach((memoryId, memoryIndex) => {
      const path = `handoff_instructions[${handoffIndex}].source_session_memory_ids[${memoryIndex}]`;
      if (seen.has(memoryId)) {
        issue(
          issues,
          "duplicate_handoff_source_memory_ref",
          path,
          `duplicate source Session Memory reference ${memoryId}`,
        );
      }
      seen.add(memoryId);
      if (!allowedMemoryIds.has(memoryId)) {
        issue(
          issues,
          "handoff_source_memory_ref_not_found",
          path,
          `${memoryId} is neither in the active-memory snapshot nor newly emitted session_memories`,
        );
      }
    });
  });
}

function validateMemoryDispositions(
  output: SessionMaintenanceOutput,
  expectedMemoryIds: ReadonlySet<string>,
  issues: SessionMaintenanceValidationIssue[],
): void {
  const seen = new Set<string>();
  output.memory_dispositions.forEach((item, index) => {
    const path = `memory_dispositions[${index}].memory_id`;
    if (seen.has(item.memory_id)) {
      issue(issues, "duplicate_memory_disposition", path, `duplicate disposition for ${item.memory_id}`);
    }
    seen.add(item.memory_id);
    if (!expectedMemoryIds.has(item.memory_id)) {
      issue(issues, "lifecycle_target_outside_snapshot", path, `${item.memory_id} is not in the active-memory snapshot`);
    }
  });

  for (const id of sorted(expectedMemoryIds)) {
    if (!seen.has(id)) {
      issue(issues, "missing_memory_disposition", "memory_dispositions", `missing disposition for ${id}`);
    }
  }
}

function validateSourceEventDispositions(
  output: SessionMaintenanceOutput,
  expectedSourceIds: ReadonlySet<string>,
  issues: SessionMaintenanceValidationIssue[],
): void {
  const seen = new Set<string>();
  output.source_event_dispositions.forEach((item, index) => {
    const path = `source_event_dispositions[${index}].source_event_id`;
    if (seen.has(item.source_event_id)) {
      issue(issues, "duplicate_source_event_disposition", path, `duplicate disposition for ${item.source_event_id}`);
    }
    seen.add(item.source_event_id);
    if (!expectedSourceIds.has(item.source_event_id)) {
      issue(issues, "source_event_outside_snapshot", path, `${item.source_event_id} is not in the source-event snapshot`);
    }
  });

  for (const id of sorted(expectedSourceIds)) {
    if (!seen.has(id)) {
      issue(issues, "missing_source_event_disposition", "source_event_dispositions", `missing disposition for ${id}`);
    }
  }
}

function validateOutputIdsAndReplacements(
  output: SessionMaintenanceOutput,
  expectedMemoryIds: ReadonlySet<string>,
  issues: SessionMaintenanceValidationIssue[],
): void {
  const sessionMemoryIds = duplicateIds(
    output.session_memories.map((item) => item.id),
    "session_memories",
    issues,
  );
  duplicateIds(output.memory_candidates.map((item) => item.id), "memory_candidates", issues);
  duplicateIds(output.handoff_instructions.map((item) => item.id), "handoff_instructions", issues);

  output.session_memories.forEach((memory, index) => {
    if (expectedMemoryIds.has(memory.id)) {
      issue(
        issues,
        "new_memory_id_collides_with_active_memory",
        `session_memories[${index}].id`,
        `${memory.id} collides with an existing active-memory snapshot id`,
      );
    }
  });

  output.memory_dispositions.forEach((item, index) => {
    if (item.disposition !== "supersede") return;
    if (item.replacement_memory_id === item.memory_id || !sessionMemoryIds.has(item.replacement_memory_id)) {
      issue(
        issues,
        "invalid_supersession_replacement",
        `memory_dispositions[${index}].replacement_memory_id`,
        `${item.replacement_memory_id} must identify a new session_memories item distinct from ${item.memory_id}`,
      );
    }
  });
}

function validateSourceReferences(
  output: SessionMaintenanceOutput,
  expectedSourceIds: ReadonlySet<string>,
  issues: SessionMaintenanceValidationIssue[],
): void {
  for (const source of outputsWithSourceRefs(output)) {
    const seen = new Set<string>();
    source.sourceEventRefs.forEach((sourceId, index) => {
      const path = `${source.path}.source_event_refs[${index}]`;
      if (seen.has(sourceId)) {
        issue(issues, "duplicate_source_event_ref", path, `duplicate source event reference ${sourceId}`);
      }
      seen.add(sourceId);
      if (!expectedSourceIds.has(sourceId)) {
        issue(issues, "source_event_ref_outside_snapshot", path, `${sourceId} is not in the source-event snapshot`);
      }
    });
  }
}

function validateDeclaredOutputReferences(
  output: SessionMaintenanceOutput,
  issues: SessionMaintenanceValidationIssue[],
): void {
  const actualBySource = new Map<string, Set<string>>();
  for (const source of outputsWithSourceRefs(output)) {
    for (const sourceId of source.sourceEventRefs) {
      const refs = actualBySource.get(sourceId) ?? new Set<string>();
      refs.add(source.outputRef);
      actualBySource.set(sourceId, refs);
    }
  }

  output.source_event_dispositions.forEach((item, index) => {
    const actual = actualBySource.get(item.source_event_id) ?? new Set<string>();
    const path = `source_event_dispositions[${index}]`;
    if (item.disposition === "no_output") {
      if (actual.size > 0) {
        issue(
          issues,
          "source_event_disposition_conflict",
          path,
          `${item.source_event_id} is marked no_output but is cited by ${sorted(actual).join(", ")}`,
        );
      }
      return;
    }

    const declared = new Set(item.output_refs);
    if (declared.size !== item.output_refs.length) {
      issue(issues, "output_ref_mismatch", `${path}.output_refs`, "output_refs contains duplicates");
    }
    if (!sameSet(actual, declared)) {
      issue(
        issues,
        "output_ref_mismatch",
        `${path}.output_refs`,
        `declared refs [${sorted(declared).join(", ")}] do not match cited refs [${sorted(actual).join(", ")}]`,
      );
    }
  });
}

function outputsWithSourceRefs(output: SessionMaintenanceOutput): Array<{
  path: string;
  outputRef: string;
  sourceEventRefs: readonly string[];
}> {
  return [
    ...output.session_memories.map((item, index) => ({
      path: `session_memories[${index}]`,
      outputRef: sessionMaintenanceOutputRef.sessionMemory(item.id),
      sourceEventRefs: item.source_event_refs,
    })),
    ...output.memory_candidates.map((item, index) => ({
      path: `memory_candidates[${index}]`,
      outputRef: sessionMaintenanceOutputRef.memoryCandidate(item.id),
      sourceEventRefs: item.source_event_refs,
    })),
    ...output.handoff_instructions.map((item, index) => ({
      path: `handoff_instructions[${index}]`,
      outputRef: sessionMaintenanceOutputRef.handoffInstruction(item.id),
      sourceEventRefs: item.source_event_refs,
    })),
    ...output.memory_dispositions.map((item, index) => ({
      path: `memory_dispositions[${index}]`,
      outputRef: sessionMaintenanceOutputRef.memoryDisposition(item.memory_id),
      sourceEventRefs: item.source_event_refs,
    })),
  ];
}

function duplicateIds(
  ids: readonly string[],
  path: string,
  issues: SessionMaintenanceValidationIssue[],
): Set<string> {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) issue(issues, "duplicate_output_id", `${path}[${index}].id`, `duplicate output id ${id}`);
    seen.add(id);
  });
  return seen;
}

function checkedExpectedSet(
  ids: readonly string[],
  path: string,
  code: "duplicate_expected_active_memory" | "duplicate_expected_source_event",
  issues: SessionMaintenanceValidationIssue[],
): Set<string> {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) issue(issues, code, `${path}[${index}]`, `duplicate expected id ${id}`);
    seen.add(id);
  });
  return seen;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function issue(
  issues: SessionMaintenanceValidationIssue[],
  code: SessionMaintenanceValidationIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}
