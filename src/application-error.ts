export interface IApplicationErrorContext {
  readonly cause?: unknown;
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
