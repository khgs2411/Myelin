import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  ApplicationConfigurationError,
  type ApplicationConfigurationField,
  type ApplicationConfigurationSettingConstraint,
} from "./application-error.ts";

const DEFAULT_BATCH_SIZE = 32;

export const APPLICATION_CONFIGURATION_PATH = resolve(
  import.meta.dir,
  "..",
  "config.json",
);

export interface IApplicationConfiguration {
  readonly sqlite: {
    readonly databasePath: string;
  };

  readonly evidenceIngestion: {
    readonly batchSize: number;
  };

  readonly agents: {
    readonly evidenceCurator: {
      readonly provider: string;
      readonly model: string;
    };
    readonly memoryReviewer: {
      readonly provider: string;
      readonly model: string;
    };
  };
}

export async function loadApplicationConfiguration(): Promise<IApplicationConfiguration> {
  const configurationText = await readConfigurationText();
  const configuration = parseConfiguration(configurationText);

  return normalizeConfiguration(configuration);
}

async function readConfigurationText(): Promise<string> {
  try {
    return await readFile(APPLICATION_CONFIGURATION_PATH, "utf8");
  } catch (cause) {
    throw createConfigurationError(
      {
        kind: readErrorCode(cause) === "ENOENT" ? "missing" : "unreadable",
      },
      cause,
    );
  }
}

function parseConfiguration(configurationText: string): unknown {
  try {
    return JSON.parse(configurationText) as unknown;
  } catch (cause) {
    throw createConfigurationError({ kind: "invalid-json" }, cause);
  }
}

function normalizeConfiguration(
  configuration: unknown,
): IApplicationConfiguration {
  const root = requireRecord(configuration, "root");
  const sqlite = requireRecord(root.sqlite, "sqlite");
  const evidenceIngestion = requireRecord(
    root.evidenceIngestion,
    "evidenceIngestion",
  );
  const agents = requireRecord(root.agents, "agents");
  const evidenceCurator = requireRecord(
    agents.evidenceCurator,
    "agents.evidenceCurator",
  );
  const memoryReviewer = requireRecord(
    agents.memoryReviewer,
    "agents.memoryReviewer",
  );

  const databasePath = requireNonEmptyString(
    sqlite.databasePath,
    "sqlite.databasePath",
  );

  return {
    sqlite: {
      databasePath: resolve(dirname(APPLICATION_CONFIGURATION_PATH), databasePath),
    },
    evidenceIngestion: {
      batchSize: readBatchSize(evidenceIngestion),
    },
    agents: {
      evidenceCurator: {
        provider: requireNonEmptyString(
          evidenceCurator.provider,
          "agents.evidenceCurator.provider",
        ),
        model: requireNonEmptyString(
          evidenceCurator.model,
          "agents.evidenceCurator.model",
        ),
      },
      memoryReviewer: {
        provider: requireNonEmptyString(
          memoryReviewer.provider,
          "agents.memoryReviewer.provider",
        ),
        model: requireNonEmptyString(
          memoryReviewer.model,
          "agents.memoryReviewer.model",
        ),
      },
    },
  };
}

function readBatchSize(evidenceIngestion: Record<string, unknown>): number {
  if (!Object.hasOwn(evidenceIngestion, "batchSize")) {
    return DEFAULT_BATCH_SIZE;
  }

  const batchSize = evidenceIngestion.batchSize;
  if (
    typeof batchSize !== "number" ||
    !Number.isSafeInteger(batchSize) ||
    batchSize <= 0 ||
    batchSize % 2 !== 0
  ) {
    throw createConfigurationError({
      kind: "invalid-setting",
      fieldName: "evidenceIngestion.batchSize",
      constraint: "positive-even-integer",
    });
  }

  return batchSize;
}

function requireNonEmptyString(
  value: unknown,
  fieldName: ApplicationConfigurationField,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createConfigurationError({
      kind: "invalid-setting",
      fieldName,
      constraint: "non-empty-string",
    });
  }

  return value.trim();
}

function requireRecord(
  value: unknown,
  fieldName: ApplicationConfigurationField,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw createConfigurationError({
      kind: "invalid-setting",
      fieldName,
      constraint: "object",
    });
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ConfigurationErrorDetails =
  | {
      readonly kind: "missing" | "unreadable" | "invalid-json";
    }
  | {
      readonly kind: "invalid-setting";
      readonly fieldName: ApplicationConfigurationField;
      readonly constraint: ApplicationConfigurationSettingConstraint;
    };

function createConfigurationError(
  details: ConfigurationErrorDetails,
  cause?: unknown,
): ApplicationConfigurationError {
  return new ApplicationConfigurationError(
    { ...details, path: APPLICATION_CONFIGURATION_PATH },
    cause,
  );
}

function readErrorCode(cause: unknown): string | undefined {
  if (!isRecord(cause) || typeof cause.code !== "string") {
    return undefined;
  }

  return cause.code;
}
