import { describe, expect, test } from "bun:test";
import { ApplicationError } from "../../src/application-error.ts";

describe("ApplicationError public and internal contracts", () => {
  test.each([
    ["capture:invalid-input", "The capture input is invalid."],
    ["capture:replay-conflict", "The replay identity has different stored source material."],
    ["cli:output-failed", "The capture receipt could not be fully written. Capture succeeded."],
    ["cli:cleanup-failed", "Application cleanup failed. This does not change the capture outcome."],
  ] as const)("provides a stable code and safe message for %s", (code, message) => {
    const error = new ApplicationError(code);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.name).toBe("ApplicationError");
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(ApplicationError.GetMessage(code)).toBe(message);
    expect(error.cause).toBeUndefined();
  });

  test.each([new Error("PRIVATE_CAUSE"), "PRIVATE_CAUSE", { secret: "PRIVATE_CAUSE" }, null, false, 0].map((cause, index) => ({ cause, index })))(
    "retains cause $index without including it in public text", ({ cause }) => {
      const error = new ApplicationError("capture:failed", { cause });
      expect(error.cause).toBe(cause);
      expect(error.message).toBe("The capture operation failed.");
      expect(String(error)).toBe("ApplicationError: The capture operation failed.");
    },
  );

  test("permits omitted or empty optional context", () => {
    for (const error of [new ApplicationError("capture:failed"), new ApplicationError("capture:failed", {}), new ApplicationError("capture:failed", { cause: undefined })]) {
      expect(error.cause).toBeUndefined();
      expect(error.message).toBe("The capture operation failed.");
    }
  });
});
