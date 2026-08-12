# Use agent-authored Project Memory documentation

Project Memory create mode should be agent-authored markdown documentation, not structured JSON page curation. First create uses a planner/index agent to inspect the repo and choose the documentation subjects, then bounded parallel subject writer agents write the planned markdown files. Myelin owns orchestration, write boundaries, artifacts, state, candidate lifecycle, promotion, and derived retrieval state.

This supersedes the create/apply/validation parts of:

- ADR 0059, which required structured Project Memory apply payloads.
- ADR 0063, which required answer-domain documentation maps.
- ADR 0064, which required deterministic evidence-map-first creation.
- ADR 0065, which required an independent first-create usefulness critique before curated state.

This partially supersedes ADR 0058. `project learn` remains mode-scoped: first curated Project Memory uses create mode, and later ordinary runs use maintenance mode. The output contracts change from structured curator drafts and maintenance proposals to agent-authored draft wiki files plus small operational reports.

This preserves:

- ADR 0021: curated Project Memory remains markdown plus metadata JSON.
- ADR 0060: canonical writes use journal-backed staged promotion and recovery.
- ADR 0062: retrieval is derived from canonical markdown and may remain pending after promotion.
- ADR 0066: explicit clean rebootstrap/reset remains available for untrusted or recreated Project Memory.

Structured data is still allowed for orchestration and lifecycle: subject manifests, subject completion reports, maintenance disposition reports, promotion journals, and state metadata. It must not define required documentation files, required sections, answer-domain coverage, citation density, content-quality scores, or other documentation-shape gates.

Agent file authoring uses a separate runner contract from JSON-only `invokeLlm`. File-authoring agents may run with a writable sandbox only inside run-local output roots. They must not write canonical wiki/state files directly; Myelin promotes accepted draft outputs atomically.
