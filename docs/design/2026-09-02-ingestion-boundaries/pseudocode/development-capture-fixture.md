# Development Capture Fixture Boundary

> Pseudocode artifact. Non-executable reference shape.

This boundary describes the canonical internal tool used to feed controlled
conversation evidence into the captured-evidence and Session Memory pipeline
before real provider hooks are enabled.

```ts
// intentionally illustrative pseudocode

type DevelopmentCaptureFixtureRequest = Readonly<{
  providerSessionReference: string
  content: string
  fixtureReference: string
}>

DEVELOPMENT_COMMAND dev capture-fixture
  require the application development environment
  require one transcript text-file path
  read the file as one exact string
  accept providerSessionReference and fixtureReference as separate command inputs
  use the fixed local project context bound by Application composition
  call the canonical Development Capture Fixture operation

DEVELOPMENT_CAPTURE_FIXTURE
  reject use outside the application development environment
  require one fixed WorkspaceContext was bound during Application composition
  require usable transcript content but preserve its exact bytes

  establish trusted capture source as "development.fixture"
  construct one CapturedEvidenceObservation that is equivalent to the
    post-adapter observation produced for one provider activity:
      native event kind: "development.conversation-fixture"
      provider session reference: supplied reference
      provider interaction reference: supplied fixtureReference
      content: exact transcript string
      raw source media type: "text/plain"
      raw source content: exact transcript string
      source replay:
        scheme: "development-fixture/v1"
        key: stable digest of canonical tuple {
          project: bound ProjectIdentity,
          session: providerSessionReference,
          fixture: fixtureReference,
          event: "development.conversation-fixture"
        }

  call CapturedEvidenceIngestionService.ingest with:
    sourceIdentity: "development.fixture"
    observation: constructed CapturedEvidenceObservation
    workspaceContext: resolved WorkspaceContext

  return after captured evidence and its Session maintenance obligation are durable
  do not wait for Session maintenance execution
```

The tool is part of the application's designed identity. It is not an ad hoc
database script and does not call the targeted durable-memory insertion
operation. The development command is not published or enabled in a production
installation.

The tool joins the capture pipeline after provider-native hook parsing would
have completed. Application composition supplies the fixed local project
context. The tool therefore proves shared captured-evidence construction,
acceptance, Session maintenance, and later retrieval. It does not prove a Codex
hook payload, provider adapter, project resolution, hook installation, or hook
failure behavior.

`fixtureReference` identifies one logical transcript snapshot. Reusing the same
bound project, session, and fixture reference with unchanged content produces
a replay. Reusing it after any candidate content or context change produces a
conflict. A new logical snapshot requires a new fixture reference.

The source replay domain is `development.fixture`. The file path and content
digest do not identify the fixture. A file can move without changing identity,
and changed content under one identity must conflict instead of becoming a new
event silently.
