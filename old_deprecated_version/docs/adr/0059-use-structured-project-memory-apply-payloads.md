# Use structured Project Memory apply payloads

Project Memory markdown apply should consume structured page and entry payloads that deterministic TypeScript code validates and renders, rather than accepting free-form markdown patches or treating `content_intent` as write authority. This preserves the boundary where the curator decides what durable knowledge changed, while Myelin code owns canonical markdown shape, provenance rendering, lifecycle markers, and safe file mutation.

## Considered Options

- Structured page/entry payloads rendered by code.
- Exact markdown payloads inserted into stable blocks.
- Patch-like changes against target markdown.

## Consequences

The contract and renderer are more work, but canonical Project Memory writes become more bounded, testable, and auditable.
