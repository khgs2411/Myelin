import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BootstrapService } from "../../src/bootstrap/bootstrap-service.ts";
import { readJson } from "../../src/runtime/json.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-bootstrap-service-"));
  repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("bootstrap service creates the project memory shell", async () => {
  const service = new BootstrapService(root);

  const result = await service.bootstrap({ projectKey: "class-kit", repoPath: repo });

  expect(result.projectKey).toBe("class-kit");
  expect(result.repoPath).toBe(resolve(repo));
  expect(result.created).toContain("projects/class-kit/state/project.json");
  expect(result.created).toContain("projects/class-kit/wiki/index.md");
  expect(await readFile(join(root, "projects", "class-kit", "wiki", "index.md"), "utf8")).toContain(
    "Project Memory has not been curated yet.",
  );
  expect(
    await readJson<{ key: string; name: string; repo_paths: string[] }>(
      join(root, "projects", "class-kit", "state", "project.json"),
    ),
  ).toEqual({
    key: "class-kit",
    name: "class-kit",
    repo_paths: [resolve(repo)],
  });
});
