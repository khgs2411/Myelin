# Acceptance Stage - Instructions

You are generating `acceptance-questions.md` for a project by dogfooding its own wiki: the questions you produce are what a cold Claude session would ask when bootstrapping against this project.

## Purpose

Acceptance questions are the measurement signal for second-brain quality. If the wiki can answer them from its own text (no repo reads), the wiki is doing its job. If it can't, measure reports zeros and the operator knows where the gaps are.

A good question:
- Is a lookup a real future session would run ("Where is X defined?", "How does Y relate to Z?", "What's the cascade when W changes?").
- Maps to exactly one high-ranked domain or a clear cross-domain relationship.
- Has a short, unambiguous answer that a wiki page should contain.
- Is phrased in the project's own vocabulary, not generic software-eng phrasing.

A bad question (do not generate these):
- Yes/no or one-word-answer questions.
- Questions whose answer is "read the README."
- Questions that probe design philosophy or opinion ("what is the best approach...").
- Questions a junior engineer would ask about general programming.

## Inputs

A JSON payload with:
- `project_key` - identifier
- `project_name` - display name
- `ranking_snapshot` - the authoritative ranked-domain list from impact
- `wiki_pages` - array of `{path, content}` pairs for the current wiki
- `index_content` - the current index.md text
- `target_question_count` - how many questions to emit (default 12)

## What to produce

Return ONLY this JSON object on stdout. Do not write any files; `run.sh` writes `acceptance-questions.md` from your stdout.

```json
{
  "version": "auto.1",
  "questions": [
    {
      "tag": "discipline | lookup | relationship | runbook | decision",
      "text": "Where is entity dispatch defined in this project?",
      "targets_domain": "entity-layer",
      "expected_citation_hint": "wiki/systems/entity-layer.md"
    }
  ],
  "acceptance_bar_total": 18,
  "acceptance_bar_max": 24
}
```

## Hard rules

- Exactly ONE `discipline`-tagged question. Keep it at index 1. It should probe "what is this project, and what are its major surfaces?" - the baseline orientation question. Measurement reports use this as the sanity floor.
- Every other question MUST reference a ranked domain via `targets_domain`. Use exact domain names from `ranking_snapshot.ranked_domains[*].domain`.
- Distribute questions across the ranked domains, weighted toward higher ranks. Do not stack 5 questions on one domain.
- Produce exactly `target_question_count` questions total (scaling down to `min_question_count` only if the ranked-domain list is smaller).
- Questions must be answerable from the wiki alone - but go ahead and include questions the wiki currently fails, because that's the signal the operator wants.
- `acceptance_bar_total` should be roughly 75% of `acceptance_bar_max` (max = 2 * number_of_questions). This sets a reasonable floor; the operator can raise it.
- Do not include prose, apologies, or markdown fences around the JSON.

## Tag meanings

- `discipline` - the single mandatory baseline orientation question.
- `lookup` - "where is X defined/implemented/configured?" Targets a specific file/module/abstraction.
- `relationship` - "how does X relate to Y?" or "what consumes / produces X?" Targets cross-domain flow.
- `runbook` - "what's the cascade/procedure for doing X?" Targets operational knowledge.
- `decision` - "why is X done this way?" Targets durable architectural decisions.

Prefer `lookup` and `relationship` for ~70% of questions - those are the queries fresh sessions run most.
