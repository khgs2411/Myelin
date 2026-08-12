export type CommandResult = {
  exitCode: number;
  message: string;
};

export type CommandHandler = (args: string[]) => CommandResult | Promise<CommandResult>;

type RegisteredCommand = {
  path: string[];
  handler: CommandHandler;
};

export type Cli = {
  command: (path: string[], handler: CommandHandler) => void;
  run: (args: string[]) => Promise<CommandResult>;
};

export function createCli(name: string): Cli {
  const commands: RegisteredCommand[] = [];

  return {
    command(path, handler) {
      commands.push({ path, handler });
    },

    async run(args) {
      if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        return ok(help(name, commands));
      }

      const match = commands
        .filter((command) => command.path.every((part, index) => args[index] === part))
        .sort((a, b) => b.path.length - a.path.length)[0];

      if (!match) {
        return fail(`Unknown command: ${args.join(" ")}\n\n${help(name, commands)}`);
      }

      return await match.handler(args.slice(match.path.length));
    },
  };
}

export function ok(message: string): CommandResult {
  return { exitCode: 0, message };
}

export function fail(message: string): CommandResult {
  return { exitCode: 1, message };
}

function help(name: string, commands: RegisteredCommand[]): string {
  const commandList = commands
    .map((command) => `  ${name} ${command.path.join(" ")}`)
    .sort()
    .join("\n");

  return `Usage: ${name} <command>\n\nCommands:\n${commandList}`;
}
