# `src/development/development-capture.adapter.ts`

> Pseudocode artifact. Non-executable reference shape.

Focused extension to the existing development capture adapter. The fixture
author supplies source attribution. Unknown attribution remains null.

```typescript
type DevelopmentCaptureInput = Readonly<{
  // Existing fixture fields remain.
  speakerRole?: "user" | "assistant" | null;
}>;

class DevelopmentCaptureAdapter implements ICaptureAdapter {
  public normalize(input: unknown): CaptureResult {
    // Preserve existing input validation and complete native serialization.
    // If supplied, validate speakerRole as "user", "assistant", or null.
    // Reject other supplied values through the existing invalid-input failure.
    // Missing role means unknown, preserving existing role-less fixtures.

    // Extend the existing CaptureResult:
    // speakerRole <- fixture.speakerRole, or null when absent.
    // normalizedContent <- fixture.content, unchanged.
    // Preserve the existing references, time, workspace, and replay coordinates.
  }
}
```

Do not infer a role from item order, content, or fixture references. Role does
not affect replay identity. Complete source serialization still includes an
explicitly supplied role; normal conflicting-replay checks remain applicable.

Capture accepts nullable content under its existing input contract.
EvidenceManager owns skipping contentless candidates before persistence.
