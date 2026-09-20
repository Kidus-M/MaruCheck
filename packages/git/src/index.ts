import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type SourceControlProvider = "github" | "other";

export interface RepositoryReference {
  readonly provider: SourceControlProvider;
  readonly rootDirectory: string;
}

export type GitFileStatus =
  | "added"
  | "conflicted"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "unchanged"
  | "untracked";

export interface GitChangedFile {
  readonly indexStatus: GitFileStatus;
  readonly originalPath?: string;
  readonly path: string;
  readonly worktreeStatus: GitFileStatus;
}

export interface WorkingTreeAnalysis {
  readonly clean: boolean;
  readonly files: readonly GitChangedFile[];
  readonly summary: {
    readonly added: number;
    readonly conflicted: number;
    readonly deleted: number;
    readonly modified: number;
    readonly renamed: number;
    readonly untracked: number;
  };
}

export interface GitRunner {
  readonly run: (args: readonly string[], cwd: string) => Promise<string>;
}

export class GitAnalysisError extends Error {
  public readonly code = "GIT_ANALYSIS_FAILED";
  public readonly remediation =
    "Confirm this directory is a readable Git repository and Git is installed.";

  public constructor(options?: ErrorOptions) {
    super("Unable to inspect the Git working tree.", options);
    this.name = "GitAnalysisError";
  }
}

const runExecFile = promisify(execFile);

export const defaultGitRunner: GitRunner = {
  async run(args, cwd) {
    const result = await runExecFile("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
    });
    return result.stdout;
  },
};

function status(code: string): GitFileStatus {
  if (code === " " || code.length === 0) return "unchanged";
  if (code === "?") return "untracked";
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "M") return "modified";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  return "conflicted";
}

/** Parse `git status --porcelain=v1 -z` without interpreting paths as shell input. */
export function parsePorcelainStatus(output: string): GitChangedFile[] {
  const records = output.split("\0");
  const files: GitChangedFile[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length === 0) continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new GitAnalysisError();
    }
    const indexCode = record[0]!;
    const worktreeCode = record[1]!;
    const path = record.slice(3).replaceAll("\\", "/");
    const isRename = indexCode === "R" || indexCode === "C";
    const original = isRename ? records[index + 1] : undefined;
    if (isRename) index += 1;
    files.push({
      indexStatus: indexCode === "?" && worktreeCode === "?" ? "untracked" : status(indexCode),
      path,
      worktreeStatus:
        indexCode === "?" && worktreeCode === "?" ? "untracked" : status(worktreeCode),
      ...(original === undefined ? {} : { originalPath: original.replaceAll("\\", "/") }),
    });
  }

  return files;
}

function category(file: GitChangedFile): keyof WorkingTreeAnalysis["summary"] {
  if (file.indexStatus === "conflicted" || file.worktreeStatus === "conflicted")
    return "conflicted";
  if (file.indexStatus === "untracked") return "untracked";
  if (file.indexStatus === "renamed" || file.worktreeStatus === "renamed") return "renamed";
  if (file.indexStatus === "deleted" || file.worktreeStatus === "deleted") return "deleted";
  if (file.indexStatus === "added" || file.worktreeStatus === "added") return "added";
  return "modified";
}

/** Inventory current staged, unstaged, and untracked files without reading file contents. */
export async function analyzeWorkingTree(
  root: string,
  runner: GitRunner = defaultGitRunner,
): Promise<WorkingTreeAnalysis> {
  try {
    const files = parsePorcelainStatus(
      await runner.run(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root),
    );
    const summary = {
      added: 0,
      conflicted: 0,
      deleted: 0,
      modified: 0,
      renamed: 0,
      untracked: 0,
    };
    for (const file of files) summary[category(file)] += 1;
    return { clean: files.length === 0, files, summary };
  } catch (error) {
    if (error instanceof GitAnalysisError) throw error;
    throw new GitAnalysisError({ cause: error });
  }
}

export { classifyChangedPath, type ChangeClassification } from "./classification.js";
export {
  analyzeGitDiff,
  parseUnifiedDiff,
  type GitChangeStatus,
  type GitDiffAnalysis,
  type GitDiffHunk,
  type GitFileChange,
  type ParsedGitFileDiff,
} from "./diff.js";
export { listPathHistory, parsePathHistory, type GitPathCommit } from "./history.js";
