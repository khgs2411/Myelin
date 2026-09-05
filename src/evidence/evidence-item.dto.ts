import type {
  CaptureSourceKey,
  NativeSourceMaterial,
  NormalizedTimestamp,
} from "../capture/capture-adapter.ts";
import type { WorkspaceContext } from "../workspace/workspace-context.ts";

export type EvidenceItemDto = Readonly<{
  captureSourceKey: CaptureSourceKey;
  workspaceContext: WorkspaceContext;
  nativeEventKind: string;
  nativeSessionReference?: string;
  nativeInteractionReference?: string;
  nativeOccurredAt?: NormalizedTimestamp;
  normalizedContent: string | null;
  replay: Readonly<{
    scheme: string;
    key: string;
  }>;
  sourceMaterial: NativeSourceMaterial;
}>;
