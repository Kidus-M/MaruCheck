import { cp, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { runVerificationPlan, type VerificationRunResult } from "@maru/execution";
import { analyzeGitDiff, type GitDiffAnalysis } from "@maru/git";
import { createAndWriteVerificationPlan, type VerificationPlan } from "@maru/planner";
import {
  MUTATION_ARTIFACTS_DIRECTORY,
  MUTATION_REPORT_SCHEMA_VERSION,
  MutationVerificationError,
  type MutationBaseline,
  type MutationCandidate,
  type MutationExecution,
  type MutationReport,
  type MutationReportResult,
  type RunMutationVerificationOptions,
} from "./model.js";
import { applyMutation, discoverTypeScriptMutations, MutationError } from "./transforms.js";
import { createMutationWorktreeManager, relativeMutationPath } from "./worktree.js";

export * from "./model.js";
export * from "./transforms.js";
export * from "./worktree.js";

const DEFAULT_MAX_MUTATIONS = 20;
const MAX_MUTATIONS = 100;
const MAX_SOURCE_CHARACTERS = 2_000_000;
const MAX_REPORTED_TEXT = 500;
const MUTATION_TEST_ADAPTERS = new Set(["axe", "jest", "playwright", "vitest"]);

function portableTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/gu, "-");
}

function resolveInside(root: string, path: string): string {
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

function bounded(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= MAX_REPORTED_TEXT
    ? normalized
    : `${normalized.slice(0, MAX_REPORTED_TEXT - 1)}…`;
}

function publicCandidate(candidate: MutationCandidate): MutationExecution["candidate"] {
  return {
    column: candidate.column,
    description: bounded(candidate.description),
    file: candidate.file,
    id: candidate.id,
    kind: candidate.kind,
    line: candidate.line,
    original: bounded(candidate.original),
    replacement: bounded(candidate.replacement),
  };
}

function mutationPlan(plan: VerificationPlan): VerificationPlan {
  const steps = plan.steps.filter((step) => MUTATION_TEST_ADAPTERS.has(step.adapter));
  return {
    ...plan,
    steps,
    summary: {
      ...plan.summary,
      automatedSteps: steps.filter((step) => step.execution === "automated").length,
      manualSteps: 0,
      unavailableSteps: 0,
    },
  };
}

async function discoverCandidates(
  root: string,
  analysis: GitDiffAnalysis,
  maximum: number,
): Promise<{ candidates: MutationCandidate[]; sourceByFile: Map<string, string> }> {
  const sourceByFile = new Map<string, string>();
  const candidates: MutationCandidate[] = [];
  for (const file of analysis.files) {
    if (
      file.binary ||
      file.status === "deleted" ||
      file.classifications.includes("test") ||
      !/\.(?:ts|tsx)$/u.test(file.path) ||
      /\.d\.ts$/u.test(file.path)
    ) {
      continue;
    }
    const source = await readFile(resolveInside(root, file.path), "utf8");
    if (source.length > MAX_SOURCE_CHARACTERS) continue;
    sourceByFile.set(file.path, source);
    for (const candidate of discoverTypeScriptMutations(file.path, source)) {
      if (candidates.length >= maximum) break;
      candidates.push({
        ...candidate,
        id: `MUT-${String(candidates.length + 1).padStart(4, "0")}`,
      });
    }
    if (candidates.length >= maximum) break;
  }
  return { candidates, sourceByFile };
}

function resultStatuses(run: VerificationRunResult): MutationExecution["resultStatuses"] {
  return run.run.results.map((result) => result.status);
}

function runDuration(run: VerificationRunResult): number {
  return run.run.results.reduce((total, result) => total + result.durationMs, 0);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function archiveRun(
  originalRoot: string,
  worktreeRoot: string,
  reportDirectory: string,
  name: string,
  run: VerificationRunResult,
): Promise<string[]> {
  const source = resolveInside(worktreeRoot, run.run.artifactDirectory);
  if (!(await pathExists(source))) return [];
  const target = resolve(reportDirectory, "runs", name);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  return [relativeMutationPath(originalRoot, target)];
}

async function createReportDirectory(root: string, now: Date): Promise<string> {
  const parent = resolve(root, MUTATION_ARTIFACTS_DIRECTORY);
  await mkdir(parent, { recursive: true });
  const base = portableTimestamp(now);
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${String(attempt).padStart(2, "0")}`;
    const candidate = resolve(parent, `${base}${suffix}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new MutationVerificationError(
    "MUTATION_ARTIFACT_DIRECTORY_UNAVAILABLE",
    "Unable to allocate a unique mutation artifact directory.",
    "Retry mutation verification with a new timestamp.",
  );
}

function baselineFromRun(
  run: VerificationRunResult,
  artifactRefs: readonly string[],
): MutationBaseline {
  return {
    artifactRefs,
    resultStatuses: resultStatuses(run),
    status: run.run.status === "passed" ? "passed" : "inconclusive",
    ...(run.run.status === "passed"
      ? {}
      : { diagnostic: `Baseline verification returned ${run.run.status}.` }),
  };
}

function gateFor(
  baseline: MutationBaseline,
  mutations: readonly MutationExecution[],
  candidateCount: number,
): MutationReport["gate"] {
  if (candidateCount === 0) {
    return {
      reasons: ["No supported TypeScript mutation candidate was found in the current diff."],
      status: "blocked",
    };
  }
  if (baseline.status !== "passed") {
    return {
      reasons: ["Baseline verification did not pass, so mutant outcomes would not be trustworthy."],
      status: "blocked",
    };
  }
  const survived = mutations.filter((mutation) => mutation.outcome === "survived").length;
  const inconclusive = mutations.filter((mutation) => mutation.outcome === "inconclusive").length;
  if (survived > 0 || inconclusive > 0) {
    return {
      reasons: [
        ...(survived > 0
          ? [`${survived} mutation${survived === 1 ? "" : "s"} survived selected tests.`]
          : []),
        ...(inconclusive > 0
          ? [`${inconclusive} mutation${inconclusive === 1 ? " was" : "s were"} inconclusive.`]
          : []),
      ],
      status: "blocked",
    };
  }
  return {
    reasons: [`All ${mutations.length} executed mutations were killed by selected tests.`],
    status: "passed",
  };
}

async function writeReport(
  root: string,
  reportDirectory: string,
  report: MutationReport,
): Promise<MutationReportResult> {
  const path = resolve(reportDirectory, "report.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { path: relativeMutationPath(root, path), report };
}

/** Run one mutation at a time against a passing baseline in a detached temporary Git worktree. */
export async function runMutationVerification(
  root: string,
  now = new Date(),
  options: RunMutationVerificationOptions = {},
): Promise<MutationReportResult> {
  const clock = options.now ?? (() => new Date());
  const maximum = options.maxMutations ?? DEFAULT_MAX_MUTATIONS;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_MUTATIONS) {
    throw new MutationVerificationError(
      "MUTATION_LIMIT_INVALID",
      `Mutation limit must be an integer from 1 to ${MAX_MUTATIONS}.`,
      "Pass --max with a value between 1 and 100.",
    );
  }

  const [analysis, planned] = await Promise.all([
    options.analysis?.() ?? analyzeGitDiff(root),
    options.createPlan?.() ?? createAndWriteVerificationPlan(root, now),
  ]);
  const { candidates, sourceByFile } = await discoverCandidates(root, analysis, maximum);
  const plan = mutationPlan(planned.plan);
  const reportDirectory = await createReportDirectory(root, now);

  const emptyBaseline: MutationBaseline = {
    artifactRefs: [],
    diagnostic:
      candidates.length === 0
        ? "No mutation candidate was available."
        : "No Vitest, Playwright, or axe verification step was selected.",
    resultStatuses: [],
    status: "inconclusive",
  };
  if (candidates.length === 0 || plan.steps.length === 0) {
    const completedAt = clock().toISOString();
    const report: MutationReport = {
      baseline: emptyBaseline,
      completedAt,
      generatedAt: now.toISOString(),
      gate: gateFor(emptyBaseline, [], candidates.length),
      mutations: [],
      project: { name: planned.plan.project.name },
      schemaVersion: MUTATION_REPORT_SCHEMA_VERSION,
      scope: "working-tree",
      summary: {
        candidates: candidates.length,
        executed: 0,
        inconclusive: 0,
        killed: 0,
        survived: 0,
      },
      worktreeCleaned: true,
    };
    return writeReport(root, reportDirectory, report);
  }

  const worktree = await (options.worktrees ?? createMutationWorktreeManager()).create(
    root,
    analysis,
  );
  const runPlan =
    options.runPlan ??
    ((worktreeRoot: string, verificationPlan: VerificationPlan) =>
      runVerificationPlan(worktreeRoot, verificationPlan, { now: clock }));
  let baseline: MutationBaseline;
  const executions: MutationExecution[] = [];
  try {
    try {
      const run = await runPlan(worktree.path, plan);
      baseline = baselineFromRun(
        run,
        await archiveRun(root, worktree.path, reportDirectory, "baseline", run),
      );
    } catch (error) {
      baseline = {
        artifactRefs: [],
        diagnostic: bounded(error instanceof Error ? error.message : String(error)),
        resultStatuses: [],
        status: "inconclusive",
      };
    }

    if (baseline.status === "passed") {
      for (const candidate of candidates) {
        const source = sourceByFile.get(candidate.file);
        if (source === undefined) continue;
        const target = resolveInside(worktree.path, candidate.file);
        const started = performance.now();
        try {
          await writeFile(target, applyMutation(source, candidate), "utf8");
          const run = await runPlan(worktree.path, plan);
          const statuses = resultStatuses(run);
          const outcome =
            run.run.status === "passed"
              ? "survived"
              : statuses.some(
                    (status) =>
                      status === "error" || status === "skipped" || status === "unavailable",
                  )
                ? "inconclusive"
                : statuses.some((status) => status === "failed")
                  ? "killed"
                  : "inconclusive";
          executions.push({
            artifactRefs: await archiveRun(root, worktree.path, reportDirectory, candidate.id, run),
            candidate: publicCandidate(candidate),
            durationMs: runDuration(run),
            outcome,
            resultStatuses: statuses,
          });
        } catch (error) {
          if (error instanceof MutationError) throw error;
          executions.push({
            artifactRefs: [],
            candidate: publicCandidate(candidate),
            diagnostic: bounded(error instanceof Error ? error.message : String(error)),
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            outcome: "inconclusive",
            resultStatuses: [],
          });
        } finally {
          await writeFile(target, source, "utf8");
        }
      }
    }
  } finally {
    await worktree.cleanup();
  }

  const gate = gateFor(baseline, executions, candidates.length);
  const report: MutationReport = {
    baseline,
    completedAt: clock().toISOString(),
    generatedAt: now.toISOString(),
    gate,
    mutations: executions,
    project: { name: planned.plan.project.name },
    schemaVersion: MUTATION_REPORT_SCHEMA_VERSION,
    scope: "working-tree",
    summary: {
      candidates: candidates.length,
      executed: executions.length,
      inconclusive: executions.filter((execution) => execution.outcome === "inconclusive").length,
      killed: executions.filter((execution) => execution.outcome === "killed").length,
      survived: executions.filter((execution) => execution.outcome === "survived").length,
    },
    worktreeCleaned: true,
  };
  return writeReport(root, reportDirectory, report);
}

export function formatMutationReport(result: MutationReportResult): string {
  const { report } = result;
  const lines = [
    `Mutation gate: ${report.gate.status.toUpperCase()}`,
    `Candidates: ${report.summary.candidates}`,
    `Executed: ${report.summary.executed}`,
    `Killed: ${report.summary.killed}`,
    `Survived: ${report.summary.survived}`,
    `Inconclusive: ${report.summary.inconclusive}`,
    `Worktree cleaned: ${report.worktreeCleaned ? "yes" : "no"}`,
  ];
  for (const mutation of report.mutations.filter((item) => item.outcome === "survived")) {
    lines.push(
      "",
      "WEAK VERIFICATION DETECTED",
      `${mutation.candidate.id} ${mutation.candidate.file}:${mutation.candidate.line}:${mutation.candidate.column}`,
      `Mutation: ${mutation.candidate.description}`,
      "Result: All selected tests still passed.",
      "Meaning: Existing verification does not prove this behavior.",
    );
  }
  lines.push("", ...report.gate.reasons.map((reason) => `Gate: ${reason}`));
  lines.push(`JSON report: ${result.path}`);
  return lines.join("\n");
}
