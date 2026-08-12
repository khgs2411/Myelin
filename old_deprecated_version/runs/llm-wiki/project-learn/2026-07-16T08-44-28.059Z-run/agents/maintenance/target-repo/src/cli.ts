#!/usr/bin/env bun

import { createCli } from "./commands/registry.ts";
import { registerCommands } from "./commands/register.ts";
import { resolveLaunchContext } from "./runtime/launch-context.ts";

const cli = createCli("myelin");
const callerCwd = process.cwd();
const context = await resolveLaunchContext({ callerCwd, entrypointPath: import.meta.path });
registerCommands(cli, context);

const result = await cli.run(process.argv.slice(2));

if (result.exitCode !== 0) {
  console.error(result.message);
  process.exit(result.exitCode);
}

if (result.message.length > 0) {
  console.log(result.message);
}
