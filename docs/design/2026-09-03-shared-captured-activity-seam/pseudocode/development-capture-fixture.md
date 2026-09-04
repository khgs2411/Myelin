# Development Capture Fixture Boundary

> Pseudocode artifact. Non-executable reference shape.

The development fixture replaces Codex hook installation and automatic
invocation. It does not replace Codex payload parsing or the downstream capture
path.

```ts
type ControlledCompletedCodexTurn = Readonly<{
  userPromptSubmit: ProviderNativeActivity
    // exact controlled Codex UserPromptSubmit JSON
  stop: ProviderNativeActivity
    // exact controlled Codex Stop JSON for the same session_id and turn_id
}>

class DevelopmentCaptureFixture {
  constructor(
    private readonly developmentEvidenceCapture: EvidenceCaptureService
      // configured with sourceIdentity "development.fixture"
      // configured with CodexCaptureAdapter
  ) {}

  async capture(
    turn: ControlledCompletedCodexTurn
  ): Promise<ControlledTurnCaptureResult> {
    require turn contract contains one ordered top-level completed Codex turn

    userResult = await developmentEvidenceCapture.capture({
      nativeActivity: turn.userPromptSubmit
    })
    require userResult is accepted

    assistantResult = await developmentEvidenceCapture.capture({
      nativeActivity: turn.stop
    })
    require assistantResult is accepted

    return {
      userMessage: userResult.acceptance,
      assistantMessage: assistantResult.acceptance
    }
  }
}
```

Each activity keeps its own replay identity from `(session_id, turn_id,
hook_event_name)`. The route domain is `development.fixture`. The fixture never
constructs `CapturedActivityObservation`, calls durable acceptance directly, or
writes Session Memory.

The later fixture-command unit owns the file format, CLI request, controlled
field generation, pair validation, and human output.
