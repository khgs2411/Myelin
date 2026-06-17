# Documentation Map

This is the current documentation map for Myelin. Start here when returning to the repo.

## Canonical Reading Path

Read these in order:

1. `../README.md` — operator quick start, commands, runtime, and repo layout.
2. `CLI.md` — exhaustive operator command reference.
3. `../MYELIN.md` — canonical product design and north star.
4. `../CONTEXT.md` — product-language glossary and resolved naming/shape ambiguities.
5. `IMPLEMENTATION_ALIGNMENT.md` — how the current codebase maps to the V2 product shape.
6. `DONE.md` — what is currently built and verified.
7. `TODO.md` — known gaps between the current code and `MYELIN.md`.

## Active Reference Docs

- `inbox-item-schema.md` — current inbox item contract.
- `CLI.md` — command usage, arguments, side effects, and examples.
- `adr/` — append-only decision records. These are canonical decisions, but they are not the starting point for understanding the product.

## Archive

- `archive/` contains raw brainstorming, superseded specs, historical implementation plans, and V1/V2 migration records.
- Nothing in `archive/` is current product truth unless a canonical doc explicitly cites it as historical source material.
- `archive/V2_SPEC.md` is the raw brainstorming source for the project-rooted memory model. It is useful for recovering intent, but `../MYELIN.md` is the canonical design.

## Rule For New Docs

Before adding a new long-lived doc, decide which role it has:

- canonical design -> update `../MYELIN.md`
- terminology or resolved ambiguity -> update `../CONTEXT.md`
- current implementation alignment -> update `IMPLEMENTATION_ALIGNMENT.md`
- built inventory -> update `DONE.md`
- planned gap -> update `TODO.md`
- historical source material -> put it under `archive/`

Avoid creating parallel design docs that compete with `MYELIN.md`.
