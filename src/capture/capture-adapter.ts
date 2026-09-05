// Established by entry composition; the factory validates supported sources.
export type CaptureSourceKey = string;

// UTC ISO text in Date.toISOString() form, validated by the adapter.
export type NormalizedTimestamp = string;

export type NativeSourceMaterial = Readonly<{
  format: string;
  content: Uint8Array;
}>;

export type CaptureResult = Readonly<{
  nativeEventKind: string;
  nativeSessionReference?: string;
  nativeInteractionReference?: string;
  nativeOccurredAt?: NormalizedTimestamp;
  normalizedContent: string | null;
  workingDirectory: string;
  replay: Readonly<{
    scheme: string;
    key: string;
  }>;
  sourceMaterial: NativeSourceMaterial;
}>;

export interface ICaptureAdapter {
  normalize(input: unknown): CaptureResult;
}
