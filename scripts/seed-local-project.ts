#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Op } from "@sequelize/core";

import { Project } from "../src/storage/sqlite/models/project.model.ts";
import { SqliteDatabase } from "../src/storage/sqlite/sqlite-database.ts";
import { SqliteRuntime } from "../src/storage/sqlite/sqlite-runtime.ts";

const LOCAL_DATABASE_PATH =
  "/Users/liadgoren/Repositories/llm-wiki/.llm-wiki-dev/state.sqlite";

const LOCAL_PROJECT_SEED = {
  key: "llm-wiki",
  rootPath: "/Users/liadgoren/Repositories/llm-wiki",
  repositoryRootPath: "/Users/liadgoren/Repositories/llm-wiki",
} as const;

type LocalProjectSeedResult = Readonly<{
  disposition: "seeded" | "already-seeded";
  projectIdentity: number;
  projectKey: string;
}>;

async function seedLocalProject(
  database: SqliteDatabase,
): Promise<LocalProjectSeedResult> {
  return await database.writeTransaction(async (transaction) => {
    const matches = await Project.findAll({
      where: {
        [Op.or]: [
          { key: LOCAL_PROJECT_SEED.key },
          { rootPath: LOCAL_PROJECT_SEED.rootPath },
        ],
      },
      transaction,
    });

    if (matches.length === 0) {
      const project = await Project.create(
        {
          ...LOCAL_PROJECT_SEED,
          lastAllocatedEvidenceSequence: 0,
        },
        { transaction },
      );

      return {
        disposition: "seeded",
        projectIdentity: project.id,
        projectKey: project.key,
      };
    }

    const [project] = matches;
    if (
      matches.length === 1 &&
      project &&
      project.key === LOCAL_PROJECT_SEED.key &&
      project.rootPath === LOCAL_PROJECT_SEED.rootPath &&
      project.repositoryRootPath === LOCAL_PROJECT_SEED.repositoryRootPath
    ) {
      return {
        disposition: "already-seeded",
        projectIdentity: project.id,
        projectKey: project.key,
      };
    }

    throw new Error(
      'The local Project seed conflicts with an existing key or path.',
    );
  });
}

async function run(args: readonly string[]): Promise<number> {
  if (args.length > 0) {
    process.stderr.write("This development seed accepts no arguments.\n");
    return 2;
  }

  let database: SqliteDatabase | undefined;
  let status = 1;

  try {
    await mkdir(dirname(LOCAL_DATABASE_PATH), { recursive: true });

    const runtime = await SqliteRuntime.initialize();
    database = await SqliteDatabase.open({
      databasePath: LOCAL_DATABASE_PATH,
      runtime,
    });

    const result = await seedLocalProject(database);
    const action =
      result.disposition === "seeded" ? "Seeded" : "Already seeded";
    process.stdout.write(`${action} Project "${result.projectKey}".\n`);
    status = 0;
  } catch (error) {
    const diagnostic =
      error instanceof Error
        ? error.message
        : "Unable to seed the local Project.";
    process.stderr.write(`${diagnostic}\n`);
  }

  if (database) {
    try {
      await database.close();
    } catch {
      process.stderr.write("Unable to close the local SQLite database.\n");
      status = 1;
    }
  }

  return status;
}

if (import.meta.main) {
  process.exitCode = await run(Bun.argv.slice(2));
}
