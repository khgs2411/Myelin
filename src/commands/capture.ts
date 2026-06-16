import { CaptureService } from "../capture/capture-service.ts";
import { repoRoot } from "../runtime/fs.ts";
import type { Cli, CommandResult } from "./registry.ts";
import { ok } from "./registry.ts";

export function registerCaptureCommands(cli: Cli): void {
  cli.command(["capture", "codex-hook"], async () => {
    try {
      if (isCaptureDisabled()) return ok("");
      const payload = JSON.parse(await Bun.stdin.text());
      await captureCodexPayload(process.env.MYELIN_ROOT ?? repoRoot().root, payload);
    } catch {
      // Codex hooks must fail open; capture should never interrupt an agent session.
    }
    return ok("");
  });
}

export function isCaptureDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MYELIN_CAPTURE_DISABLED === "1";
}

export async function captureCodexPayload(root: string, payload: unknown): Promise<CommandResult> {
  const result = await new CaptureService(root).captureCodexPayload(payload);
  return ok(result.message);
}
