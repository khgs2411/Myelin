#!/usr/bin/env bun

import { createCli } from "./commands/registry.ts";
import { registerBootstrapCommand } from "./commands/bootstrap.ts";
import { registerMemoryCommands } from "./commands/memory.ts";
import { registerProjectCommands } from "./commands/project.ts";
import { registerSchemaCommands } from "./commands/schema.ts";
import { registerSessionCommands } from "./commands/session.ts";
import { registerStatusCommand } from "./commands/status.ts";

const cli = createCli("myelin");

registerStatusCommand(cli);
registerBootstrapCommand(cli);
registerMemoryCommands(cli);
registerProjectCommands(cli);
registerSessionCommands(cli);
registerSchemaCommands(cli);

const result = await cli.run(process.argv.slice(2));

if (result.exitCode !== 0) {
  console.error(result.message);
  process.exit(result.exitCode);
}

if (result.message.length > 0) {
  console.log(result.message);
}
