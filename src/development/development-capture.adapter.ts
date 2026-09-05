import { createHash } from "node:crypto";

import { ApplicationError } from "../application-error.ts";
import type {
  CaptureResult,
  ICaptureAdapter,
  NormalizedTimestamp,
} from "../capture/capture-adapter.ts";
import { serializeJsonSource } from "../capture/native-source-material.ts";

type DevelopmentCaptureInput = Readonly<{
  fixtureReference: string;
  itemIndex: number;
  workingDirectory: string;
  content: string | null;
  occurredAt?: NormalizedTimestamp;
}>;

export class DevelopmentCaptureAdapter implements ICaptureAdapter {
  public normalize(input: unknown): CaptureResult {
    const sourceMaterial = serializeJsonSource(input);
    const fixture = validateInput(input);

    return {
      nativeEventKind: "fixture.input",
      nativeSessionReference: fixture.fixtureReference,
      nativeInteractionReference: String(fixture.itemIndex),
      ...(fixture.occurredAt === undefined
        ? {}
        : { nativeOccurredAt: fixture.occurredAt }),
      normalizedContent: fixture.content,
      workingDirectory: fixture.workingDirectory,
      replay: {
        scheme: "development-fixture/v1",
        key: createHash("sha256")
          .update(
            JSON.stringify([fixture.fixtureReference, fixture.itemIndex]),
            "utf8",
          )
          .digest("hex"),
      },
      sourceMaterial,
    };
  }
}

function validateInput(input: unknown): DevelopmentCaptureInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ApplicationError("capture:invalid-input");
  }

  const record = input as Record<string, unknown>;
  if (
    typeof record.fixtureReference !== "string" ||
    record.fixtureReference.trim().length === 0 ||
    typeof record.itemIndex !== "number" ||
    !Number.isSafeInteger(record.itemIndex) ||
    record.itemIndex < 0 ||
    Object.is(record.itemIndex, -0) ||
    typeof record.workingDirectory !== "string" ||
    record.workingDirectory.trim().length === 0 ||
    (typeof record.content !== "string" && record.content !== null)
  ) {
    throw new ApplicationError("capture:invalid-input");
  }

  if (record.occurredAt !== undefined) {
    if (
      typeof record.occurredAt !== "string" ||
      !Number.isFinite(Date.parse(record.occurredAt)) ||
      new Date(record.occurredAt).toISOString() !== record.occurredAt
    ) {
      throw new ApplicationError("capture:invalid-input");
    }
  }

  return record as DevelopmentCaptureInput;
}
