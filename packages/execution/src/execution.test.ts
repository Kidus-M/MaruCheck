import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerificationAdapter, VerificationPlan } from "@maru/planner";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAndRunVerification,
  runVerificationPlan,
  type CommandRunner,
  type TemporaryTest,
} from "./index.js";

const NOW = new Date("2026-08-17T09:30:00.000Z");

function plan(steps: VerificationPlan["steps"]): VerificationPlan {
  return {
    affectedTests: [],
    changeSummary: { additions: 8, changedFiles: 2, deletions: 3 },
    generatedAt: NOW.toISOString(),
    project: { name: "subscription-app", testFrameworks: ["playwright", "vitest"] },
    risk: { level: "critical", score: 91 },
    schemaVersion: 1,
    scope: "working-tree",
    selectedRequirements: [],
    steps,
    summary: {
      affectedTests: 0,
      automatedSteps: steps.filter((step) => step.execution === "automated").length,
      manualSteps: steps.filter((step) => step.execution === "manual").length,
      selectedRequirements: 0,
      unavailableSteps: steps.filter((step) => step.execution === "unavailable").length,
    },
    uncoveredRequirements: [],
  };
}

function step(
  adapter: VerificationAdapter,
  overrides: Partial<VerificationPlan["steps"][number]> = {},
): VerificationPlan["steps"][number] {
  const execution =
    adapter === "manual-review"
      ? "manual"
      : adapter === "unavailable"
        ? "unavailable"
        : "automated";
  return {
    adapter,
    blocking: true,
    category:
      adapter === "axe"
        ? "accessibility"
        : adapter === "gitleaks" || adapter === "semgrep" || adapter === "manual-review"
          ? "security"
          : adapter === "playwright"
            ? "e2e"
            : "unit",
    execution,
    id: `step-${adapter}`,
    reasons: ["Selected by fixture."],
    requirementRefs: ["subscription-management#SUB-003"],
    testFiles: [],
    ...overrides,
  };
}

describe("verification execution", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  async function project(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maru-execution-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "node_modules/vitest"), { recursive: true });
    await mkdir(join(root, "node_modules/@playwright/test"), { recursive: true });
    await mkdir(join(root, "node_modules/@axe-core/playwright"), { recursive: true });
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "node_modules/vitest/vitest.mjs"), "", "utf8");
    await writeFile(join(root, "node_modules/@playwright/test/cli.js"), "", "utf8");
    await writeFile(join(root, "node_modules/@axe-core/playwright/package.json"), "{}", "utf8");
    return root;
  }

  async function installScanner(root: string, name: "gitleaks" | "semgrep"): Promise<string> {
    const path =
      process.platform === "win32"
        ? join(root, ".venv", "Scripts", `${name}.exe`)
        : join(root, ".venv", "bin", name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "fixture", "utf8");
    return path;
  }

  it("runs selected existing Vitest and Playwright files and captures raw artifacts", async () => {
    const root = await project();
    const runner: CommandRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ durationMs: 12, exitCode: 0, stderr: "", stdout: "2 passed" })
        .mockResolvedValueOnce({
          durationMs: 24,
          exitCode: 0,
          stderr: "browser note",
          stdout: "1 passed",
        }),
    };

    const result = await runVerificationPlan(
      root,
      plan([
        step("vitest", { testFiles: ["tests/subscription.test.ts"] }),
        step("playwright", { testFiles: ["tests/subscription.spec.ts"] }),
      ]),
      { commandRunner: runner, now: () => NOW },
    );

    expect(result.run.status).toBe("passed");
    expect(result.run.summary).toMatchObject({ blockingFailures: 0, failed: 0, passed: 2 });
    expect(runner.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        args: expect.arrayContaining(["run", "tests/subscription.test.ts"]),
        command: process.execPath,
        cwd: root,
      }),
    );
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        args: expect.arrayContaining(["test", "tests/subscription.spec.ts", "--reporter=line"]),
        command: process.execPath,
        cwd: root,
      }),
    );
    await expect(readFile(join(root, result.path), "utf8")).resolves.toContain(
      '"status": "passed"',
    );
    await expect(
      readFile(join(root, result.run.results[0]?.artifacts.stdout ?? ""), "utf8"),
    ).resolves.toBe("2 passed");
    await expect(
      readFile(join(root, result.run.results[1]?.artifacts.stderr ?? ""), "utf8"),
    ).resolves.toBe("browser note");
  });

  it("runs an axe-backed Playwright accessibility suite as a distinct adapter", async () => {
    const root = await project();
    const runner: CommandRunner = {
      run: vi
        .fn()
        .mockResolvedValue({ durationMs: 18, exitCode: 0, stderr: "", stdout: "axe passed" }),
    };

    const result = await runVerificationPlan(
      root,
      plan([step("axe", { testFiles: ["tests/accessibility.spec.ts"] })]),
      { commandRunner: runner, now: () => NOW },
    );

    expect(result.run.results[0]).toMatchObject({ adapter: "axe", status: "passed" });
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(["test", "tests/accessibility.spec.ts"]),
        command: process.execPath,
      }),
    );
  });

  it("runs Semgrep on changed files and Gitleaks on the current tree with redacted JSON reports", async () => {
    const root = await project();
    await installScanner(root, "gitleaks");
    await installScanner(root, "semgrep");
    await mkdir(join(root, "src", "billing"), { recursive: true });
    await writeFile(
      join(root, "src", "billing", "checkout.ts"),
      "export const checkout = true;",
      "utf8",
    );
    await writeFile(join(root, ".semgrep.yml"), "rules: []\n", "utf8");
    const runner: CommandRunner = {
      run: vi.fn().mockImplementation(async ({ args }) => {
        const outputFlag = args.includes("--report-path") ? "--report-path" : "--output";
        const outputIndex = args.indexOf(outputFlag);
        const report = args[outputIndex + 1];
        if (report === undefined) throw new Error("Expected scanner report path.");
        await mkdir(join(root, report, ".."), { recursive: true });
        await writeFile(join(root, report), "[]\n", "utf8");
        return { durationMs: 11, exitCode: 0, stderr: "", stdout: "scan complete" };
      }),
    };
    const targetFiles = ["src/billing/checkout.ts"];

    const result = await runVerificationPlan(
      root,
      plan([step("gitleaks", { targetFiles }), step("semgrep", { targetFiles })]),
      { commandRunner: runner, now: () => NOW },
    );

    expect(result.run.status).toBe("passed");
    expect(result.run.results).toEqual([
      expect.objectContaining({
        adapter: "gitleaks",
        artifacts: expect.objectContaining({ report: expect.stringContaining("report.json") }),
        status: "passed",
      }),
      expect.objectContaining({
        adapter: "semgrep",
        artifacts: expect.objectContaining({ report: expect.stringContaining("report.json") }),
        status: "passed",
        targetFiles,
      }),
    ]);
    expect(runner.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ args: expect.arrayContaining(["dir", "--redact", "."]) }),
    );
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        args: expect.arrayContaining([
          "scan",
          "--config",
          ".semgrep.yml",
          "--error",
          ...targetFiles,
        ]),
      }),
    );
  });

  it("reports missing local Semgrep rules as unavailable without invoking the executable", async () => {
    const root = await project();
    await installScanner(root, "semgrep");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "auth.ts"), "export const auth = true;", "utf8");
    const runner: CommandRunner = { run: vi.fn() };

    const result = await runVerificationPlan(
      root,
      plan([step("semgrep", { targetFiles: ["src/auth.ts"] })]),
      { commandRunner: runner, now: () => NOW },
    );

    expect(result.run.results[0]).toMatchObject({
      error: { code: "SEMGREP_CONFIG_NOT_FOUND" },
      status: "unavailable",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("treats scanner exit code 1 as findings and higher exit codes as execution errors", async () => {
    const root = await project();
    await installScanner(root, "gitleaks");
    const runner: CommandRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ durationMs: 4, exitCode: 1, stderr: "leak", stdout: "" })
        .mockResolvedValueOnce({ durationMs: 4, exitCode: 2, stderr: "bad config", stdout: "" }),
    };

    const findings = await runVerificationPlan(root, plan([step("gitleaks")]), {
      commandRunner: runner,
      now: () => NOW,
    });
    const error = await runVerificationPlan(
      root,
      plan([step("gitleaks", { id: "step-gitleaks-error" })]),
      { commandRunner: runner, now: () => new Date("2026-08-17T09:31:00.000Z") },
    );

    expect(findings.run.results[0]).toMatchObject({ adapter: "gitleaks", status: "failed" });
    expect(error.run.results[0]).toMatchObject({
      adapter: "gitleaks",
      error: { code: "ADAPTER_EXECUTION_FAILED" },
      status: "error",
    });
  });

  it("blocks an intentionally broken subscription cancellation when Vitest fails", async () => {
    const root = await project();
    await writeFile(
      join(root, "tests/subscription-cancellation.test.ts"),
      "// broken fixture: cancellation leaves status active\n",
      "utf8",
    );
    const runner: CommandRunner = {
      run: vi.fn().mockResolvedValue({
        durationMs: 9,
        exitCode: 1,
        stderr: "expected 'active' to be 'cancelled'",
        stdout: "1 failed",
      }),
    };

    const result = await runVerificationPlan(
      root,
      plan([
        step("vitest", {
          id: "step-subscription-cancellation",
          testFiles: ["tests/subscription-cancellation.test.ts"],
        }),
      ]),
      { commandRunner: runner, now: () => NOW },
    );

    expect(result.run.status).toBe("failed");
    expect(result.run.summary).toMatchObject({ blockingFailures: 1, failed: 1 });
    expect(result.run.results[0]).toMatchObject({
      adapter: "vitest",
      exitCode: 1,
      requirementRefs: ["subscription-management#SUB-003"],
      status: "failed",
      testFiles: ["tests/subscription-cancellation.test.ts"],
    });
  });

  it("tags, executes, archives, and removes generated temporary tests", async () => {
    const root = await project();
    const temporaryTest: TemporaryTest = {
      adapter: "vitest",
      id: "cancel-immediately",
      requirementRefs: ["subscription-management#SUB-003"],
      source:
        "import { expect, it } from 'vitest';\nit('cancels', () => expect('active').toBe('cancelled'));\n",
      targetPath: "tests/.maru-cancel-immediately.test.ts",
    };
    const runner: CommandRunner = {
      run: vi.fn().mockImplementation(async ({ args }) => {
        const source = await readFile(join(root, "tests/.maru-cancel-immediately.test.ts"), "utf8");
        expect(source).toContain("@maru-requirements subscription-management#SUB-003");
        expect(args).toContain("tests/.maru-cancel-immediately.test.ts");
        return { durationMs: 5, exitCode: 1, stderr: "expected cancelled", stdout: "1 failed" };
      }),
    };

    const result = await runVerificationPlan(root, plan([step("vitest")]), {
      commandRunner: runner,
      now: () => NOW,
      temporaryTests: [temporaryTest],
    });

    await expect(access(join(root, temporaryTest.targetPath))).rejects.toThrow();
    expect(result.run.generatedTests[0]).toMatchObject({
      adapter: "vitest",
      requirementRefs: ["subscription-management#SUB-003"],
      targetPath: temporaryTest.targetPath,
    });
    await expect(
      readFile(join(root, result.run.generatedTests[0]?.artifactPath ?? ""), "utf8"),
    ).resolves.toContain("@maru-requirements subscription-management#SUB-003");
  });

  it("returns actionable unavailable results without invoking missing adapters", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-execution-missing-"));
    temporaryDirectories.push(root);
    const runner: CommandRunner = { run: vi.fn() };

    const result = await runVerificationPlan(
      root,
      plan([step("playwright", { testFiles: ["tests/subscription.spec.ts"] })]),
      { commandRunner: runner, now: () => NOW },
    );

    expect(result.run.status).toBe("incomplete");
    expect(result.run.summary.blockingFailures).toBe(1);
    expect(result.run.results[0]).toMatchObject({
      error: {
        code: "PLAYWRIGHT_NOT_INSTALLED",
        remediation: expect.stringContaining("@playwright/test"),
      },
      status: "unavailable",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an existing file with a temporary test", async () => {
    const root = await project();
    await writeFile(join(root, "tests/existing.test.ts"), "user-owned", "utf8");

    await expect(
      runVerificationPlan(root, plan([step("vitest")]), {
        now: () => NOW,
        temporaryTests: [
          {
            adapter: "vitest",
            id: "existing",
            requirementRefs: ["subscription-management#SUB-003"],
            source: "throw new Error('must not be written');",
            targetPath: "tests/existing.test.ts",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "TEMPORARY_TEST_EXISTS" });
    await expect(readFile(join(root, "tests/existing.test.ts"), "utf8")).resolves.toBe(
      "user-owned",
    );
  });

  it("creates and persists the current plan before executing it", async () => {
    const root = await project();
    const verificationPlan = plan([step("vitest", { testFiles: ["tests/unit.test.ts"] })]);
    const createPlan = vi.fn().mockResolvedValue({
      path: ".maru/generated/verification-plan.json",
      plan: verificationPlan,
    });
    const commandRunner: CommandRunner = {
      run: vi.fn().mockResolvedValue({ durationMs: 4, exitCode: 0, stderr: "", stdout: "passed" }),
    };

    const result = await createAndRunVerification(root, NOW, { commandRunner, createPlan });

    expect(createPlan).toHaveBeenCalledWith(root, NOW);
    expect(result.run.planPath).toBe(".maru/generated/verification-plan.json");
    expect(result.run.status).toBe("passed");
  });
});
