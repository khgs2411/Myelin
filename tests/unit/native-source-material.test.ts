import { describe, expect, test } from "bun:test";
import { ApplicationError } from "../../src/application-error.ts";
import { serializeJsonSource } from "../../src/capture/native-source-material.ts";

function text(value: unknown): string {
  const material = serializeJsonSource(value);
  expect(material.format).toBe("json.v1");
  expect(material.content).toBeInstanceOf(Uint8Array);
  return new TextDecoder("utf-8", { fatal: true }).decode(material.content);
}

function expectInvalid(value: unknown): void {
  let failure: unknown;
  try {
    serializeJsonSource(value);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ApplicationError);
  expect(failure).toMatchObject({ code: "capture:invalid-input" });
}

describe("native source preservation", () => {
  test("round trips supported values without losing fields or numeric meaning", () => {
    const input = {
      unused: { note: "שלום 🌍\n\t\"\\\ud800", flag: true },
      values: [null, false, "", 0, -0, 1.25, Number.MAX_VALUE, Number.MIN_VALUE],
    };
    const decoded = JSON.parse(text(input));
    expect(decoded).toEqual(input);
    expect(Object.is(decoded.values[4], -0)).toBe(true);
    expect(text(Object.assign(Object.create(null), { value: 2 }))).toBe('{"value":2}');
  });

  test("uses stable recursive key ordering, including numeric-looking keys", () => {
    const left = { z: { b: 1, a: 2 }, "2": true, "10": false };
    const right = { "10": false, "2": true, z: { a: 2, b: 1 } };
    expect(text(left)).toBe('{"10":false,"2":true,"z":{"a":2,"b":1}}');
    expect(serializeJsonSource(left).content).toEqual(serializeJsonSource(right).content);
    expect(text("é")).toBe('"é"');
    expect([...serializeJsonSource("é").content]).toEqual([34, 195, 169, 34]);
  });

  test.each([
    [{ value: 1 }, { value: 2 }],
    [{ value: 1 }, { value: 1, extra: null }],
    [[1, 2], [2, 1]],
    [0, -0],
    [null, ""],
  ])("preserves meaningful differences: %p versus %p", (left, right) => {
    expect(text(left)).not.toBe(text(right));
  });

  const unsupported = [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol("native"), new Date(), new Map()];
  test.each(unsupported.map((value, index) => [index, value] as const))(
    "rejects unsupported value %i at root and nested positions", (_index, value) => {
      for (const input of [value, { nested: value }, [value]]) expectInvalid(input);
    },
  );

  test("rejects sparse arrays and unrepresentable own properties", () => {
    for (const value of [
      new Array(2),
      Object.assign([1], { extra: 2 }),
      { [Symbol("key")]: 1 },
      Object.defineProperty({}, "hidden", { value: 1 }),
    ]) expectInvalid(value);
  });

  test("rejects accessors without executing getters", () => {
    let reads = 0;
    const value = Object.defineProperty({}, "value", {
      enumerable: true,
      get() { reads += 1; return "secret"; },
    });
    expectInvalid(value);
    expect(reads).toBe(0);
  });

  test("rejects cycles but permits repeated non-circular references", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expectInvalid(cycle);
    const array: unknown[] = [];
    array.push(array);
    expectInvalid(array);
    const shared = { value: [1, 2] };
    expect(JSON.parse(text([shared, shared]))).toEqual([{ value: [1, 2] }, { value: [1, 2] }]);
  });

  test("does not mutate caller-owned objects or arrays", () => {
    const nested = Object.freeze([3, 1, 2]);
    const input = Object.freeze({ z: nested, a: "first" });
    text(input);
    expect(Object.keys(input)).toEqual(["z", "a"]);
    expect(input.z).toBe(nested);
    expect(input.z).toEqual([3, 1, 2]);
  });
});
