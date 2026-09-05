# Development Capture Fixture Flow

> Pseudocode artifact. Non-executable reference shape.

The local command manually supplies captured input. It replaces installation
and automatic provider delivery only.

```ts
COMMAND dev capture-fixture <fixture-file>
  application = absent
  receipt = absent
  commandErrors = []

  TRY
    fixtureText = read fixture-file
      ON failure: throw ApplicationError("cli:fixture-read-failed", { cause })

    exactFixtureInputs = parse fixtureText as JSON
      ON failure: throw ApplicationError("cli:fixture-parse-failed", { cause })
      // Application and adapters validate the array and native records.

    application = await Application.Create(existing local configuration)
      ON failure: throw ApplicationError("cli:startup-failed", { cause })

    receipt = await application.capture({
      sourceKey: "development.fixture", // trusted command composition
      nativeInputs: exactFixtureInputs
    })
    // Preserve this known capture success through output and cleanup.

    print each durable evidence id, project sequence, and disposition
      ON failure: throw ApplicationError("cli:output-failed", { cause })

  CATCH error
    append error to commandErrors

  FINALLY
    IF application exists
      TRY await application.close()
      CATCH cause
        append ApplicationError("cli:cleanup-failed", { cause }) to commandErrors
        // Do not replace an earlier error or discard a successful receipt.

  FOR EACH error in commandErrors
    report only error.code and its registry-generated message
      // Best effort if diagnostic output itself is unavailable.
      // Do not print the complete error, stack, or cause chain.

  IF commandErrors is non-empty
    exit unsuccessfully
  OTHERWISE
    exit successfully
```


The command uses the existing Application lifetime and submits the complete
ordered array as one operation. Application owns adapter selection and service
composition. Adapter normalization and workspace resolution finish before `EvidenceItemRepository`
starts its transaction. Validation failure or transaction rollback commits no
new evidence. Command failure after successful capture does not undo evidence.

The command does not generate Codex payloads, write SQLite, read evidence,
register a Project, retry capture, or invoke Session Memory. It uses the
existing seeded LLM Wiki Project through normal workspace resolution.

The command verifies the shared path from `CaptureResult` to SQLite. Separate
Codex adapter verification covers the Codex-native input contract.

File reading, JSON parsing, and startup failures occur before capture. Output
and cleanup failures belong to the command outcome. After capture succeeds,
its receipt remains valid even if the command exits unsuccessfully. These
failures must not be relabeled `capture:failed` or reported as no evidence stored.
If output fails, the caller might receive no confirmation or only part of it.
Repeating the same fixture is safe under the approved replay contract.
