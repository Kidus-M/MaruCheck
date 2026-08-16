import {
  GitAnalysisError,
  analyzeWorkingTree,
  defaultGitRunner,
  type GitChangedFile,
  type GitFileStatus,
  type GitRunner,
} from "./index.js";
import { classifyChangedPath, type ChangeClassification } from "./classification.js";

export type GitChangeStatus = Exclude<GitFileStatus, "unchanged">;

export interface GitDiffHunk {
  readonly context?: string;
  readonly newLines: number;
  readonly newStart: number;
  readonly oldLines: number;
  readonly oldStart: number;
}

export interface ParsedGitFileDiff {
  readonly additions: number;
  readonly binary: boolean;
  readonly deletions: number;
  readonly hunks: readonly GitDiffHunk[];
  readonly originalPath?: string;
  readonly path: string;
  readonly status: GitChangeStatus;
  readonly symbols: readonly string[];
}

export interface GitFileChange extends ParsedGitFileDiff {
  readonly classifications: readonly ChangeClassification[];
}

export interface GitDiffAnalysis {
  readonly clean: boolean;
  readonly files: readonly GitFileChange[];
  readonly summary: {
    readonly additions: number;
    readonly changedFiles: number;
    readonly deletions: number;
  };
}

interface MutableFileDiff {
  additions: number;
  binary: boolean;
  deletions: number;
  hunks: GitDiffHunk[];
  originalPath?: string;
  path?: string;
  status: GitChangeStatus;
  symbols: Set<string>;
}

const DIFF_ARGS = ["--no-ext-diff", "--no-color", "--unified=0", "--find-renames", "--"] as const;

function portable(path: string): string {
  return path.replaceAll("\\", "/");
}

function decodeGitPath(raw: string): string | undefined {
  const value = raw.split("\t", 1)[0]!.trim();
  if (value === "/dev/null") return undefined;
  let decoded = value;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      decoded = JSON.parse(value) as string;
    } catch {
      throw new GitAnalysisError();
    }
  }
  return portable(decoded.replace(/^[ab]\//u, ""));
}

function pathFromDiffHeader(line: string): { originalPath?: string; path?: string } {
  const match = /^diff --git (.+) (.+)$/u.exec(line);
  if (match === null) throw new GitAnalysisError();
  return { originalPath: decodeGitPath(match[1]!), path: decodeGitPath(match[2]!) };
}

function symbolFromLine(line: string): string | undefined {
  const patterns = [
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/u,
    /\bclass\s+([A-Za-z_$][\w$]*)/u,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/u,
    /\bdef\s+([A-Za-z_]\w*)/u,
    /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function finalize(file: MutableFileDiff | undefined): ParsedGitFileDiff | undefined {
  if (file?.path === undefined) return undefined;
  return {
    additions: file.additions,
    binary: file.binary,
    deletions: file.deletions,
    hunks: file.hunks,
    ...(file.originalPath === undefined ? {} : { originalPath: file.originalPath }),
    path: file.path,
    status: file.status,
    symbols: [...file.symbols].sort(),
  };
}

/** Parse unified Git patch text into bounded metadata without retaining changed source lines. */
export function parseUnifiedDiff(output: string): ParsedGitFileDiff[] {
  const results: ParsedGitFileDiff[] = [];
  let current: MutableFileDiff | undefined;

  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      const completed = finalize(current);
      if (completed !== undefined) results.push(completed);
      const paths = pathFromDiffHeader(line);
      current = {
        additions: 0,
        binary: false,
        deletions: 0,
        hunks: [],
        ...paths,
        status: "modified",
        symbols: new Set<string>(),
      };
      continue;
    }
    if (current === undefined) continue;
    if (line.startsWith("new file mode ")) current.status = "added";
    else if (line.startsWith("deleted file mode ")) current.status = "deleted";
    else if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.originalPath = decodeGitPath(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = decodeGitPath(line.slice("rename to ".length));
    } else if (line.startsWith("copy from ")) {
      current.status = "copied";
      current.originalPath = decodeGitPath(line.slice("copy from ".length));
    } else if (line.startsWith("copy to ")) {
      current.status = "copied";
      current.path = decodeGitPath(line.slice("copy to ".length));
    } else if (line.startsWith("--- ")) {
      current.originalPath = decodeGitPath(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      current.path = decodeGitPath(line.slice(4));
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
    } else if (line.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:\s?(.*))?$/u.exec(line);
      if (match === null) throw new GitAnalysisError();
      const context = match[5]?.trim();
      current.hunks.push({
        ...(context === undefined || context.length === 0 ? {} : { context }),
        newLines: Number(match[4] ?? "1"),
        newStart: Number(match[3]),
        oldLines: Number(match[2] ?? "1"),
        oldStart: Number(match[1]),
      });
      const symbol = context === undefined ? undefined : symbolFromLine(context);
      if (symbol !== undefined) current.symbols.add(symbol);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
      const symbol = symbolFromLine(line.slice(1));
      if (symbol !== undefined) current.symbols.add(symbol);
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
      const symbol = symbolFromLine(line.slice(1));
      if (symbol !== undefined) current.symbols.add(symbol);
    }
  }

  const completed = finalize(current);
  if (completed !== undefined) results.push(completed);
  return results;
}

function statusFor(file: GitChangedFile): GitChangeStatus {
  const values = [file.indexStatus, file.worktreeStatus];
  const priority: readonly GitChangeStatus[] = [
    "conflicted",
    "untracked",
    "deleted",
    "renamed",
    "copied",
    "added",
    "modified",
  ];
  return priority.find((candidate) => values.includes(candidate)) ?? "modified";
}

function mergeFile(left: ParsedGitFileDiff, right: ParsedGitFileDiff): ParsedGitFileDiff {
  return {
    additions: left.additions + right.additions,
    binary: left.binary || right.binary,
    deletions: left.deletions + right.deletions,
    hunks: [...left.hunks, ...right.hunks],
    ...(right.originalPath === undefined && left.originalPath === undefined
      ? {}
      : { originalPath: right.originalPath ?? left.originalPath }),
    path: right.path,
    status: right.status === "modified" ? left.status : right.status,
    symbols: [...new Set([...left.symbols, ...right.symbols])].sort(),
  };
}

/** Analyze staged, unstaged, and untracked changes using Git directly without a shell. */
export async function analyzeGitDiff(
  root: string,
  runner: GitRunner = defaultGitRunner,
): Promise<GitDiffAnalysis> {
  try {
    const workingTree = await analyzeWorkingTree(root, runner);
    const [staged, unstaged] = await Promise.all([
      runner.run(["diff", "--cached", ...DIFF_ARGS], root),
      runner.run(["diff", ...DIFF_ARGS], root),
    ]);
    const files = new Map<string, ParsedGitFileDiff>();
    for (const parsed of [...parseUnifiedDiff(staged), ...parseUnifiedDiff(unstaged)]) {
      const existing = files.get(parsed.path);
      files.set(parsed.path, existing === undefined ? parsed : mergeFile(existing, parsed));
    }
    for (const changed of workingTree.files) {
      const existing = files.get(changed.path);
      const metadata: ParsedGitFileDiff = {
        additions: 0,
        binary: false,
        deletions: 0,
        hunks: [],
        ...(changed.originalPath === undefined ? {} : { originalPath: changed.originalPath }),
        path: changed.path,
        status: statusFor(changed),
        symbols: [],
      };
      files.set(
        changed.path,
        existing === undefined
          ? metadata
          : { ...existing, status: metadata.status, ...(metadata.originalPath === undefined ? {} : { originalPath: metadata.originalPath }) },
      );
    }

    const analyzed = [...files.values()]
      .map((file): GitFileChange => ({
        ...file,
        classifications: classifyChangedPath(file.path),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    return {
      clean: analyzed.length === 0,
      files: analyzed,
      summary: {
        additions: analyzed.reduce((total, file) => total + file.additions, 0),
        changedFiles: analyzed.length,
        deletions: analyzed.reduce((total, file) => total + file.deletions, 0),
      },
    };
  } catch (error) {
    if (error instanceof GitAnalysisError) throw error;
    throw new GitAnalysisError({ cause: error });
  }
}
