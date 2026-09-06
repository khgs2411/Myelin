# `src/application.configuration.ts`

> Pseudocode artifact. Non-executable reference shape.

The user selected application configuration, a repository-local `config.json`,
and JSON format. This incremental contract records the approved startup rules
and independent execution settings for each agent role.

```typescript
interface IApplicationConfiguration {
  readonly sqlite: {
    readonly databasePath: string;
  };

  readonly evidenceIngestion: {
    readonly batchSize: number; // Default: 32.
  };

  readonly agents: {
    readonly evidenceCurator: {
      readonly provider: string;
      readonly model: string;
    };
    readonly memoryReviewer: {
      readonly provider: string;
      readonly model: string;
    };
  };
}
```

Application startup loads and validates configuration. Each service receives
its relevant settings. Ingestion uses `evidenceIngestion` and the
`agents.evidenceCurator` execution settings. The separate reviewer uses
`agents.memoryReviewer`. The database retains `sqlite.databasePath`.

The file is managed at the repository root for now. Installation will define
the installed location and copy behavior. The TypeScript contract does not
depend on that final location.

`config.json` has the same nested keys shown above. No actual configuration file
is created by this artifact: provider and model values await the execution
adapter contract. Source identity remains a separate ingestion request input.

## Existing Contract And Remaining Design

The current `RuntimeApplicationConfiguration` in
[application.ts](../../../../src/application.ts) contains `sqlite.databasePath`
and optional `workingDirectory` for existing callers. This proposed application
contract will replace that ownership; implementation must account for existing
callers rather than silently remove compatibility.

## Startup And Validation

- One runtime constant, `APPLICATION_CONFIGURATION_PATH`, identifies the
  repository's `config.json`. Installation can change its value later. There is
  no configuration-path argument or file discovery behavior.
- Startup reads and validates JSON before opening SQLite. A missing or invalid
  file stops startup with a clear error.
- Startup resolves relative `sqlite.databasePath` values against the
  configuration file's directory.
- The interface describes normalized runtime settings. If batchSize is omitted
  from the file, startup supplies 32. An explicit value must be a positive, even
  integer. There is no design-imposed maximum of 32.
- Batch size limits selection. Fewer eligible records form a valid batch, even
  when the resulting count is odd. Even limits do not guarantee complete pairs.
- Each agent role requires explicit provider and model settings. Missing either
  stops startup with a clear configuration error. Roles can use different
  providers or models; neither is selected from the evidence source.

Execution provider and model identifiers follow the execution adapter contract.
No provider, model, transport, or credential representation is selected here.
