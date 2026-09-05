import type { CaptureSourceKey } from "./capture-adapter.ts";

export type TrustedCaptureInput = Readonly<{
  sourceKey: CaptureSourceKey;
  // Application validates that the ordered input array is non-empty.
  nativeInputs: readonly unknown[];
}>;
