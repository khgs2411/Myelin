# Require independent first-create usefulness critique

First-create Project Memory should pass deterministic validation and then an independent model-backed usefulness critique before project state can mark it curated. The deterministic gate verifies structure, rendered sections, citations, answer-domain coverage, evidence coverage, and answerability fixtures; the independent critique asks whether the rendered documentation is practically useful to a future agent working in the repo.

Considered options: rely on deterministic gates only, or require human dogfood approval before curated state. We choose an independent critique because the failed dogfood was a usefulness failure, and first-create needs an automated guardrail against generic but technically valid documentation.
