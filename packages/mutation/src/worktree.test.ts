import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GitDiffAnalysis } from "@maru/git";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMutationWorktreeManager, type MutationCommandRunner } from "./index.js";

describe("temporary mutation worktree", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  it("materializes current uncommitted content and unregisters the detached worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-worktree-root-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "src", "access.ts"), "current working content\n", "utf8");
    const runner: MutationCommandRunner = {
      run: vi.fn().mockImplementation(async (args: readonly string[]) => {
        if (args[0] === "worktree" && args[1] === "add") {
          const target = args[3]!;
          await mkdir(dirname(join(target, "src", "access.ts")), { recursive: true });
          await writeFile(join(target, "src", "access.ts"), "HEAD content\n", "utf8");
        }
        return { durationMs: 1, exitCode: 0, stderr: "", stdout: "" };
      }),
    };
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

    const worktree = await createMutationWorktreeManager(runner).create(root, analysis);

    await expect(readFile(join(worktree.path, "src", "access.ts"), "utf8")).resolves.toBe(
      "current working content\n",
    );
    await expect(access(join(worktree.path, "node_modules"))).resolves.toBeUndefined();
    await worktree.cleanup();
    await expect(access(worktree.path)).rejects.toThrow();
    expect(runner.run).toHaveBeenCalledWith(["worktree", "remove", "--force", worktree.path], root);
    await expect(readFile(join(root, "src", "access.ts"), "utf8")).resolves.toBe(
      "current working content\n",
    );
  });

  it("cleans the temporary directory when Git rejects worktree creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-worktree-error-root-"));
    temporaryDirectories.push(root);
    const runner: MutationCommandRunner = {
      run: vi.fn().mockResolvedValue({
        durationMs: 2,
        exitCode: 128,
        stderr: "fatal: not a git repository",
        stdout: "",
      }),
    };

    await expect(
      createMutationWorktreeManager(runner).create(root, analysisFixture()),
    ).rejects.toMatchObject({
      code: "MUTATION_WORKTREE_CREATE_FAILED",
      remediation: expect.stringContaining("Git worktree"),
    });
  });

  it("removes temporary files and requests a prune when unregistering fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-worktree-cleanup-root-"));
    temporaryDirectories.push(root);
    const runner: MutationCommandRunner = {
      run: vi.fn().mockImplementation(async (args: readonly string[]) => {
        if (args[0] === "worktree" && args[1] === "add") {
          await mkdir(args[3]!, { recursive: true });
          return { durationMs: 1, exitCode: 0, stderr: "", stdout: "" };
        }
        if (args[0] === "worktree" && args[1] === "remove") {
          return { durationMs: 1, exitCode: 1, stderr: "registration locked", stdout: "" };
        }
        return { durationMs: 1, exitCode: 0, stderr: "", stdout: "" };
      }),
    };
    const worktree = await createMutationWorktreeManager(runner).create(root, analysisFixture());

    await expect(worktree.cleanup()).rejects.toMatchObject({
      code: "MUTATION_WORKTREE_CLEANUP_FAILED",
      remediation: expect.stringContaining("git worktree prune"),
    });
    await expect(access(worktree.path)).rejects.toThrow();
    expect(runner.run).toHaveBeenCalledWith(["worktree", "prune"], root);
  });
});

function analysisFixture(): GitDiffAnalysis {
  return {
    clean: true,
    files: [],
    summary: { additions: 0, changedFiles: 0, deletions: 0 },
  };
}
