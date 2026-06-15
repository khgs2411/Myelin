# Use detached target-repo agents for Experience Log ingest

`myelin ingest <project-key>` starts a Myelin-owned detached ingest job that launches a headless provider session from the target repository cwd, on `master` for the first implementation. The ingest agent pulls Experience Log rows through Myelin tools, decides what Session Memory or layer handoff inputs to create, and Myelin owns the simple queue/tombstone bookkeeping. Pull creates tombstone-backed lease stubs while raw rows remain in `experience_events`; accepted terminal processing then populates/finalizes the tombstone and deletes the raw row. This keeps capture non-agentic while giving the memory-processing agent full repo context and avoiding a foreground, Myelin-orchestrated classification pipeline.

**Considered Options**

- Run ingest as foreground Myelin logic that classifies rows directly.
- Launch a detached provider session from the Myelin repo and feed it prepared evidence.
- Launch one or more detached provider sessions from the target repo, with Myelin-owned job state and tombstone-backed lease/finalization state.

**Consequences**

The first implementation uses tombstone stubs as in-progress duplicate-prevention records without deleting raw Experience Log rows before provider output is accepted. Myelin should optimize prompts, tools, and durable state rather than prescribe the number or shape of memory records created from each batch.
