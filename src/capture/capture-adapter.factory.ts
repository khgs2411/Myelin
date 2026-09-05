import { ApplicationError } from "../application-error.ts";
import { DevelopmentCaptureAdapter } from "../development/development-capture.adapter.ts";
import type { CaptureSourceKey, ICaptureAdapter } from "./capture-adapter.ts";

export class CaptureAdapterFactory {
  public create(sourceKey: CaptureSourceKey): ICaptureAdapter {
    switch (sourceKey) {
      case "development.fixture":
        return new DevelopmentCaptureAdapter();
      default:
        throw new ApplicationError("capture:unsupported-source");
    }
  }
}
