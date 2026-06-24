# ProjectMemoryEntryBlockFormat

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

Canonical Project Memory markdown should stay human-readable while exposing stable machine-addressable blocks for deterministic apply.

The first block format should favor stable entry ids and compact provenance over arbitrary patch hunks.

```md
<!-- myelin-entry id="setup.cli.project-learn" lifecycle="active" -->
### Project Learn CLI

`project learn <key>` maintains curated Project Memory from a bounded packet.

Provenance:

- Evidence: project_candidate:cand_123 - durable setup command update
- Repo: src/commands/project.ts:74-121 - command route and CLI output

Applicability:

- Commands: `myelin project learn <key>`

<!-- /myelin-entry -->
```

## Entry Ownership

The applier owns:

- marker syntax;
- entry id matching;
- lifecycle marker updates;
- provenance rendering;
- append versus replace behavior;
- newline normalization;
- rejecting marker-breaking content.

The curator owns:

- structured entry id proposal;
- title;
- body paragraphs/bullets;
- evidence refs;
- repo citations;
- inference labels when direct evidence is unavailable;
- applicability fields.

The validator owns:

- entry id shape;
- required evidence refs;
- required repo citation or inference for repo-groundable claims;
- target page safety;
- operation and lifecycle legality;
- risk/quarantine classification.

## Lifecycle Rendering

Active entry:

```md
<!-- myelin-entry id="..." lifecycle="active" -->
```

Stale entry:

```md
<!-- myelin-entry id="..." lifecycle="stale_pending" -->
```

Disputed entry:

```md
<!-- myelin-entry id="..." lifecycle="disputed" -->
```

Superseded entry:

```md
<!-- myelin-entry id="..." lifecycle="superseded" superseded_by="..." -->
```

Retracted entry:

```md
<!-- myelin-entry id="..." lifecycle="retracted" -->
```

Lifecycle operations should preserve the old body unless the concrete operation supplies a replacement. Stale, disputed, superseded, and retracted states should append a compact note with evidence refs and citations.

## Provenance Rendering

Every entry must render either direct provenance or an explicit inference label.

Direct provenance:

- packet evidence refs as `kind:ref`;
- repo citations as `path:line_start-line_end`;
- citation reason as short text.

Inference provenance:

- label;
- basis;
- why direct repo evidence is unavailable;
- packet refs used for the inference.

Inference is not a loophole for missing repo evidence. The validator should still reject or quarantine claims that should be repo-groundable but lack citation.

## Page-Level Shape

Creation mode can render full pages:

```md
# Setup

Setup describes how to install dependencies, run checks, and operate common local workflows.

<!-- myelin-entry id="setup.dependencies" lifecycle="active" -->
...
<!-- /myelin-entry -->
```

New page creation in maintenance mode should require an explicit supported operation. Until that exists, maintenance items should target existing pages only.

## Must Preserve

- Canonical wiki markdown remains human-readable.
- Stable machine-addressable entry markers are allowed in canonical wiki markdown so deterministic apply can target exact blocks.
- Provenance renders visibly near meaningful claims; hidden metadata may support stable block targeting but must not be the only provenance surface.
- `entry_id` values should be project-meaningful and stable. Apply can still resolve them page-locally when a target page is explicit.

## Allowed Implementation Choices

- Marker attribute names may change if stable ids, lifecycle, and exact block replacement remain supported.
- The implementation may tighten entry id uniqueness if validator support makes project-global lookup practical.
