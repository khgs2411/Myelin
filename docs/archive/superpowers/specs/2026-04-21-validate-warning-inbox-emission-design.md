# Validate Warning Inbox Emission Design

Curated non-blocking semantic validation findings should be able to seed future maintenance work without forcing a full compile loop or relying on operator transcription.

## Goal

Turn selected semantic validation warnings into project inbox items so `make update` can consume them on a later manual pass.

## Scope

- Emit inbox items only for curated semantic warning categories:
  - `redundancy`
  - `stale`
  - `contradiction`
- Emit only when the finding includes a usable `suggested_action`.
- Queue the item for a later manual `make update`; do not auto-trigger another update pass.

## Shape

- Producer source: `validate-auto`
- Reuse the existing inbox schema and ingest lane.
- Map a validation finding into:
  - `question`: short actionable rewrite prompt
  - `target_hint`: first affected page when present
  - `pages_read`: affected pages
  - `enriched_notes`: evidence plus suggested action
  - `operator_notes`: lightweight provenance marker for dedupe

## Dedupe

- Dedupe only against still-pending inbox items.
- If the same curated warning is already pending, validate should not emit another copy.
- Once the item is consumed by `make update`, a later validate run may emit a fresh item again if the warning still exists.

## Operator Model

- `make status` should be able to surface that a warning can be handled through queued maintenance work.
- The operator remains in control; no recursive self-loop is introduced.
