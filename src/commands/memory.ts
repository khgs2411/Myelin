import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";

export function registerMemoryCommands(cli: Cli): void {
  cli.command(["memory", "query"], (args) => {
    if (args.length === 0) {
      return fail("Usage: myelin memory query <key> <question>");
    }

    return ok("memory query is registered but not implemented in this slice.");
  });
}
