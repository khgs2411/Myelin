export const PROJECT_MEMORY_BEHAVIOR_COVERAGE_GUIDANCE = [
  "Treat behavior-shaping enums, policies, modes, and state transitions as first-class documentation subjects when they affect user-visible outcomes.",
  "For each such contract, document every currently supported value, the outcome for each relevant user or resource condition, and the precedence between access, eligibility, membership, approval, and state-transition gates.",
  "Ground behavior claims in current implementation and regression-test evidence. Historical plans may explain intent but must not be the only evidence for current behavior.",
  "If a high-impact behavior contract cannot be verified completely, name the missing coverage in known_gaps instead of presenting the subject as complete.",
] as const;
