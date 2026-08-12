import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRepositoryIdentityClaims,
  collectProjectRepositoryIdentity,
} from "../../src/project/project-repository-identity.ts";

test("marks a documented no-remote claim contradictory when the checkout has an origin", async () => {
  const repo = await mkdtemp(join(tmpdir(), "myelin-repository-identity-"));
  await runGit(repo, ["init"]);
  await runGit(repo, ["config", "user.email", "test@example.com"]);
  await runGit(repo, ["config", "user.name", "Myelin Test"]);
  await runGit(repo, ["remote", "add", "origin", "https://user:credential@example.com/org/repo.git"]);
  await mkdir(join(repo, "docs"), { recursive: true });
  const claimPath = join(repo, "docs", "repository.md");
  await writeFile(claimPath, "# Repository\n\nThis is a local-only documentation repository with no remote.\n", "utf8");
  await runGit(repo, ["add", "docs/repository.md"]);
  await runGit(repo, ["commit", "-m", "docs: seed repository claim"]);

  const identity = await collectProjectRepositoryIdentity("demo", repo);

  expect(identity.status).toBe("available");
  expect(identity.remotes).toEqual([{ name: "origin", urls: ["https://example.com/org/repo.git"] }]);
  expect(identity.head_commit).toMatch(/^[a-f0-9]{40}$/);
  await expect(assertRepositoryIdentityClaims(join(repo, "docs"), identity))
    .rejects.toThrow("repository identity contradiction must be labeled");

  await writeFile(
    claimPath,
    "# Repository\n\nThe older document called this a local-only repository with no remote; that claim is stale and contradicted by the live origin metadata.\n",
    "utf8",
  );
  await expect(assertRepositoryIdentityClaims(join(repo, "docs"), identity)).resolves.toBeUndefined();

  await writeFile(
    claimPath,
    "# Repository\n\n- The local-only repository claim conflicts with deterministic checkout evidence and needs ownership/configuration review.\n",
    "utf8",
  );
  await expect(assertRepositoryIdentityClaims(join(repo, "docs"), identity)).resolves.toBeUndefined();
});

async function runGit(cwd: string, args: string[]): Promise<void> {
  const process = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(await new Response(process.stderr).text());
}
