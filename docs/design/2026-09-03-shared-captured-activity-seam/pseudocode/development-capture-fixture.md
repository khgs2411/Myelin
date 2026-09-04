# Development Capture Fixture Flow

> Pseudocode artifact. Non-executable reference shape.

The local command manually supplies captured input. It replaces installation
and automatic provider delivery only.

```ts
COMMAND dev capture-fixture <fixture-file>
  exactFixtureInputs = read one ordered non-empty input array

  sourceKey = "development.fixture"
    // trusted command composition, not fixture data

  adapter = captureAdapterFactory.create(sourceKey)
  captureResults = exactFixtureInputs map in order:
    adapter.normalize(exact fixture record as NativeCaptureInput)

  receipt = await evidenceCaptureService.captureBatch({
    sourceKey,
    results: captureResults
  })

  print each durable evidence id, project sequence, and disposition
```

The command submits the complete ordered array as one operation. Adapter
normalization and workspace resolution finish before `EvidenceItemService`
starts its transaction. A failure writes no rows.

The command does not generate Codex payloads, write SQLite, read evidence,
register a Project, retry capture, or invoke Session Memory. It uses the
existing seeded LLM Wiki Project through normal workspace resolution.

The command verifies the shared path from `CaptureResult` to SQLite. Separate
Codex adapter verification covers the Codex-native input contract.
