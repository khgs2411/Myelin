import type { ProjectMemoryApplyResult } from "./project-memory-apply-contracts.ts";
import type {
  ProjectMemoryCuratorMode,
  RunProjectMemoryCuratorInput,
} from "./project-memory-curator-contracts.ts";
import type { ProjectCuratorRunPaths } from "../runtime/project-run-infrastructure.ts";

export type ProjectMemoryPostApplyRetrievalLifecycleResult = {
  status: "completed" | "pending";
  artifacts: {
    retrieval_sections?: "project-memory-retrieval-sections.json";
    hint_generation?: "project-memory-hint-generation-result.json";
    retrieval_index_result?: "project-memory-retrieval-index-result.json";
  };
  degraded_reason?: string;
};

export interface ProjectMemoryPostApplyRetrievalLifecycle {
  afterProjectMemoryApply(input: {
    projectKey: string;
    mode: ProjectMemoryCuratorMode;
    run: ProjectCuratorRunPaths;
    apply: ProjectMemoryApplyResult;
    now: Date;
    provider?: RunProjectMemoryCuratorInput["provider"];
    modelOverride?: string;
    env?: NodeJS.ProcessEnv;
    runner?: RunProjectMemoryCuratorInput["runner"];
  }): Promise<ProjectMemoryPostApplyRetrievalLifecycleResult>;
}

export type ProjectMemoryCuratorServiceDependencies = {
  retrievalLifecycle?: ProjectMemoryPostApplyRetrievalLifecycle;
};
