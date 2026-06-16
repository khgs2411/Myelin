import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectService } from "../../src/project/project-service.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-project-service-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("project service owns layout migration workflow", async () => {
  await mkdir(join(root, "projects", "demo"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "index.md"), "# Demo\n", "utf8");
  const service = new ProjectService(root);

  const result = await service.migrateLayout("demo");

  expect(result.projectActions.length).toBeGreaterThan(0);
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toBe("# Demo\n");
});
