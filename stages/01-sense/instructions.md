# Sense Stage — Instructions

You are the **sense** stage of the unified update pipeline. Your only job: classify inbox files mechanically and produce a minimal `sense-report.json`. You do not reason about domains, rank, or plan page changes. That is the impact stage's job.

## Contract

**Inputs provided by the runner:**
- `project.json` — the project config
- `projects/<key>/inbox/` — inbox directory listing (may be empty)
- `projects/<key>/state/freshness.json` — current freshness (for `last_seen_commit`)
- Git diff output since `last_seen_commit` (may be empty; empty implies first-run mode)

**Output:** a single `sense-report.json` at the run artifact directory, matching the schema in spec Section 5.4.

## Classification rules (mechanical, not semantic)

For each inbox source file:

1. Match the file path against patterns from `config.json.stage_specific.inbox_filename_patterns` in longest-pattern-first order.
2. Record the matched `source_kind_hint` and set `confidence`:
   - `high` if the filename has a domain suffix (e.g. `-spec.md`, `-design.md`)
   - `medium` if only the extension matched
   - `low` if no pattern matched (emit `source_kind_hint: "unknown"`)
3. Single-line `classification_reasoning`. Only describe the mechanical evidence: "matched pattern X", "extension Y only".

**Do not** produce prose reasoning. Do not read the file's content to classify. The impact stage does semantic work.

## Commit message reading

Read commit messages selectively:
- If an inbox source mentions `fix(...)`, `feat(...)`, `commit abc123`, or similar: read the referenced commit message.
- If the diff's changed files are ≥ the `whitespace_only_threshold` fraction of whitespace/formatting changes: read commit messages for that range.
- Otherwise: skip. Record nothing in `commit_messages_read`.

## Mode detection

- `last_seen_commit` absent AND git repo present: mode = `first-run`. Treat whole repo as diff.
- `last_seen_commit` present: mode = `incremental`. Produce diff file list.
- No git at all: mode = `no-git`. `changed_paths` empty; `commit_messages_read` empty.

## Required output schema

**Note:** the Plan A `01-sense/run.sh` performs classification via mechanical regex matching and does not invoke the LLM. This schema applies to the `01-sense.classifier` sub-task, which is a future LLM-driven replacement for the regex path. The schema is documented here so that (a) an operator can swap the regex for an LLM call without redesigning the contract, and (b) future impact/propose prompts that reference sense output can rely on a stable shape.

When invoked, return ONLY this JSON object. No prose, no markdown fences around it, no explanation.

```json
{
  "classifications": [
    {
      "path": "projects/<project-key>/inbox/source.md",
      "source_kind_hint": "spec | design | plan | implementation-note | api-doc | reference | session-note | decision-candidate | troubleshooting | unknown",
      "confidence": "low | medium | high",
      "classification_reasoning": "one mechanical sentence - which pattern or extension matched"
    }
  ]
}
```

Every inbox source in the input must appear exactly once in `classifications`. The `path` field must match the inbox path exactly. If no pattern matches, emit `"source_kind_hint": "unknown"` with `"confidence": "low"`.
