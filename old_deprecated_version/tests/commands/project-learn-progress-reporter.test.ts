import { expect, test } from "bun:test";
import { createProjectLearnProgressReporter } from "../../src/commands/project-learn-progress-reporter.ts";

test("emits stable line progress and heartbeats for non-TTY logs", async () => {
  const chunks: string[] = [];
  const report = createProjectLearnProgressReporter({
    stream: { isTTY: false, write: (chunk) => chunks.push(chunk) },
    heartbeatMs: 10,
  });

  report({ project_key: "demo", stage: "planner", status: "started", message: "discovering subjects" });
  await new Promise((resolve) => setTimeout(resolve, 25));
  report({ project_key: "demo", stage: "planner", status: "completed" });

  const output = chunks.join("");
  expect(output).toContain("[myelin] start planner");
  expect(output).toContain("[myelin] active planner");
  expect(output).toContain("[myelin] completed planner");
});

test("renders real nested counts on one updating TTY line", () => {
  const chunks: string[] = [];
  const report = createProjectLearnProgressReporter({
    stream: { isTTY: true, write: (chunk) => chunks.push(chunk) },
  });

  report({ project_key: "demo", stage: "subject_writers", status: "started", current: 0, total: 7 });
  report({ project_key: "demo", stage: "subject_writers", status: "progress", current: 3, total: 7 });
  report({ project_key: "demo", stage: "subject_writers", status: "completed", current: 7, total: 7 });

  const output = chunks.join("");
  expect(output).toContain("subject_writers 3/7");
  expect(output).toContain("\r\x1b[2K");
  expect(output).toContain("✓");
});
