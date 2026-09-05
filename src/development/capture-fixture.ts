import { readFile } from "node:fs/promises";

import { ApplicationError } from "../application-error.ts";

export async function readDevelopmentCaptureFixture(
  filePath: string,
): Promise<readonly unknown[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (cause) {
    throw new ApplicationError("cli:fixture-read-failed", { cause });
  }

  let inputs: unknown;
  try {
    inputs = JSON.parse(text);
  } catch (cause) {
    throw new ApplicationError("cli:fixture-parse-failed", { cause });
  }

  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new ApplicationError("capture:invalid-input");
  }

  return inputs;
}
