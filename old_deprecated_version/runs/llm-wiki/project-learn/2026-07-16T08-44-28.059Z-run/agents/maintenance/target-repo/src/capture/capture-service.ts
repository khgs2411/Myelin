import { handleCaptureEvent } from "./facade.ts";
import { normalizeCodexHookPayload } from "./providers/codex.ts";

export type CapturePayloadResult = {
  message: string;
};

export class CaptureService {
  constructor(private readonly root: string) {}

  async captureCodexPayload(payload: unknown): Promise<CapturePayloadResult> {
    const event = normalizeCodexHookPayload(payload);
    if (!event) return { message: "codex hook ignored" };

    const result = await handleCaptureEvent(this.root, event);
    if (result.status === "failed-open") return { message: `capture failed open: ${result.error_message}` };
    return { message: `capture ${result.status}` };
  }
}
