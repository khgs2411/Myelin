# Chunk 05: Create-Mode Schema Validator

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `02-answer-domain-contracts.md`, `03-rendered-quality-evaluator.md`, `04-evidence-map-builder.md`
**Enables:** `06-curator-writer-flow.md`, `08-all-or-nothing-promotion-state.md`

## Goal

Update create-mode structured output schema and deterministic validation to require sectioned pages, answer-domain coverage, evidence-map grounding, and rendered-quality diagnostics. After this chunk, role-shaped create output cannot validate as trusted.

## Source Artifacts

- `../spec.md`: Sectioned Page Payloads, Quality Diagnostics, State And Apply Behavior.
- `src/project/project-memory-curator-output-schema.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-rendered-quality.ts`
- `src/project/project-memory-evidence-map.ts`
- `tests/project/project-memory-curator-output-schema.test.ts`
- `tests/project/project-memory-curator-validator.test.ts`

## Relationships

- **Depends on:** Answer-domain types, rendered quality helper, evidence-map artifact.
- **Enables:** Writer flow can rely on schema contract; all-or-nothing promotion can trust validation.
- **Shared contracts:** create schema requires `answer_domains`, `required_topics`, `representative_questions`, `apply_payload.pages[].sections`, `quality_diagnostics.domain_coverage`, `quality_diagnostics.answerability_findings`; deterministic validation receives `ProjectMemoryEvidenceMap` and rejects trusted create output when declared answer domains have no supporting evidence-map refs. `required_topics` are coverage labels checked through rendered domain coverage, evidence support, and answerability diagnostics; they are not exact required body-text substrings.
- **Integration points:** Provider-safe JSON Schema must keep explicit `type` on consts, required nullable fields, and simple regexes.

## File Responsibility Map

**Modify:**
- `src/project/project-memory-curator-output-schema.ts` - create schema uses answer domains and sectioned page payload.
- `src/project/project-memory-curator-validator.ts` - validate create pages against evidence map and rendered quality.
- `src/project/project-memory-curator-service.ts` - pass the create-mode evidence map into deterministic validation.
- `src/project/project-memory-curator-contracts.ts` - validation/run result artifact refs if needed.

**Test:**
- `tests/project/project-memory-curator-output-schema.test.ts` - schema shape and provider safety.
- `tests/project/project-memory-curator-validator.test.ts` - role-shaped output rejected; sectioned answer-domain output accepted when quality is trusted.

## Implementation Tasks

### Task 1: Update Create JSON Schema

**Files:**
- Modify: `src/project/project-memory-curator-output-schema.ts`
- Test: `tests/project/project-memory-curator-output-schema.test.ts`

- [ ] **Step 1: Replace role fields in creation page schema**

In `creationPageDraft`, replace `role` and `required_sections` with:

```ts
answer_domains: {
  type: "array",
  minItems: 1,
  items: { type: "string", enum: [...PROJECT_MEMORY_ANSWER_DOMAINS] },
},
required_topics: stringArraySchema(1),
representative_questions: stringArraySchema(1),
```

Update the required field list accordingly.

- [ ] **Step 2: Replace apply page body schema with sections**

In `applyPayloadSchema("create")` and the shared page draft definition, require:

```ts
sections: arrayOf({ $ref: "#/$defs/pageSectionDraft" }, 1)
```

and add:

```ts
pageSectionDraft: objectSchema({
  heading: stringSchema(),
  level: { type: "number" },
  body: { $ref: "#/$defs/markdownLines" },
  evidence_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
  repo_citations: arrayOf({ $ref: "#/$defs/repoCitation" }, 1),
  inference: nullable({ $ref: "#/$defs/inference" }),
}, ["heading", "level", "body", "evidence_refs", "repo_citations", "inference"])
```

Keep `body` for entry payloads only.

- [ ] **Step 3: Update quality diagnostics schema**

Replace `role_coverage` with:

```ts
domain_coverage: arrayOf(objectSchema({
  domain: { type: "string", enum: [...PROJECT_MEMORY_ANSWER_DOMAINS] },
  page_refs: stringArraySchema(),
  section_refs: stringArraySchema(),
  representative_questions: stringArraySchema(),
  citations_seen: { type: "number" },
  body_chars_seen: { type: "number" },
  missing_topics: stringArraySchema(),
}, ["domain", "page_refs", "section_refs", "representative_questions", "citations_seen", "body_chars_seen", "missing_topics"])),
answerability_findings: stringArraySchema(),
```

### Task 2: Validate Create Page Fields

**Files:**
- Modify: `src/project/project-memory-curator-validator.ts`
- Test: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Replace page-level role checks**

Remove create-mode checks for `item.role` and `item.required_sections`. Add:

```ts
const answerDomains = Array.isArray(item.answer_domains) ? item.answer_domains : [];
if (answerDomains.length === 0 || answerDomains.some((domain) => !PROJECT_MEMORY_ANSWER_DOMAINS.includes(domain as ProjectMemoryAnswerDomain))) {
  globalFindings.push(finding("blocker", "schema", "creation_page_answer_domains_required", "Every creation page draft needs supported answer_domains.", typeof item.id === "string" ? item.id : undefined));
}
if (!Array.isArray(item.required_topics) || item.required_topics.length === 0) {
  globalFindings.push(finding("blocker", "schema", "creation_page_required_topics_required", "Every creation page draft needs required_topics.", typeof item.id === "string" ? item.id : undefined));
}
if (!Array.isArray(item.representative_questions) || item.representative_questions.length === 0) {
  globalFindings.push(finding("blocker", "schema", "creation_page_representative_questions_required", "Every creation page draft needs representative_questions.", typeof item.id === "string" ? item.id : undefined));
}
```

- [ ] **Step 2: Validate sectioned page payload**

In `validatePageDraft`, replace `validateMarkdownLines(page.body, ...)` with:

```ts
const sections = Array.isArray(page.sections) ? page.sections : [];
if (sections.length === 0) {
  findings.push(finding("blocker", "schema", "apply_payload_page_sections_required", "Creation page payloads require rendered page sections.", input.itemId));
}
for (const section of sections) {
  if (!isRecord(section)) {
    findings.push(finding("blocker", "schema", "apply_payload_page_section_invalid", "Page sections must be objects.", input.itemId));
    continue;
  }
  findings.push(...validateSectionDraft(section, input));
}
findings.push(...validateApplyProvenance(page, input.packet, input.itemId));
```

### Task 3: Use Rendered Quality As Validation Authority

**Files:**
- Modify: `src/project/project-memory-curator-validator.ts`
- Test: `tests/project/project-memory-curator-validator.test.ts`

- [ ] **Step 1: Pass evidence map into validation**

Change the validator entrypoint to accept the evidence map built in chunk 04:

```ts
import type { ProjectMemoryEvidenceMap } from "./project-memory-evidence-map.ts";

export type ProjectMemoryCuratorValidationOptions = {
  evidenceMap?: ProjectMemoryEvidenceMap;
};

export function validateCuratorOutput(
  packet: ProjectMemoryPacket,
  raw: unknown,
  options: ProjectMemoryCuratorValidationOptions = {},
): ProjectMemoryCuratorValidationResult {
  // existing parsing and mode handling remains; create-mode validation receives options.evidenceMap
}
```

Update `ProjectMemoryCuratorService` so create mode passes the artifact object:

```ts
const validation = validateCuratorOutput(packet, curatorOutput, { evidenceMap });
```

- [ ] **Step 2: Reject unsupported declared answer domains**

Before computing trusted content quality, build evidence support from `options.evidenceMap` and add blocker findings when a page declares an answer domain with no evidence refs.

```ts
function evidenceRefsForDomain(
  evidenceMap: ProjectMemoryEvidenceMap | undefined,
  domain: ProjectMemoryAnswerDomain,
): number {
  return evidenceMap?.domains.find((entry) => entry.domain === domain)?.evidence_refs.length ?? 0;
}

for (const page of creationPages) {
  for (const domain of page.answer_domains ?? []) {
    if (evidenceRefsForDomain(options.evidenceMap, domain) === 0) {
      globalFindings.push(finding(
        "blocker",
        "evidence",
        "creation_page_answer_domain_missing_evidence_map_support",
        `Creation page ${page.id} declares ${domain} without supporting evidence-map refs.`,
        typeof page.id === "string" ? page.id : undefined,
      ));
    }
  }
}
```

- [ ] **Step 3: Replace `creationRoleCoverage`**

In `diagnosticsFromCreationDraft`, call `evaluateRenderedProjectMemoryQuality` and include evidence-map missing domains in `missing_coverage`:

```ts
const computed = evaluateRenderedProjectMemoryQuality({
  mode: "create",
  pages: draft.pages ?? [],
  candidate_dispositions: parsed.candidate_dispositions,
  missing_coverage: [
    ...(contract?.missing_coverage ?? []),
    ...(contract ? orientationMissingCoverage(packet, contract) : ["documentation_contract missing"]),
    ...(options.evidenceMap?.missing_domains.map((domain) => `evidence_map missing ${domain}`) ?? ["evidence_map missing"]),
  ],
  blocked_reasons: [],
  review_reasons,
});
```

Then preserve retrieval readiness:

```ts
const diagnostics = { ...computed, retrieval_readiness: parsed.retrieval_readiness };
```

Remove `creationRoleCoverage` and `applyPayloadBodyChars` once unused.

- [ ] **Step 4: Add role-shaped and evidence-map rejection tests**

Create a fixture that includes old `role`, `required_sections`, and `body` but no sectioned payload. Assert:

```ts
expect(result.ok).toBe(false);
expect(result.global_findings.map((finding) => finding.code)).toContain("creation_page_answer_domains_required");
expect(result.quality_diagnostics?.content_quality.status).toBe("shallow");
```

Add a second fixture that declares a valid `answer_domains` value but passes an evidence map with that domain in `missing_domains` and no refs. Assert:

```ts
const result = validateCuratorOutput(packetFixtureForCreate(), sectionedCreateOutput, {
  evidenceMap: evidenceMapMissing("storage_retrieval"),
});
expect(result.ok).toBe(false);
expect(result.global_findings.map((finding) => finding.code)).toContain(
  "creation_page_answer_domain_missing_evidence_map_support",
);
```

## Verification

- Run: `bun test tests/project/project-memory-curator-output-schema.test.ts`
  - Expected: exits 0; schema requires answer domains and page sections.
- Run: `bun test tests/project/project-memory-curator-validator.test.ts`
  - Expected: exits 0; old role-shaped create output is rejected before writes, and declared answer domains without evidence-map support cannot validate as trusted.
- Run: `bun run typecheck`
  - Expected: exits 0 with no references to `creationRoleCoverage` or create-mode `required_sections`.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Curator output schema and deterministic validation match the new contract.
- A creation draft with declared sections but one rendered section is rejected as shallow.
- Coverage is computed from rendered markdown, not curator metadata.
- `required_topics` remain required schema labels, but exact label string matching is not the trust mechanism.
- Provider-safe schema patterns are preserved.

## Risks And Rollback

- Risk: provider schema compatibility is strict. Keep required nullable fields explicit and avoid unsupported regex/lookaround.
- Rollback: revert schema and validator changes. Do not continue to writer-flow chunks until create validation is stable.

## Non-Goals

- No evidence-map prompt consumption beyond deterministic validation input.
- No usefulness critique.
- No clean reset.

## Type And Name Consistency

Before finishing, verify `answer_domains`, `required_topics`, `representative_questions`, `sections`, `domain_coverage`, and `answerability_findings` are present in types, schema, validator, and tests.
