import { buildSchemaContext, checkSchema, type SchemaValidationResult } from "./compiler.ts";
import type { SchemaContext } from "./types.ts";

export type BuildSchemaInput = {
  projectKey: string;
  dryRun?: boolean;
  builtAt?: Date;
};

export type BuildSchemaResult = {
  context: SchemaContext;
  wrote: boolean;
  path: string;
};

export class SchemaService {
  constructor(private readonly root: string) {}

  async check(projectKey: string): Promise<SchemaValidationResult> {
    return checkSchema(this.root, projectKey);
  }

  async build(input: BuildSchemaInput): Promise<BuildSchemaResult> {
    return buildSchemaContext(this.root, input.projectKey, {
      dryRun: input.dryRun,
      builtAt: input.builtAt,
    });
  }
}
