# `src/application-error.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/application-error.ts`

One shared Error subclass supplies typed, domain-qualified codes and fixed safe
messages. The registry determines each code's constructor arguments. Additional
domains extend the registry without adding error subclasses.

```ts
interface IApplicationErrorContext {
  readonly cause?: unknown
}

type ErrorMessageArguments =
  [] | [context: IApplicationErrorContext] | [context?: IApplicationErrorContext]

const defineError = <TArguments extends ErrorMessageArguments>(
  getMessage: (...arguments_: TArguments) => string
): ((...arguments_: TArguments) => string) => getMessage

const ERROR_DEFINITIONS = {
  "capture:unsupported-source": defineError(() =>
    "The capture source is not supported."),
  "capture:invalid-input": defineError(() =>
    "The capture input is invalid."),
  "capture:unmanaged-workspace": defineError(() =>
    "A capture working directory has no managed Project."),
  "capture:mixed-project-batch": defineError(() =>
    "The capture batch contains more than one Project."),
  "capture:replay-conflict": defineError(() =>
    "The replay identity has different stored source material."),
  "capture:failed": defineError((_context?: IApplicationErrorContext) =>
    "The capture operation failed."),
  "cli:fixture-read-failed": defineError((_context?: IApplicationErrorContext) =>
    "The fixture file could not be read."),
  "cli:fixture-parse-failed": defineError((_context?: IApplicationErrorContext) =>
    "The fixture file contains invalid JSON."),
  "cli:startup-failed": defineError((_context?: IApplicationErrorContext) =>
    "The application could not start."),
  "cli:output-failed": defineError((_context?: IApplicationErrorContext) =>
    "The capture receipt could not be fully written. Capture succeeded."),
  "cli:cleanup-failed": defineError((_context?: IApplicationErrorContext) =>
    "Application cleanup failed. This does not change the capture outcome.")
} as const

type ErrorCode = keyof typeof ERROR_DEFINITIONS
// Derive ErrorDomain from the prefix before ':' in ErrorCode.
// Derive ErrorType<TDomain> from suffixes of codes belonging to that domain.
type ErrorArguments<TCode extends ErrorCode> =
  Parameters<(typeof ERROR_DEFINITIONS)[TCode]>

class ApplicationError<TCode extends ErrorCode = ErrorCode> extends Error {
  public override readonly name: string = "ApplicationError"
  public readonly code: TCode

  public constructor(code: TCode, ...arguments_: ErrorArguments<TCode>) {
    context = optional context from arguments_
    super(ApplicationError.GetMessage(code, ...arguments_), optional cause options)
    this.code = code
  }

  public static GetMessage<TCode extends ErrorCode>(
    code: TCode,
    ...arguments_: ErrorArguments<TCode>
  ): string {
    return the registry message generator for code applied to arguments_
  }
}
```

The optional cause retains the underlying failure for internal use. It is not
safe output. The CLI prints only `code` and the registry-generated `message`;
it does not print the complete error, stack, context, or cause chain. Message
generators must not interpolate native input or underlying failure details.

The existing implementation uses ordinary Error objects. This artifact defines
the shared design; it does not migrate existing code.
