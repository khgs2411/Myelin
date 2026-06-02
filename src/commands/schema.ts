import type { Cli } from "./registry.ts";
import { ok } from "./registry.ts";

export function registerSchemaCommands(cli: Cli): void {
  cli.command(["schema", "check"], () => ok("schema check is registered but not implemented in this slice."));
  cli.command(["schema", "build"], () => ok("schema build is registered but not implemented in this slice."));
}
