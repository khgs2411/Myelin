export type ProjectLearnProgressStage =
  | "command"
  | "preflight"
  | "schema"
  | "packet"
  | "planner"
  | "subject_writers"
  | "index_finalizer"
  | "maintenance"
  | "canonical_promotion"
  | "retrieval_indexing"
  | "run";

export type ProjectLearnProgressEvent = {
  project_key: string;
  stage: ProjectLearnProgressStage;
  status: "started" | "progress" | "completed" | "failed";
  message?: string;
  current?: number;
  total?: number;
  mode?: "create" | "maintain";
  run_dir?: string;
};

export type ProjectLearnProgressSink = (event: ProjectLearnProgressEvent) => void;

export function emitProjectLearnProgress(
  sink: ProjectLearnProgressSink | undefined,
  event: ProjectLearnProgressEvent,
): void {
  sink?.(event);
}
