import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  createAndWriteVerificationPlan,
  type VerificationAdapter,
  type VerificationPlan,
  type VerificationStep,
} from "@maru/planner";
import { defaultCommandRunner } from "./runner.js";
import {
  VERIFICATION_ARTIFACTS_DIRECTORY,
  VERIFICATION_RUN_SCHEMA_VERSION,
  type AdapterExecutionResult,
  type AutomatedVerificationAdapter,
  type CreateAndRunVerificationOptions,
  type GeneratedTestArtifact,
  type RunVerificationOptions,
  type TemporaryTest,
  type VerificationResultError,
  type VerificationResultStatus,
  type VerificationRun,
  type VerificationRunResult,
} from "./types.js";

export * from "./types.js";
export { defaultCommandRunner } from "./runner.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TEMPORARY_TEST_SOURCE_LENGTH = 100_000;
const REQUIREMENT_REFERENCE =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}#[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const TEMPORARY_TEST_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TEST_FILE = /\.(?:spec|test)\.(?:c|m)?(?:j|t)sx?$/u;

export class VerificationExecutionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VerificationExecutionError";
  }
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function relativePath(root: string, path: string): string {
  return portablePath(relative(resolve(root), resolve(path)));
}

function resolveInsideRoot(root: string, path: string): string {
  if (isAbsolute(path)) {
    throw new VerificationExecutionError(
      "TEMPORARY_TEST_INVALID",
      `Temporary test path must be relative: ${path}`,
      "Choose a new test path inside the project root.",
    );
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target === absoluteRoot || !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new VerificationExecutionError(
      "TEMPORARY_TEST_INVALID",
      `Temporary test path escapes the project root: ${path}`,
      "Choose a new test path inside the project root.",
    );
  }
  return target;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function createRunDirectory(root: string, now: Date): Promise<string> {
  const parent = resolve(root, VERIFICATION_ARTIFACTS_DIRECTORY);
  await mkdir(parent, { recursive: true });
  const base = now.toISOString().replace(/[:.]/gu, "-");
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
  throw new VerificationExecutionError(
    "RUN_DIRECTORY_UNAVAILABLE",
    "Unable to allocate a unique verification run directory.",
    "Retry the verification command with a new timestamp.",
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function taggedSource(test: TemporaryTest): string {
  return `// @maru-requirements ${test.requirementRefs.join(", ")}\n${test.source}`;
}

async function prepareTemporaryTests(
  root: string,
  runDirectory: string,
  tests: readonly TemporaryTest[],
): Promise<{ artifacts: GeneratedTestArtifact[]; createdPaths: string[] }> {
  const artifacts: GeneratedTestArtifact[] = [];
  const createdPaths: string[] = [];
  const generatedDirectory = resolve(runDirectory, "generated");
  if (tests.length > 0) await mkdir(generatedDirectory, { recursive: true });

  try {
    for (const test of tests) {
      if (!TEMPORARY_TEST_ID.test(test.id) || test.id.length > 80) {
        throw new VerificationExecutionError(
          "TEMPORARY_TEST_INVALID",
          `Temporary test id is invalid: ${test.id}`,
          "Use a lowercase kebab-case id no longer than 80 characters.",
        );
      }
      if (
        test.requirementRefs.length === 0 ||
        test.requirementRefs.length > 100 ||
        test.requirementRefs.some((reference) => !REQUIREMENT_REFERENCE.test(reference))
      ) {
        throw new VerificationExecutionError(
          "TEMPORARY_TEST_INVALID",
          `Temporary test requirement references are invalid: ${test.id}`,
          "Provide 1 to 100 references in contract-id#requirement-id form.",
        );
      }
      if (
        test.source.trim().length === 0 ||
        test.source.length > MAX_TEMPORARY_TEST_SOURCE_LENGTH
      ) {
        throw new VerificationExecutionError(
          "TEMPORARY_TEST_INVALID",
          `Temporary test source is empty or too large: ${test.id}`,
          "Provide non-empty test source no larger than 100,000 characters.",
        );
      }
      if (!TEST_FILE.test(test.targetPath)) {
        throw new VerificationExecutionError(
          "TEMPORARY_TEST_INVALID",
          `Temporary test path is not a supported test filename: ${test.targetPath}`,
          "Use a .test or .spec JavaScript/TypeScript filename inside the project.",
        );
      }
      const target = resolveInsideRoot(root, test.targetPath);
      if (await exists(target)) {
        throw new VerificationExecutionError(
          "TEMPORARY_TEST_EXISTS",
          `Refusing to overwrite an existing test: ${test.targetPath}`,
          "Choose a unique temporary targetPath.",
        );
      }
      const source = taggedSource(test);
      const artifact = resolve(
        generatedDirectory,
        `${test.adapter}-${test.id}${extname(test.targetPath)}`,
      );
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source, { encoding: "utf8", flag: "wx" });
      createdPaths.push(target);
      await writeFile(artifact, source, "utf8");
      artifacts.push({
        adapter: test.adapter,
        artifactPath: relativePath(root, artifact),
        id: test.id,
        requirementRefs: unique(test.requirementRefs),
        targetPath: portablePath(test.targetPath),
      });
    }
    return { artifacts, createdPaths };
  } catch (error) {
    await Promise.all(createdPaths.map((path) => rm(path, { force: true })));
    throw error;
  }
}

interface AdapterGroup {
  readonly adapter: VerificationAdapter;
  readonly steps: VerificationStep[];
  readonly temporaryTests: readonly TemporaryTest[];
}

function groupSteps(
  plan: VerificationPlan,
  temporaryTests: readonly TemporaryTest[],
): AdapterGroup[] {
  const groups = new Map<VerificationAdapter, VerificationStep[]>();
  for (const step of plan.steps) {
    const current = groups.get(step.adapter) ?? [];
    current.push(step);
    groups.set(step.adapter, current);
  }
  for (const test of temporaryTests) {
    if (!groups.has(test.adapter)) groups.set(test.adapter, []);
  }
  return [...groups].map(([adapter, steps]) => ({
    adapter,
    steps,
    temporaryTests: temporaryTests.filter((test) => test.adapter === adapter),
  }));
}

function resultError(code: string, message: string, remediation: string): VerificationResultError {
  return { code, message, remediation };
}

function passiveResult(group: AdapterGroup): AdapterExecutionResult {
  const manual = group.adapter === "manual-review";
  return {
    adapter: group.adapter,
    artifacts: {},
    blocking: group.steps.some((step) => step.blocking),
    durationMs: 0,
    error: manual
      ? resultError(
          "MANUAL_REVIEW_REQUIRED",
          "This verification step requires human review.",
          "Review the linked requirements and record the result before release.",
        )
      : resultError(
          "PLAN_ADAPTER_UNAVAILABLE",
          "The verification plan has no executable adapter for this step.",
          "Install or configure a supported adapter, then recreate the plan.",
        ),
    exitCode: null,
    requirementRefs: unique(group.steps.flatMap((step) => step.requirementRefs)),
    status: manual ? "skipped" : "unavailable",
    stepIds: group.steps.map((step) => step.id),
    targetFiles: unique(group.steps.flatMap((step) => step.targetFiles ?? [])),
    testFiles: unique(group.steps.flatMap((step) => step.testFiles)),
  };
}

interface AdapterInvocation {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

async function findExecutableOnPath(name: string): Promise<string | undefined> {
  const pathValue = Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1];
  if (pathValue === undefined) return undefined;
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
          .map((extension) => extension.toLowerCase())
      : [""];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve(directory, `${name}${extension}`);
      try {
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Continue through PATH candidates without invoking a shell.
      }
    }
  }
  return undefined;
}

async function findAdapterInvocation(
  root: string,
  adapter: AutomatedVerificationAdapter,
): Promise<AdapterInvocation | undefined> {
  if (adapter === "semgrep" || adapter === "gitleaks") {
    const localCandidates =
      process.platform === "win32"
        ? [`.venv/Scripts/${adapter}.exe`, `venv/Scripts/${adapter}.exe`]
        : [`.venv/bin/${adapter}`, `venv/bin/${adapter}`];
    for (const candidate of localCandidates) {
      const path = resolve(root, candidate);
      if (await exists(path)) return { executable: path, prefixArgs: [] };
    }
    const executable = await findExecutableOnPath(adapter);
    return executable === undefined ? undefined : { executable, prefixArgs: [] };
  }

  if (
    adapter === "axe" &&
    !(await exists(resolve(root, "node_modules/@axe-core/playwright/package.json")))
  ) {
    return undefined;
  }
  const candidates =
    adapter === "vitest"
      ? ["node_modules/vitest/vitest.mjs"]
      : ["node_modules/@playwright/test/cli.js", "node_modules/playwright/cli.js"];
  for (const candidate of candidates) {
    const binary = resolve(root, candidate);
    if (await exists(binary)) return { executable: process.execPath, prefixArgs: [binary] };
  }
  return undefined;
}

function unavailableAdapterResult(
  group: AdapterGroup,
  testFiles: readonly string[],
  targetFiles: readonly string[],
  error?: VerificationResultError,
): AdapterExecutionResult {
  const errors: Partial<Record<VerificationAdapter, VerificationResultError>> = {
    axe: resultError(
      "AXE_NOT_INSTALLED",
      "The axe Playwright accessibility adapter is not installed in this project.",
      "Install @axe-core/playwright and @playwright/test, add an axe-backed Playwright accessibility test, then retry.",
    ),
    gitleaks: resultError(
      "GITLEAKS_NOT_INSTALLED",
      "Gitleaks is not available in this project or on PATH.",
      "Install the Gitleaks executable and ensure it is on PATH, then retry.",
    ),
    playwright: resultError(
      "PLAYWRIGHT_NOT_INSTALLED",
      "Playwright is not installed in this project.",
      "Install @playwright/test in the project and install the required browser, then retry.",
    ),
    semgrep: resultError(
      "SEMGREP_NOT_INSTALLED",
      "Semgrep is not available in this project or on PATH.",
      "Install the Semgrep executable and ensure it is on PATH, then retry.",
    ),
    vitest: resultError(
      "VITEST_NOT_INSTALLED",
      "Vitest is not installed in this project.",
      "Install vitest in the project, then retry.",
    ),
  };
  return {
    adapter: group.adapter,
    artifacts: {},
    blocking: group.steps.some((step) => step.blocking),
    durationMs: 0,
    error:
      error ??
      errors[group.adapter] ??
      resultError(
        "PLAN_ADAPTER_UNAVAILABLE",
        `${group.adapter} is not available for execution.`,
        "Install or configure the selected adapter, then retry.",
      ),
    exitCode: null,
    requirementRefs: unique([
      ...group.steps.flatMap((step) => step.requirementRefs),
      ...group.temporaryTests.flatMap((test) => test.requirementRefs),
    ]),
    status: "unavailable",
    stepIds: group.steps.map((step) => step.id),
    targetFiles,
    testFiles,
  };
}

async function semgrepConfig(root: string): Promise<string | undefined> {
  for (const candidate of [".semgrep.yml", ".semgrep.yaml", "semgrep.yml", "semgrep.yaml"]) {
    if (await exists(resolve(root, candidate))) return candidate;
  }
  return undefined;
}

async function existingTargets(root: string, paths: readonly string[]): Promise<string[]> {
  const absoluteRoot = resolve(root);
  const result: string[] = [];
  for (const path of paths) {
    if (isAbsolute(path)) continue;
    const target = resolve(absoluteRoot, path);
    if (!target.startsWith(`${absoluteRoot}${sep}`) || !(await exists(target))) continue;
    result.push(portablePath(path));
  }
  return unique(result);
}

async function writeOutputArtifacts(
  root: string,
  runDirectory: string,
  adapter: AutomatedVerificationAdapter,
  stdout: string,
  stderr: string,
): Promise<{ stderr: string; stdout: string }> {
  const directory = resolve(runDirectory, adapter);
  await mkdir(directory, { recursive: true });
  const stdoutPath = resolve(directory, "stdout.txt");
  const stderrPath = resolve(directory, "stderr.txt");
  await Promise.all([writeFile(stdoutPath, stdout, "utf8"), writeFile(stderrPath, stderr, "utf8")]);
  return { stderr: relativePath(root, stderrPath), stdout: relativePath(root, stdoutPath) };
}

async function executeAutomatedGroup(
  root: string,
  runDirectory: string,
  group: AdapterGroup & { readonly adapter: AutomatedVerificationAdapter },
  options: Required<Pick<RunVerificationOptions, "commandRunner" | "timeoutMs">>,
): Promise<AdapterExecutionResult> {
  const testFiles = unique([
    ...group.steps.flatMap((step) => step.testFiles),
    ...group.temporaryTests.map((test) => portablePath(test.targetPath)),
  ]);
  const targetFiles = unique(group.steps.flatMap((step) => step.targetFiles ?? []));
  const requirementRefs = unique([
    ...group.steps.flatMap((step) => step.requirementRefs),
    ...group.temporaryTests.flatMap((test) => test.requirementRefs),
  ]);
  const base = {
    adapter: group.adapter,
    blocking: group.steps.some((step) => step.blocking),
    requirementRefs,
    stepIds: group.steps.map((step) => step.id),
    targetFiles,
    testFiles,
  } as const;

  const testAdapter =
    group.adapter === "axe" || group.adapter === "playwright" || group.adapter === "vitest";
  if (testAdapter && testFiles.length === 0) {
    return {
      ...base,
      artifacts: {},
      durationMs: 0,
      error: resultError(
        "NO_TESTS_SELECTED",
        `No ${group.adapter} test files were selected for this change.`,
        "Add an affected test or provide a generated temporary test, then retry.",
      ),
      exitCode: null,
      status: "skipped",
    };
  }

  const invocation = await findAdapterInvocation(root, group.adapter);
  if (invocation === undefined) return unavailableAdapterResult(group, testFiles, targetFiles);

  const outputDirectory = resolve(runDirectory, group.adapter, "test-output");
  const reportPath = resolve(runDirectory, group.adapter, "report.json");
  const portableReportPath = relativePath(root, reportPath);
  let adapterArgs: string[];
  if (group.adapter === "vitest") {
    adapterArgs = ["run", ...testFiles, "--reporter=default"];
  } else if (group.adapter === "playwright" || group.adapter === "axe") {
    adapterArgs = ["test", ...testFiles, "--reporter=line", "--output", outputDirectory];
  } else if (group.adapter === "semgrep") {
    const config = await semgrepConfig(root);
    if (config === undefined) {
      return unavailableAdapterResult(
        group,
        testFiles,
        targetFiles,
        resultError(
          "SEMGREP_CONFIG_NOT_FOUND",
          "No local Semgrep rule configuration was found.",
          "Add .semgrep.yml or .semgrep.yaml with reviewed local rules, then retry.",
        ),
      );
    }
    const targets = await existingTargets(root, targetFiles);
    if (targets.length === 0) {
      return {
        ...base,
        artifacts: {},
        durationMs: 0,
        error: resultError(
          "NO_SECURITY_TARGETS_SELECTED",
          "No existing changed source files were selected for Semgrep.",
          "Recreate the verification plan from a working tree with scannable source changes.",
        ),
        exitCode: null,
        status: "skipped",
      };
    }
    await mkdir(dirname(reportPath), { recursive: true });
    adapterArgs = [
      "scan",
      "--config",
      config,
      "--json",
      "--output",
      portableReportPath,
      "--error",
      ...targets,
    ];
  } else {
    await mkdir(dirname(reportPath), { recursive: true });
    adapterArgs = [
      "dir",
      "--no-banner",
      "--no-color",
      "--redact",
      "--report-format",
      "json",
      "--report-path",
      portableReportPath,
      ".",
    ];
  }
  const args = [...invocation.prefixArgs, ...adapterArgs];
  const command = { args, executable: invocation.executable } as const;

  try {
    const executed = await options.commandRunner.run({
      args,
      command: invocation.executable,
      cwd: root,
      env: { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
      timeoutMs: options.timeoutMs,
    });
    const artifacts = await writeOutputArtifacts(
      root,
      runDirectory,
      group.adapter,
      executed.stdout,
      executed.stderr,
    );
    const scanner = group.adapter === "semgrep" || group.adapter === "gitleaks";
    const status: VerificationResultStatus =
      executed.exitCode === 0
        ? "passed"
        : executed.exitCode === null || (scanner && executed.exitCode !== 1)
          ? "error"
          : "failed";
    const reportExists = scanner && (await exists(reportPath));
    return {
      ...base,
      artifacts: {
        ...artifacts,
        ...(reportExists ? { report: portableReportPath } : {}),
        ...(group.adapter === "playwright"
          ? { outputDirectory: relativePath(root, outputDirectory) }
          : {}),
      },
      command,
      durationMs: executed.durationMs,
      ...(executed.timedOut
        ? {
            error: resultError(
              "ADAPTER_TIMEOUT",
              `${group.adapter} exceeded the ${options.timeoutMs}ms execution timeout.`,
              "Inspect the captured output, fix hanging tests, or configure a longer timeout.",
            ),
          }
        : executed.exitCode === null || (scanner && executed.exitCode !== 1)
          ? {
              error: resultError(
                "ADAPTER_EXECUTION_FAILED",
                `${group.adapter} could not start or complete.`,
                "Inspect the captured stderr artifact and confirm the local test installation works.",
              ),
            }
          : {}),
      exitCode: executed.exitCode,
      status,
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const artifacts = await writeOutputArtifacts(root, runDirectory, group.adapter, "", details);
    return {
      ...base,
      artifacts,
      command,
      durationMs: 0,
      error: resultError(
        "ADAPTER_EXECUTION_FAILED",
        `${group.adapter} execution failed before returning a result.`,
        "Inspect the captured stderr artifact and confirm the local test installation works.",
      ),
      exitCode: null,
      status: "error",
    };
  }
}

function summarize(results: readonly AdapterExecutionResult[]): VerificationRun["summary"] {
  const count = (status: VerificationResultStatus): number =>
    results.filter((result) => result.status === status).length;
  return {
    blockingFailures: results.filter((result) => result.blocking && result.status !== "passed")
      .length,
    error: count("error"),
    failed: count("failed"),
    passed: count("passed"),
    skipped: count("skipped"),
    unavailable: count("unavailable"),
  };
}

function runStatus(summary: VerificationRun["summary"]): VerificationRun["status"] {
  if (summary.failed > 0) return "failed";
  if (summary.error > 0) return "error";
  if (summary.skipped > 0 || summary.unavailable > 0) return "incomplete";
  return "passed";
}

/** Execute an existing verification plan and persist raw, requirement-linked run artifacts. */
export async function runVerificationPlan(
  root: string,
  plan: VerificationPlan,
  options: RunVerificationOptions = {},
): Promise<VerificationRunResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  let runDirectory: string;
  try {
    runDirectory = await createRunDirectory(root, startedAt);
  } catch (error) {
    if (error instanceof VerificationExecutionError) throw error;
    throw new VerificationExecutionError(
      "EXECUTION_ARTIFACT_WRITE_FAILED",
      "Unable to create the verification artifact directory.",
      "Check project directory permissions and available disk space.",
      { cause: error },
    );
  }

  const temporaryTests = options.temporaryTests ?? [];
  const prepared = await prepareTemporaryTests(root, runDirectory, temporaryTests);
  try {
    const results: AdapterExecutionResult[] = [];
    for (const group of groupSteps(plan, temporaryTests)) {
      if (
        group.adapter === "axe" ||
        group.adapter === "gitleaks" ||
        group.adapter === "playwright" ||
        group.adapter === "semgrep" ||
        group.adapter === "vitest"
      ) {
        results.push(
          await executeAutomatedGroup(
            root,
            runDirectory,
            { ...group, adapter: group.adapter },
            {
              commandRunner: options.commandRunner ?? defaultCommandRunner,
              timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            },
          ),
        );
      } else {
        results.push(passiveResult(group));
      }
    }

    const summary = summarize(results);
    const run: VerificationRun = {
      artifactDirectory: relativePath(root, runDirectory),
      completedAt: now().toISOString(),
      generatedTests: prepared.artifacts,
      planPath: options.planPath ?? ".maru/generated/verification-plan.json",
      results,
      schemaVersion: VERIFICATION_RUN_SCHEMA_VERSION,
      startedAt: startedAt.toISOString(),
      status: runStatus(summary),
      summary,
    };
    const path = resolve(runDirectory, "run.json");
    await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    return { path: relativePath(root, path), run };
  } catch (error) {
    if (error instanceof VerificationExecutionError) throw error;
    throw new VerificationExecutionError(
      "EXECUTION_ARTIFACT_WRITE_FAILED",
      "Unable to complete or persist the verification run.",
      "Inspect .maru/artifacts and check project directory permissions, then retry.",
      { cause: error },
    );
  } finally {
    await Promise.all(prepared.createdPaths.map((path) => rm(path, { force: true })));
  }
}

/** Rebuild the working-tree plan, persist it, and execute its selected verification. */
export async function createAndRunVerification(
  root: string,
  now = new Date(),
  options: CreateAndRunVerificationOptions = {},
): Promise<VerificationRunResult> {
  const createPlan = options.createPlan ?? createAndWriteVerificationPlan;
  const planned = await createPlan(root, now);
  return runVerificationPlan(root, planned.plan, {
    commandRunner: options.commandRunner,
    now: options.now ?? (() => now),
    planPath: planned.path,
    temporaryTests: options.temporaryTests,
    timeoutMs: options.timeoutMs,
  });
}
