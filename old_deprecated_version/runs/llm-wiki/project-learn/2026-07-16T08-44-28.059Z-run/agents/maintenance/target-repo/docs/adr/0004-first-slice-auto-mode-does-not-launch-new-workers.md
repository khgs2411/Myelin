# Auto Mode does not launch unbounded memory workers

In V2 memory commands, `auto` is accepted and stored as a memory mode but does not launch unbounded background agentic workers. It marks events and candidates as eligible for future bounded automation; `off` stores raw events only, `queue` creates pending work where applicable, and `auto` records automation eligibility. The existing `enrich_gap(auto_update=True)` detached `make update AUTO=1` path remains the current auto-spawn exception until a later hook/memory-worker design supersedes it explicitly.
