# llm-wiki

`llm-wiki` is a local-first knowledge layer for software repositories.

It exists to stop agents from re-reading the same repo context every session. The maintained wiki under `projects/<key>/` is the first read surface; the source repo stays authoritative.

## What This Repo Contains

- `AGENTS.md`: execution contract
- `V1_SPEC.md`: filesystem and pipeline contract
- `SYSTEM_DESIGN.md`: architecture rationale
- `agents/update/`: unified compile pipeline stages
- `projects/`: one wiki space per tracked project
- `raw/`: unclassified intake
- `concepts/`: cross-project knowledge
- `scripts/`: operational runners

## Main Commands

Initialize a project shell:

```bash
make init PROJECT=my_project PATH=/path/to/project
```

Run the full project recompile:

```bash
make compile PROJECT=my_project
```

Drain queued inbox gaps with the lighter incremental pipeline:

```bash
make update PROJECT=my_project
```

Resume a gated run after approval:

```bash
make compile-continue PROJECT=my_project
make update-continue PROJECT=my_project
```

Re-run validation against the latest recorded run:

```bash
make lint PROJECT=my_project
```

Score the wiki against acceptance questions:

```bash
make measure PROJECT=my_project
```

Inspect state and prune old runs:

```bash
make status PROJECT=my_project
make prune PROJECT=my_project
```

## Expected Flow

1. run `make init`
2. run `make compile`
3. run `make update` whenever `projects/<key>/inbox/` has queued gap-notes
4. review `projects/<key>/state/latest/`
5. run `make measure` when you want an acceptance score

## Stable Products

Per-project stable outputs live under `projects/<key>/state/latest/`.

Timestamped audit runs live under `artifacts/<key>/runs/`.
