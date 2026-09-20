import { GitAnalysisError, defaultGitRunner, type GitRunner } from "./index.js";

export interface GitPathCommit {
  readonly committedAt: string;
  readonly paths: readonly string[];
}

const RECORD_SEPARATOR = "\u001e";

/** Parse `git log --format=%x1e%cI --name-only` output into commits and the paths they touched. */
export function parsePathHistory(output: string): GitPathCommit[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((chunk) => chunk.split(/\r?\n/u).filter((line) => line.length > 0))
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const [committedAt, ...paths] = lines;
      if (committedAt === undefined || !Number.isFinite(Date.parse(committedAt))) {
        throw new GitAnalysisError();
      }
      return {
        committedAt: new Date(committedAt).toISOString(),
        paths: [...new Set(paths.map((path) => path.replaceAll("\\", "/")))].sort(),
      };
    });
}

/**
 * List commits after `since` that touched any of `paths`, without invoking a shell.
 * A repository without commits has no history and returns an empty list.
 */
export async function listPathHistory(
  root: string,
  paths: readonly string[],
  since: string,
  runner: GitRunner = defaultGitRunner,
): Promise<GitPathCommit[]> {
  if (paths.length === 0) return [];
  if (!Number.isFinite(Date.parse(since))) throw new GitAnalysisError();
  try {
    return parsePathHistory(
      await runner.run(
        [
          "-c",
          "core.quotePath=false",
          "log",
          `--since=${new Date(since).toISOString()}`,
          "--format=%x1e%cI",
          "--name-only",
          "--",
          ...paths,
        ],
        root,
      ),
    );
  } catch (error) {
    if (error instanceof GitAnalysisError) throw error;
    if (/does not have any commits yet/u.test(String((error as { stderr?: unknown }).stderr))) {
      return [];
    }
    throw new GitAnalysisError({ cause: error });
  }
}
