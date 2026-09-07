export type ApplicationConfigurationErrorKind =
  | "missing"
  | "unreadable"
  | "invalid-json"
  | "invalid-setting";

export type ApplicationConfigurationField =
  | "root"
  | "sqlite"
  | "sqlite.databasePath"
  | "evidenceIngestion"
  | "evidenceIngestion.batchSize"
  | "agents"
  | "agents.evidenceCurator"
  | "agents.evidenceCurator.provider"
  | "agents.evidenceCurator.model"
  | "agents.memoryReviewer"
  | "agents.memoryReviewer.provider"
  | "agents.memoryReviewer.model";

export type ApplicationConfigurationSettingConstraint =
  | "object"
  | "non-empty-string"
  | "positive-even-integer";

export type ApplicationConfigurationErrorDiagnostic =
  | {
      readonly kind: "missing" | "unreadable" | "invalid-json";
      readonly path: string;
    }
  | {
      readonly kind: "invalid-setting";
      readonly path: string;
      readonly fieldName: ApplicationConfigurationField;
      readonly constraint: ApplicationConfigurationSettingConstraint;
    };

/**
 * Marks configuration failures that are safe to explain at the CLI boundary.
 * The original cause is retained for internal debugging but is never used to
 * construct user-facing text.
 */
export class ApplicationConfigurationError extends Error {
  public override readonly name: string = "ApplicationConfigurationError";
  public readonly diagnostic: ApplicationConfigurationErrorDiagnostic;

  public constructor(
    diagnostic: ApplicationConfigurationErrorDiagnostic,
    cause?: unknown,
  ) {
    super("The application configuration could not be loaded.", {
      cause,
    });
    this.diagnostic = diagnostic;
  }
}

export interface IApplicationErrorContext {
  readonly cause?: unknown;
}

export interface IApplicationConfigurationErrorContext
  extends IApplicationErrorContext {
  readonly configuration?: ApplicationConfigurationErrorDiagnostic;
}

type ErrorMessageArguments =
  | []
  | [context: IApplicationErrorContext]
  | [context?: IApplicationErrorContext];

const defineError = <TArguments extends ErrorMessageArguments>(
  getMessage: (...arguments_: TArguments) => string,
): ((...arguments_: TArguments) => string) => getMessage;

const ERROR_DEFINITIONS = {
  "capture:unsupported-source": defineError(
    (): string => "The capture source is not supported.",
  ),
  "capture:invalid-input": defineError(
    (): string => "The capture input is invalid.",
  ),
  "capture:unmanaged-workspace": defineError(
    (): string => "A capture working directory has no managed Project.",
  ),
  "capture:mixed-project-batch": defineError(
    (): string => "The capture batch contains more than one Project.",
  ),
  "capture:replay-conflict": defineError(
    (): string => "The replay identity has different stored source material.",
  ),
  "capture:failed": defineError(
    (_context?: IApplicationErrorContext): string =>
      "The capture operation failed.",
  ),
  "cli:configuration-failed": defineError(
    (context?: IApplicationConfigurationErrorContext): string =>
      getConfigurationErrorMessage(context?.configuration),
  ),
  "ingestion:configuration-unavailable": defineError(
    (): string =>
      "Evidence ingestion requires the validated application configuration.",
  ),
  "ingestion:executor-unavailable": defineError(
    (): string =>
      "The configured evidence curator executor is not available.",
  ),
  "cli:fixture-read-failed": defineError(
    (_context?: IApplicationErrorContext): string =>
      "The fixture file could not be read.",
  ),
  "cli:fixture-parse-failed": defineError(
    (_context?: IApplicationErrorContext): string =>
      "The fixture file contains invalid JSON.",
  ),
  "cli:startup-failed": defineError(
    (_context?: IApplicationErrorContext): string =>
      "The application could not start.",
  ),
  "cli:output-failed": defineError(
    (_context?: IApplicationErrorContext): string =>
      "The capture receipt could not be fully written. Capture succeeded.",
  ),
  "cli:cleanup-failed": defineError(
    (_context?: IApplicationErrorContext): string =>
      "Application cleanup failed. This does not change the capture outcome.",
  ),
} as const;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

type ErrorDomainFromCode<TCode extends ErrorCode> =
  TCode extends `${infer TDomain}:${string}` ? TDomain : never;

export type ErrorDomain = ErrorDomainFromCode<ErrorCode>;

type ErrorTypeFromCode<TCode extends ErrorCode> =
  TCode extends `${string}:${infer TErrorType}` ? TErrorType : never;

export type ErrorType<TDomain extends ErrorDomain = ErrorDomain> =
  ErrorTypeFromCode<Extract<ErrorCode, `${TDomain}:${string}`>>;

export type ErrorArguments<TCode extends ErrorCode> = Parameters<
  (typeof ERROR_DEFINITIONS)[TCode]
>;

type ErrorMessageGenerator<TCode extends ErrorCode> = (
  ...arguments_: ErrorArguments<TCode>
) => string;

function getConfigurationErrorMessage(
  diagnostic: ApplicationConfigurationErrorDiagnostic | undefined,
): string {
  if (!diagnostic) {
    return "The application configuration could not be loaded.";
  }

  const path = JSON.stringify(diagnostic.path);

  switch (diagnostic.kind) {
    case "missing":
      return `The application configuration file is missing at ${path}. Create the file and retry.`;
    case "unreadable":
      return `The application configuration file could not be read at ${path}. Check the file permissions and retry.`;
    case "invalid-json":
      return `The application configuration file contains invalid JSON at ${path}. Correct the JSON and retry.`;
    case "invalid-setting":
      return `The application configuration setting ${JSON.stringify(
        diagnostic.fieldName,
      )} is invalid at ${path}. ${getConfigurationConstraintMessage(
        diagnostic.constraint,
      )}.`;
  }
}

function getConfigurationConstraintMessage(
  constraint: ApplicationConfigurationSettingConstraint,
): string {
  switch (constraint) {
    case "object":
      return "It must be an object";
    case "non-empty-string":
      return "It must be a non-empty string";
    case "positive-even-integer":
      return "It must be a positive, even integer";
  }
}

export class ApplicationError<
  TCode extends ErrorCode = ErrorCode,
> extends Error {
  public override readonly name: string = "ApplicationError";
  public readonly code: TCode;

  public constructor(code: TCode, ...arguments_: ErrorArguments<TCode>) {
    const [context] = arguments_ as [IApplicationErrorContext?];

    super(
      ApplicationError.GetMessage(code, ...arguments_),
      context?.cause === undefined ? undefined : { cause: context.cause },
    );

    this.code = code;
  }

  public static GetMessage<TCode extends ErrorCode>(
    code: TCode,
    ...arguments_: ErrorArguments<TCode>
  ): string {
    const getMessage = ERROR_DEFINITIONS[code] as ErrorMessageGenerator<TCode>;
    return getMessage(...arguments_);
  }
}
