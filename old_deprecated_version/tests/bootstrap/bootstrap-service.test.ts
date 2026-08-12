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
  expect(result.created).toContain("state/class-kit/project.json");
  expect(result.created).toContain("projects/class-kit/index.md");
  expect(result.created).not.toContain("projects/class-kit/schema");
  expect(result.created).toContain("sources/class-kit/inbox");
  expect(await Bun.file(join(root, "projects", "class-kit", "index.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, "projects", "class-kit", "schema")).exists()).toBe(false);
  expect(await readFile(join(root, "projects", "class-kit", "index.md"), "utf8")).toContain(
    "Project Memory has not been curated yet.",
  );
  expect(await Bun.file(join(root, "runs", "class-kit", "index.md")).exists()).toBe(false);
  expect(
    await readJson<{ key: string; name: string; repo_paths: string[] }>(
      join(root, "state", "class-kit", "project.json"),
    ),
  ).toEqual({
    key: "class-kit",
    name: "class-kit",
    repo_paths: [resolve(repo)],
  });
});
