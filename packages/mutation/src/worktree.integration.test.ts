import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GitDiffAnalysis } from "@maru/git";
import { afterEach, describe, expect, it } from "vitest";
import { createMutationWorktreeManager } from "./index.js";

const runGit = promisify(execFile);

describe("Git mutation worktree integration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  it("copies uncommitted content into a detached worktree without changing the developer file", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-git-mutation-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await runGit("git", ["init"], { cwd: root, windowsHide: true });
    await runGit("git", ["config", "user.email", "mutation@example.invalid"], {
      cwd: root,
      windowsHide: true,
    });
    await runGit("git", ["config", "user.name", "MaruCheck Mutation Test"], {
      cwd: root,
      windowsHide: true,
    });
    await writeFile(join(root, "src", "access.ts"), "export const allowed = false;\n", "utf8");
    await runGit("git", ["add", "src/access.ts"], { cwd: root, windowsHide: true });
    await runGit("git", ["commit", "-m", "fixture"], { cwd: root, windowsHide: true });
    const workingSource = "export const allowed = true;\n";
    await writeFile(join(root, "src", "access.ts"), workingSource, "utf8");
    const analysis: GitDiffAnalysis = {
      clean: false,
      files: [
        {
          additions: 1,
          binary: false,
          classifications: ["authorization"],
          deletions: 1,
          hunks: [],
          path: "src/access.ts",
          status: "modified",
          symbols: [],
        },
      ],
      summary: { additions: 1, changedFiles: 1, deletions: 1 },
    };

    const worktree = await createMutationWorktreeManager().create(root, analysis);

    await expect(readFile(join(worktree.path, "src", "access.ts"), "utf8")).resolves.toBe(
      workingSource,
    );
    await expect(readFile(join(root, "src", "access.ts"), "utf8")).resolves.toBe(workingSource);
    const worktreePath = worktree.path;
    await worktree.cleanup();

    const listed = await runGit("git", ["worktree", "list", "--porcelain"], {
      cwd: root,
      windowsHide: true,
    });
    expect(listed.stdout).not.toContain(worktreePath);
    await expect(readFile(join(root, "src", "access.ts"), "utf8")).resolves.toBe(workingSource);
  });
});
