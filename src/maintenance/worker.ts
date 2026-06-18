#!/usr/bin/env bun

import { AutoMemoryMaintenanceService } from "./auto-memory-maintenance.ts";
import { repoRoot } from "../runtime/fs.ts";

const projectKey = process.argv[2];
if (!projectKey) {
  console.error("Usage: bun src/maintenance/worker.ts <project-key>");
  process.exit(1);
}

const root = process.env.MYELIN_ROOT ?? repoRoot().root;
const result = await new AutoMemoryMaintenanceService(root).run(projectKey);

if (result.status === "failed") {
  console.error(result.error_message ?? "Auto memory maintenance failed.");
  process.exit(1);
}

console.log(
  `Auto memory maintenance ${result.run_id} completed for ${result.project_key}: ` +
    `${result.indexed} indexed, ${result.index_failed} failed, ${result.pending_remaining} pending.`,
);
