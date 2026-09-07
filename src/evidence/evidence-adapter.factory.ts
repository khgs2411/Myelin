import { ApplicationError } from "../application-error.ts";
import type { CaptureSourceKey } from "../capture/capture-adapter.ts";
import type { IEvidenceAdapter } from "./evidence.adapter.ts";

export class EvidenceAdapterFactory {
  public Create(_captureSourceKey: CaptureSourceKey): IEvidenceAdapter {
    // No current source has a verified native preparation contract. Do not
    // claim evidence until a source-specific adapter is registered here.
    throw new ApplicationError("capture:unsupported-source");
  }
}
