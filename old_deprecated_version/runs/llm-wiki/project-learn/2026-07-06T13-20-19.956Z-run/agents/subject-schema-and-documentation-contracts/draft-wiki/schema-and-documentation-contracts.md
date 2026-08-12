# Schema and Documentation Contracts

Schema and documentation contracts define how Myelin turns product-wide memory rules into generated state, how sources are classified before use, and what shape Project Memory documentation is allowed to take.

## Schema Layer

The active schema layer is Phase 0: a thin global-only contract under `schema/`. `schema/global.md` is the human-readable guidance, and `schema/rules/*.json` holds the typed rules for source classification, memory scopes, and page taxonomy. Project-local schema, explicit overrides, schema candidates, and schema apply flows are documented target design but are deferred past Phase 0.

Repo evidence:

- `schema/global.md` states that Phase 0 ships global rules only and that project-local schema, overrides, and candidates are deferred.
- `docs/adr/0049-phase-0-ships-thin-global-only-schema.md` preserves the same decision boundary.
- `src/schema/types.ts` and `src/schema/validators.ts` define the current TypeScript and Zod shapes.

The compiled schema context has `schema_version: "0"` and is generated state at `projects/<key>/state/schema-context.json`. It includes input hashes, source-classification enums, memory scopes, page-taxonomy category keys, required provenance token names, and CLI vocabulary.

`src/schema/compiler.ts` is the implementation boundary. It reads `schema/global.md`, hashes every authored schema input with SHA-256, validates the three JSON rule files with Zod, and compiles a deterministic `SchemaContext`. The context records hashes in `inputs`, so freshness can be checked without hand-inspecting every source file.

## Schema Check And Build

`myelin schema check <project-key>` is read-only. It finds the project, loads and validates authored global schema, and if a generated `schema-context.json` exists, validates it and checks whether its recorded `inputs` match the current authored schema hashes. Stale generated state is reported as an error telling the operator to run `schema build`.

`myelin schema build <project-key> [--dry-run]` compiles the context. Without `--dry-run`, it writes `projects/<project-key>/state/schema-context.json` only when the existing context is missing, invalid, stale, or otherwise differs from the compiled output. With `--dry-run`, it returns the generated JSON without writing.

Repo evidence:

- `src/commands/schema.ts` defines the CLI parsing and output messages.
- `src/schema/compiler.ts` implements `checkSchema`, `buildSchemaContext`, stale-input detection, dry-run behavior, and skip-if-current writes.
- `tests/schema/schema-service.test.ts` verifies build/check success and that dry-run does not write generated state.
- `docs/CLI.md` documents `schema check` as read-only and `schema build` as writing unless `--dry-run` is used.
- `docs/adr/0039-schema-check-is-read-only.md` and `docs/adr/0033-schema-build-writes-by-default.md` capture the operator contract.

`project learn` also prepares schema context before curation. `src/project/project-memory-curator-service.ts` calls `ensureProjectLearnSchemaContext` after creating the run directory. `src/runtime/project-run-infrastructure.ts` builds context when it is missing, rebuilds stale or invalid context, and fails if a post-rebuild check still fails. In dry-run mode it computes the context hash without writing.

## Typed Global Rules

`schema/rules/source-classification.json` requires every source to resolve `source_kind`, `ownership`, `destination`, `update_targets`, and `action` before integration. Current `source_kind` values include `spec`, `design`, `plan`, `implementation-note`, `api-doc`, `reference`, `session-note`, `decision-candidate`, `troubleshooting`, and `unknown`. Allowed actions are `update-existing-pages`, `create-new-page-and-update-index`, `log-only`, `reject`, and `needs-review`.

`schema/rules/memory-scopes.json` defines query scopes. Phase 0 active scopes are `project_wiki`, `project_state`, and `none`; `project_session`, `practice`, and `personal` are present as deferred scopes. This keeps the schema vocabulary aligned with the broader query facade while making clear which scopes are not active yet.

`schema/rules/page-taxonomy.json` defines page categories by compounding knowledge value rather than source-code shape: `product-behavior`, `operating-workflows`, `decisions`, `current-state`, `practices-provenance`, `open-questions`, and `concepts`. `schema/global.md` says these categories supersede the V1 `wiki/{architecture,systems,modules,...}` folder taxonomy.

## Documentation Contract

Current Project Memory create mode is agent-authored documentation. ADR 0067 changed first-create behavior away from structured JSON page curation: a planner inspects `target-repo/`, writes `draft-wiki/index.md` plus subject placeholders, and subject writer agents produce the assigned markdown pages. Myelin owns orchestration, bounded writable roots, promotion, state metadata, candidate lifecycle, and derived retrieval state.

The subject-writer contract is intentionally small. `src/project/project-memory-agent-create-service.ts` asks each writer to read from `target-repo/`, write only the assigned markdown file under `draft-wiki/`, and write `reports/subject-report.json` with `schema_version`, `project_key`, `subject_id`, `wiki_path`, `status`, `evidence_paths`, `touched_paths`, and `known_gaps`. `src/project/project-memory-agent-contracts.ts` defines the typed `ProjectMemorySubjectManifest` and `ProjectMemorySubjectReport` shapes.

Structured documentation-quality gates still exist in older curator contracts, but they are not the current create-mode authority. `src/project/project-memory-curator-output-schema.ts`, `src/project/project-memory-quality-contract.ts`, `src/project/project-memory-rendered-quality.ts`, and related validator tests define answer-domain coverage, citation counting, shallow-section checks, and `trusted`/`review_only`/`shallow`/`blocked` statuses for structured curator output. ADR 0067 explicitly says structured data may remain for orchestration and lifecycle, but must not define required documentation files, sections, answer-domain coverage, citation density, content-quality scores, or other documentation-shape gates for agent-authored documentation.

Current state metadata reflects that distinction. `src/project/project-memory-curator-service.ts` writes `content_quality.status: "not_evaluated"` with reason `agent_authored_documentation_has_no_schema_quality_gate` for the agent-authored Project Memory state.

## Quality And Provenance Expectations

Even without a create-mode schema quality gate, the repository still has durable writing rules:

- Wiki pages should separate sourced facts from inferred synthesis and avoid presenting stale content as verified fact.
- Meaningful durable writes need provenance such as concrete file-path citations, commit/state pointers, source snippets, or explicit inference labels.
- Source material remains separate from synthesized Project Memory.
- Existing canonical pages should be updated before creating new pages unless the source classification and ownership decision justify a new page.

These expectations are stated in `schema/global.md`, the root project instructions, and the Project Memory source-processing model. The practical contract for subject pages is to cite concrete repo paths naturally, preserve conflicts, and record known gaps in the subject report rather than hiding them in prose.

## Known Gaps And Conflicts

- `schema/schema-context.md` lists `project ingest` in the documented CLI vocabulary shape, but `src/schema/compiler.ts` currently compiles `REQUIRED_CONTEXT_COMMANDS` without `project ingest`. Treat the compiler as current behavior and the prose shape as stale or aspirational until reconciled.
- `docs/CLI.md` says `schema check` validates generated schema context for a project, while the implementation also validates authored global schema inputs and only checks generated context when it exists.
- `MYELIN.md` describes project-local schema, schema overrides, candidates, and apply lifecycle as part of the full model; ADR 0049 and current code defer those features past Phase 0.
- The structured `quality_diagnostics` and `documentation_contract` path remains in code and tests for older curator output, but ADR 0067 supersedes it for create-mode documentation shape. Future agents should avoid reintroducing those gates as mandatory authoring constraints without a new decision.
