#!/usr/bin/env bun

import { AutoProjectMemoryMaintenanceService } from "./auto-project-memory-maintenance.ts";
import { repoRoot } from "../runtime/fs.ts";

const projectKey = process.argv[2];
if (!projectKey) {
  console.error("Usage: bun src/maintenance/project-memory-worker.ts <project-key>");
  process.exit(1);
}

const root = process.env.MYELIN_ROOT ?? repoRoot().root;
const result = await new AutoProjectMemoryMaintenanceService(root).run(projectKey);

if (result.status === "failed") {
  console.error(result.error_message ?? "Auto Project Memory maintenance failed.");
  process.exit(1);
}

console.log(
  `Auto Project Memory maintenance ${result.run_id} completed for ${result.project_key}: ` +
    `${result.changed_files.length} changed files, ` +
    `${result.counts_after.pending_inbox_items} pending inbox items, ` +
    `${result.counts_after.pending_project_candidates} pending project candidates.`,
);
