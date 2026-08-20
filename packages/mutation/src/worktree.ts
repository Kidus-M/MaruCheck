import { performance } from "node:perf_hooks";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { defaultCommandRunner } from "@maru/execution";
import type { GitDiffAnalysis } from "@maru/git";
import {
  MutationVerificationError,
  type MutationCommandRunner,
  type MutationWorktree,
  type MutationWorktreeManager,
} from "./model.js";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function inside(root: string, path: string): string {
  if (isAbsolute(path)) {
    throw new MutationVerificationError(
      "MUTATION_PATH_INVALID",
      `Mutation path must be relative: ${path}`,
      "Recreate the Git diff without paths outside the repository.",
    );
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target === absoluteRoot || !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new MutationVerificationError(
      "MUTATION_PATH_INVALID",
      `Mutation path escapes the repository: ${path}`,
      "Recreate the Git diff without paths outside the repository.",
    );
  }
  return target;
}

async function copyWorkingChanges(
  root: string,
  worktree: string,
  analysis: GitDiffAnalysis,
): Promise<void> {
  for (const file of analysis.files) {
    if (file.originalPath !== undefined && file.originalPath !== file.path) {
      await rm(inside(worktree, file.originalPath), { force: true });
    }
    const target = inside(worktree, file.path);
    if (file.status === "deleted") {
      await rm(target, { force: true });
      continue;
    }
    const source = inside(root, file.path);
    const stats = await lstat(source);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new MutationVerificationError(
        "MUTATION_SOURCE_UNSUPPORTED",
        `Changed path is not a regular file: ${file.path}`,
        "Use regular repository files as mutation targets.",
      );
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

function assertTemporaryParent(path: string): void {
  const temporaryRoot = resolve(tmpdir());
  const absolute = resolve(path);
  if (
    !absolute.startsWith(`${temporaryRoot}${sep}`) ||
    !basename(absolute).startsWith("maru-mutation-")
  ) {
    throw new MutationVerificationError(
      "MUTATION_WORKTREE_UNSAFE",
      "Refusing to clean an unexpected mutation worktree path.",
      "Remove the unexpected path manually after confirming it is safe.",
    );
  }
}

export const defaultMutationCommandRunner: MutationCommandRunner = {
  async run(args, cwd) {
    const started = performance.now();
    const result = await defaultCommandRunner.run({
      args,
      command: "git",
      cwd,
      env: { GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: 30_000,
    });
    return {
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  },
};

/** Create detached Git worktrees that mirror current uncommitted file content and always clean up. */
export function createMutationWorktreeManager(
  runner: MutationCommandRunner = defaultMutationCommandRunner,
): MutationWorktreeManager {
  return {
    async create(root, analysis): Promise<MutationWorktree> {
      const parent = await mkdtemp(join(tmpdir(), "maru-mutation-"));
      const worktree = resolve(parent, "worktree");
      let registered = false;
      try {
        const added = await runner.run(["worktree", "add", "--detach", worktree, "HEAD"], root);
        if (added.exitCode !== 0) {
          throw new MutationVerificationError(
            "MUTATION_WORKTREE_CREATE_FAILED",
            "Git could not create the isolated mutation worktree.",
            `Inspect Git worktree state and retry. ${added.stderr.trim()}`.trim(),
          );
        }
        registered = true;
        await copyWorkingChanges(root, worktree, analysis);

        const dependencies = resolve(root, "node_modules");
        const worktreeDependencies = resolve(worktree, "node_modules");
        if ((await exists(dependencies)) && !(await exists(worktreeDependencies))) {
          await symlink(
            dependencies,
            worktreeDependencies,
            process.platform === "win32" ? "junction" : "dir",
          );
        }

        let cleaned = false;
        return {
          path: worktree,
          async cleanup() {
            if (cleaned) return;
            cleaned = true;
            assertTemporaryParent(parent);
            const removed = await runner.run(["worktree", "remove", "--force", worktree], root);
            await rm(parent, { force: true, recursive: true });
            if (removed.exitCode !== 0) {
              await runner.run(["worktree", "prune"], root);
              throw new MutationVerificationError(
                "MUTATION_WORKTREE_CLEANUP_FAILED",
                "The temporary files were removed, but Git could not unregister the mutation worktree.",
                `Run git worktree prune in ${root}. ${removed.stderr.trim()}`.trim(),
              );
            }
          },
        };
      } catch (error) {
        assertTemporaryParent(parent);
        if (registered) await runner.run(["worktree", "remove", "--force", worktree], root);
        await rm(parent, { force: true, recursive: true });
        if (error instanceof MutationVerificationError) throw error;
        throw new MutationVerificationError(
          "MUTATION_WORKTREE_CREATE_FAILED",
          "Unable to prepare the isolated mutation worktree.",
          "Confirm Git can create worktrees and the system temporary directory is writable.",
          { cause: error },
        );
      }
    },
  };
}

export function relativeMutationPath(root: string, path: string): string {
  return relative(resolve(root), resolve(path)).split(sep).join("/");
}
