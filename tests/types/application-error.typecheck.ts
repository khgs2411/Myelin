import { ApplicationError, type ErrorArguments, type ErrorDomain, type ErrorType } from "../../src/application-error.ts";

// Compile-only examples. This function is never executed by the test runner.
export function checkErrorContracts(): void {
  new ApplicationError("capture:invalid-input");
  new ApplicationError("capture:failed", { cause: new Error() });
  // @ts-expect-error Unknown error codes must remain invalid.
  new ApplicationError("capture:unknown");
  // @ts-expect-error This code takes no context argument.
  new ApplicationError("capture:invalid-input", { cause: new Error() });
  // @ts-expect-error GetMessage must enforce the same argument contract.
  ApplicationError.GetMessage("capture:invalid-input", {});
  const domain: ErrorDomain = "capture";
  const captureType: ErrorType<"capture"> = "replay-conflict";
  // @ts-expect-error CLI error types do not belong to the capture domain.
  const invalidType: ErrorType<"capture"> = "output-failed";
  // @ts-expect-error Domains come from registered codes.
  const invalidDomain: ErrorDomain = "unknown";
  const arguments_: ErrorArguments<"capture:invalid-input"> = [];
  // @ts-expect-error No-argument errors cannot accept context.
  const invalidArguments: ErrorArguments<"capture:invalid-input"> = [{}];
  void [domain, captureType, invalidType, invalidDomain, arguments_, invalidArguments];
}
