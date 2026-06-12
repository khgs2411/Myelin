import { handleCaptureEvent } from "../capture/facade.ts";
import { normalizeCodexHookPayload } from "../capture/providers/codex.ts";
import { repoRoot } from "../runtime/fs.ts";
import type { Cli, CommandResult } from "./registry.ts";
import { ok } from "./registry.ts";

export function registerCaptureCommands(cli: Cli): void {
  cli.command(["capture", "codex-hook"], async () => {
    try {
      const payload = JSON.parse(await Bun.stdin.text());
      await captureCodexPayload(process.env.MYELIN_ROOT ?? repoRoot().root, payload);
    } catch {
      // Codex hooks must fail open; capture should never interrupt an agent session.
    }
    return ok("");
  });
}

export async function captureCodexPayload(root: string, payload: unknown): Promise<CommandResult> {
  const event = normalizeCodexHookPayload(payload);
  if (!event) return ok("codex hook ignored");

  const result = await handleCaptureEvent(root, event);
  if (result.status === "failed-open") return ok(`capture failed open: ${result.error_message}`);
  return ok(`capture ${result.status}`);
}
