import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { queryMemory } from "../query/engine.ts";

export function registerMemoryCommands(cli: Cli): void {
  cli.command(["memory", "query"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    const response = await queryMemory({
      root: repoRoot().root,
      projectKey: parsed.projectKey,
      question: parsed.question,
      includeRoute: parsed.debug,
    });
    if (parsed.json) return ok(JSON.stringify(response, null, 2));
    if (response.degraded) return fail(response.answer);
    return ok(response.answer);
  });
}

function parseArgs(args: string[]): {
  projectKey: string;
  question: string;
  json: boolean;
  debug: boolean;
  error?: string;
} {
  let projectKey = "";
  let question = "";
  let json = false;
  let debug = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg.startsWith("-")) {
      return { projectKey, question, json, debug, error: `Unknown memory query option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else if (!question) {
      question = arg;
    } else {
      question = `${question} ${arg}`;
    }
  }

  if (!projectKey || !question) {
    return { projectKey, question, json, debug, error: "Usage: myelin memory query <key> <question> [--json] [--debug]" };
  }
  return { projectKey, question, json, debug };
}
