# Measurement - Instructions

You are scoring a single acceptance question against a wiki.

## Input

A JSON blob containing:
- `question`
- `wiki`
- `acceptance_bar`

## Output schema

Return ONLY this JSON:

```json
{
  "score": 0,
  "answer": "one paragraph answer drawn strictly from the wiki",
  "citations": ["wiki/systems/auth.md"],
  "reasoning": "one sentence on why this score"
}
```

Scoring:
- `2`: answered fully with citations from the wiki alone
- `1`: answered directionally but with gaps or vague coverage
- `0`: cannot answer from the wiki as written
