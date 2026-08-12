# Schema and runtime inbox workflows

Schema commands compile and validate the global schema context, while the runtime inbox preserves project-layer proposals and deterministically turns them into review candidates; neither workflow makes a proposal canonical Project Memory by itself.

## Schema context

`myelin schema check <project-key>` is the read-only validation operation. It first requires the project to exist, then loads `schema/global.md` plus every sorted `schema/rules/*.json` file, validates the three required typed rules, and—when `state/<project-key>/schema-context.json` exists—validates its JSON shape and compares its recorded input hashes with the authored inputs. A missing generated context is allowed by `check`; an invalid context or mismatched input hashes fails with actionable errors, including the instruction to run `schema build <project-key>` for stale inputs (`src/commands/schema.ts`, `src/schema/compiler.ts`). The command rejects `--dry-run` because it is already non-mutating.

`myelin schema build <project-key> [--dry-run]` is the generated-state writer. It uses the same global authored inputs and writes only `state/<project-key>/schema-context.json` when no semantically identical valid context already exists. `--dry-run` returns the compiled JSON context and writes nothing. A normal build is therefore reversible generated-state replacement, not a canonical wiki or source update; it overwrites the prior schema context when the inputs or valid context change. Invalid authored rules stop the build before a context is written. Regression coverage verifies a first build, a non-writing dry run, a non-mutating check, and rejection of invalid scope declarations (`tests/commands/schema.test.ts`).

The generated context is intentionally a compact runtime contract, not a project-local schema extension. Its current `schema_version` is `"0"`; it carries input SHA-256 hashes, schema rule values, required provenance forms, and the supported CLI vocabulary (`src/schema/types.ts`, `src/schema/compiler.ts`). The compiler reads only global schema inputs in this slice. `schema/global.md` corroborates that project-local schemas, overrides, and schema candidates are deferred.

### Current schema rule values

The authored rules are the authority for the values copied into context; Zod requires non-empty lists and summaries. Source classification requires `source_kind`, `ownership`, `destination`, `update_targets`, and `action`. Its supported enums are:

- `source_kind`: `spec`, `design`, `plan`, `implementation-note`, `api-doc`, `reference`, `session-note`, `decision-candidate`, `troubleshooting`, `unknown`.
- `ownership`: `project:<project-key>`, `concept:<concept-key>`, `review-required`, `reject`.
- `action`: `update-existing-pages`, `create-new-page-and-update-index`, `log-only`, `reject`, `needs-review`.

`destination` and `update_targets` are contextual paths/scopes rather than fixed enums. The memory-scope rule declares `project_wiki`, `project_session`, `project_state`, `practice`, `personal`, `mixed`, and `none`. Phase 0 activates `project_wiki`, `project_state`, and `none`; it defers `project_session`, `practice`, and `personal`. Every active or deferred value must first be declared in `scopes`, otherwise validation fails. The page taxonomy supports `product-behavior`, `operating-workflows`, `decisions`, `current-state`, `practices-provenance`, `open-questions`, and `concepts` (`schema/rules/*.json`, `src/schema/validators.ts`).

`schema/global.md` contains a stale/conflicting reference to an active `project ingest <key>` workflow. Current command documentation and command registration instead define `project learn <key>` for Project Memory intake and expose no active `project ingest` command; it must not be treated as supported operator vocabulary.

## Runtime inbox: immutable proposal sources

`myelin memory inbox create <project-key> --layer project --title <title> --body <text> --rationale <text> --confidence low|medium|high --risk low|medium|high [--evidence-ref <ref>] [--target-hint <hint>] [--json]` creates a preserved source record at `sources/<project-key>/inbox/<id>.json` (`src/commands/memory.ts`, `src/inbox/runtime-inbox-items.ts`). The record includes its creator, timestamp, proposal text and rationale, evidence references, optional target hint, ratings, and tags. It is source material—not canonical Project Memory—and source creation does not create `index.md` files or curate markdown.

The create gate order is significant:

1. CLI parsing requires one project key and all required proposal fields; `confidence` and `risk` each accept exactly `low`, `medium`, or `high`.
2. The runtime accepts only the `project` layer. `practice` and `personal` are declared durable-layer values but return `unsupported_layer` before any source write because this slice has no consumer for them.
3. The project must exist; an unknown project returns `blocked_path` and cannot create an orphan tree.
4. The generated item must validate: schema version `1`, matching timestamp-shaped filename/id, non-empty required strings, an ISO timestamp, string arrays, and supported layer and ratings.
5. The file is created through a temporary file plus hard link. A duplicate id yields `write_failed` and leaves the original byte-for-byte intact.

Successful creation is append-only for a given id and may schedule automatic Project Memory maintenance after the source has been safely preserved. Scheduler failure is deliberately non-blocking: it does not revoke a completed source write. Tests cover the saved record shape, no incidental index creation, invalid metadata/unknown-project prevention, unsupported-layer prevention, and duplicate non-overwrite behavior (`tests/inbox/runtime-inbox-items.test.ts`, `tests/commands/memory.test.ts`).

## Deterministic intake, inspection, and maintenance

`myelin memory inbox intake <project-key> [--json]` is the bridge from preserved proposal source to machine review queue. It lists `sources/<project-key>/inbox/*.json` in sorted filename order, validates each record, and assigns the deterministic candidate id `project_inbox:<project-key>:<inbox-id>` (`src/project/project-memory-candidate-intake-service.ts`). A valid, project-scoped `project` item creates one `memory_candidates` row with scope `project`, type `project.inbox`, and initial status `needs_review`; its source reference and proposed payload retain the inbox evidence and proposal fields.

Intake never modifies or deletes the preserved inbox file, and it does not apply a candidate to Project Memory. Its per-item outcome/state transition is:

| Condition | Outcome |
| --- | --- |
| No candidate exists | Create `needs_review` candidate. |
| Candidate is `pending` or `needs_review` | Report `existing`; do not duplicate it. |
| Candidate is `processed` or `rejected` | Report `terminal_duplicate`; do not reopen or recreate it. |
| Invalid filename/JSON/item, unsupported layer, or unrecognized existing candidate status | Record a degraded per-source outcome; continue valid items. |
| Unknown project or unreadable inbox directory other than absence | Mark the run blocking and fail the CLI command. |
| Inbox directory absent | Return an empty, non-blocking summary. |

Thus the precedence is project existence and inbox accessibility before intake; then item validation/layer/scope before candidate creation; then the existing candidate's status controls idempotency. Invalid or unsupported individual sources are visible in `invalid_source_refs` or `unsupported_source_refs` and set `degraded`, but do not block valid intake. The JSON and text summaries expose created, existing, terminal-duplicate, skipped, unsupported, invalid, degraded, and blocking conditions. Regression tests cover creation, idempotency across active and terminal statuses, mixed valid/invalid/unsupported batches, and the unknown-project block (`tests/project/project-memory-candidate-intake-service.test.ts`, `tests/commands/memory.test.ts`).

Operators inspect the queue with `myelin memory candidates <project-key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]` and inspect one item with `myelin memory candidate show <candidate-id> [--json]`. The CLI normalizes the hyphenated `needs-review` filter to stored `needs_review` (`src/commands/memory.ts`, `src/memory/ingest-types.ts`). These are inspection operations; they do not transition candidates.

`myelin memory maintain project <project-key> [--dry-run] [--review] [--provider codex|claude] [--model <model>] [--json]` runs the separate Project Memory maintenance boundary. It reports status, mode, validation, whether it stopped before writes, and changed/applied items; `--dry-run` selects the preview mode. This is the operation that can act on candidate material and alter canonical Project Memory, so its output and validation status must be reviewed before treating a proposal as accepted. `--review` and provider/model selection are supported; `--recreate` is explicitly rejected (`src/commands/memory.ts`, `tests/commands/memory.test.ts`).

## Authority and known gaps

Authoritative inputs are the global authored schema files, preserved inbox JSON sources, and the candidate store. Generated `schema-context.json` is rebuildable runtime state; candidate rows are an intake/review queue; canonical Project Memory remains outside both write paths until maintenance decides and validates an update. This split protects source evidence from both schema rebuilds and candidate processing.

The supplied snapshot has no root-level `repository-identity.json` artifact, so this page makes no claim about checkout identity and cannot link the requested deterministic evidence. The behavior evidence is strong for unit and command contracts, but this subject does not establish end-to-end provider-backed maintenance outcomes, automatic-maintenance scheduling/worker execution, or concurrent inbox-create/intake behavior.
