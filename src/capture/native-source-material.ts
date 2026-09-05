import { ApplicationError } from "../application-error.ts";
import type { NativeSourceMaterial } from "./capture-adapter.ts";

export function serializeJsonSource(input: unknown): NativeSourceMaterial {
  const json = encodeJsonValue(input, new Set<object>());
  return { format: "json.v1", content: new TextEncoder().encode(json) };
}

function encodeJsonValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // JSON can preserve negative zero when it is written explicitly.
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    throw new ApplicationError("capture:invalid-input");
  }

  const isArray = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new ApplicationError("capture:invalid-input");
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    if (isArray && key === "length") {
      continue;
    }

    if (typeof key !== "string") {
      throw new ApplicationError("capture:invalid-input");
    }

    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new ApplicationError("capture:invalid-input");
    }
  }

  ancestors.add(value);
  try {
    if (isArray) {
      // Reject sparse arrays and extra properties instead of losing them.
      if (keys.length !== value.length + 1) {
        throw new ApplicationError("capture:invalid-input");
      }

      const elements: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) {
          throw new ApplicationError("capture:invalid-input");
        }
        elements.push(encodeJsonValue(descriptor.value, ancestors));
      }
      return `[${elements.join(",")}]`;
    }

    const fields = Object.keys(descriptors)
      .sort()
      .map((key) => {
        const descriptor = descriptors[key]!;
        return `${JSON.stringify(key)}:${encodeJsonValue(descriptor.value, ancestors)}`;
      });
    return `{${fields.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
