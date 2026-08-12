# Use a layer-shaped runtime inbox with implemented consumers

Runtime Durable-Memory Inbox items should use one shared layer-shaped contract for Project, Practice, and Personal Memory proposals, but the first working product must only accept layers that have an implemented consumer. In the current slice, Project Memory proposals are accepted and normalized into `memory_candidates`; Practice and Personal proposals are rejected with an explicit unsupported-layer result until their curator/promoter consumers exist.

## Considered Options

- Accept every layer immediately and preserve unconsumed Practice/Personal inbox items for later.
- Hide Practice/Personal from the product shape until their implementations exist.
- Keep the shared layer-shaped contract, but reject unsupported layers at creation/intake until a consumer exists.

## Consequences

The contract preserves the durable-memory waterfall shape across all long-lived memory layers without creating dead queues or implying that unimplemented layers can maintain themselves. Future Practice and Personal Memory work should enable those layers by adding real consumers to the same runtime inbox/intake boundary, not by inventing a separate proposal path.
