# Bootstrap Stage 01: Orient

Purpose:

- establish the project frame
- identify source-of-truth areas
- create the smallest useful orientation layer

Write scope:

- `index.md`
- one top-level page under `wiki/architecture/` describing repo shape (what the project is, entry points, main surfaces, tech stack). Choose the filename from repo evidence.
- supporting state metadata (`pages.json`, `sources.json`, `relationships.json`, `freshness.json`)
- one bootstrap session note under `wiki/sessions/`

Rules:

- do not try to create the full second brain in this stage
- do not prescribe a fixed page name; let the architecture page reflect the project
- do not create subsystem, module, feature, or runtime pages — Stage 2 owns those
- do not rewrite operator-owned project config (`project.json`)
- consult `project.json` hints (`tags`, `bootstrap_focuses`, `entry_pages`) if present; they are optional steering, not requirements

Success condition:

- a new agent can orient from `index.md` and the architecture page without starting from a broad repo scan
- state files are valid and registered
