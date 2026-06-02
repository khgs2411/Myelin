# Phase 0 ships a thin global-only schema

Phase 0 implements only a thin global schema: markdown guidance plus a small set of hand-authored, Zod-validated JSON rules, compiled to `schema-context.json` via `schema check` and `schema build`.

The project-local schema layer, typed override records, schema candidates and their lifecycle, `--include-global`, and `--global` multi-project apply remain the target design but are deferred past Phase 0. There is currently one real project and no cross-project divergence to justify that machinery, so building it now would violate the "defer until proven" stance already taken for rule generators (0028) and candidate payloads (0006).

The following still hold for the thin schema: schema-before-learn/query (0035, 0036), fail-closed query (0037), read-only `schema check` (0039), and `schema build` writes by default (0033). Deferred past Phase 0: 0030, 0031, 0040, 0041, 0042, 0043, 0044, 0045, and the project-local portion of 0023 and 0024.
