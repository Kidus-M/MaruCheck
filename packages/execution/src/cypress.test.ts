import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerificationPlan } from "@maru/planner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVerificationPlan, type CommandRequest, type CommandRunner } from "./index.js";

const NOW = new Date("2026-08-17T09:30:00.000Z");
const SPEC = "cypress/e2e/checkout.cy.ts";

function plan(files = [SPEC]): VerificationPlan {
  return {
    affectedTests: [],
    changeSummary: { additions: 1, deletions: 0, changedFiles: 1 },
    generatedAt: NOW.toISOString(),
    historicalRegressions: [],
    project: { name: "checkout", testFrameworks: ["cypress"] },
    risk: { level: "high", score: 70 },
    schemaVersion: 1,
    scope: "working-tree",
    selectedRequirements: [],
    uncoveredRequirements: [],
    steps: [
      {
        adapter: "cypress",
        category: "e2e",
        execution: "automated",
        blocking: true,
        id: "step-cypress",
        reasons: [],
        requirementRefs: ["checkout#PAY-001"],
        testFiles: files,
      },
    ],
    summary: {
      affectedTests: files.length,
      automatedSteps: 1,
      manualSteps: 0,
      selectedRequirements: 0,
      unavailableSteps: 0,
    },
  };
}

function report(states = ["passed"], spec = SPEC): Record<string, unknown> {
  return {
    totalTests: states.length,
    totalFailed: states.filter((state) => state === "failed").length,
    totalPassed: states.filter((state) => state === "passed").length,
    totalPending: states.filter((state) => state === "pending").length,
    totalSkipped: states.filter((state) => state === "skipped").length,
    totalDuration: 42,
    runs: [
      {
        spec: { relative: spec },
        error: null,
        tests: states.map((state, index) => ({
          title: ["Checkout", `case ${index}`],
          state,
          duration: state === "pending" ? null : 10,
          displayError: state === "failed" ? "AssertionError: expected paid to be declined" : null,
        })),
        screenshots: [{ path: "screenshots/checkout.png" }],
        video: "videos/checkout.mp4",
      },
    ],
  };
}

describe("Cypress verification", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function project(installed = true): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maru-cypress-"));
    roots.push(root);
    if (installed) {
      await mkdir(join(root, "node_modules/cypress"), { recursive: true });
      await writeFile(
        join(root, "node_modules/cypress/package.json"),
        JSON.stringify({ main: "index.js" }),
      );
    }
    return root;
  }

  function runner(value: unknown, exitCode = 0, stdout = "Cypress output"): CommandRunner {
    return {
      run: vi.fn(async (request: CommandRequest) => {
        const input = JSON.parse(request.args.at(-1) ?? "") as { reportPath: string };
        await writeFile(input.reportPath, JSON.stringify(value));
        return { durationMs: 42, exitCode, stdout, stderr: "" };
      }),
    };
  }

  it("selects exact specs through local Cypress and preserves raw and normalized results", async () => {
    const root = await project();
    const commandRunner = runner(report(["passed", "failed", "pending", "skipped"]), 1);
    const { run } = await runVerificationPlan(root, plan(), { commandRunner, now: () => NOW });
    expect(run.status).toBe("failed");
    const result = run.results[0];
    expect(result).toMatchObject({
      adapter: "cypress",
      status: "failed",
      durationMs: 42,
      requirementRefs: ["checkout#PAY-001"],
      testResults: [
        { name: "Checkout > case 0", status: "passed", file: SPEC, durationMs: 10 },
        {
          name: "Checkout > case 1",
          status: "failed",
          error: expect.stringContaining("AssertionError"),
        },
        { name: "Checkout > case 2", status: "skipped", durationMs: 0 },
        { name: "Checkout > case 3", status: "skipped" },
      ],
    });
    expect(commandRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: process.execPath,
        cwd: root,
        env: expect.objectContaining({ CYPRESS_CRASH_REPORTS: "0" }),
        args: ["--eval", expect.stringContaining("record: false"), "--", expect.any(String)],
      }),
    );
    const input = JSON.parse(result?.command?.args.at(-1) ?? "") as { spec: string };
    expect(input.spec).toBe(SPEC);
    expect(result?.artifacts.outputDirectory).toMatch(/cypress\/test-output$/u);
    expect(
      JSON.parse(await readFile(join(root, result?.artifacts.report ?? ""), "utf8")),
    ).toMatchObject({ totalFailed: 1 });
    expect(await readFile(join(root, result?.artifacts.stdout ?? ""), "utf8")).toBe(
      "Cypress output",
    );
  });

  it.each([
    [["passed"], "passed", undefined],
    [["passed", "pending"], "skipped", "CYPRESS_TESTS_SKIPPED"],
    [["skipped"], "skipped", "CYPRESS_TESTS_SKIPPED"],
    [[], "skipped", "NO_TESTS_EXECUTED"],
  ] as const)("keeps %j results conservative", async (states, status, code) => {
    const root = await project();
    const { run } = await runVerificationPlan(root, plan(), {
      commandRunner: runner(report([...states])),
      now: () => NOW,
    });
    expect(run.results[0]?.status).toBe(status);
    expect(run.results[0]?.error?.code).toBe(code);
  });

  it.each([
    ["Your configFile is invalid: cypress.config.ts", "error", "CYPRESS_CONFIG_INVALID"],
    ["Your configFile threw an error from: cypress.config.js", "error", "CYPRESS_CONFIG_INVALID"],
    [
      "No version of Cypress is installed in the cache",
      "unavailable",
      "CYPRESS_BINARY_NOT_INSTALLED",
    ],
    ["Browser failed to launch", "error", "ADAPTER_EXECUTION_FAILED"],
    ["We could not find a dependency", "error", "ADAPTER_EXECUTION_FAILED"],
  ])("distinguishes setup failures: %s", async (message, status, code) => {
    const root = await project();
    const { run } = await runVerificationPlan(root, plan(), {
      commandRunner: runner({ failures: 1, message }, 1),
      now: () => NOW,
    });
    expect(run.results[0]).toMatchObject({ status, error: { code } });
    expect(run.summary.failed).toBe(0);
  });

  it("uses captured diagnostics when Cypress returns a generic configuration failure", async () => {
    const root = await project();
    const { run } = await runVerificationPlan(root, plan(), {
      commandRunner: runner(
        { status: "failed", failures: 1, message: "Could not find Cypress test run results" },
        1,
        "Your configFile is invalid: cypress.config.cjs\nIt threw an error when required",
      ),
      now: () => NOW,
    });
    expect(run.results[0]).toMatchObject({
      status: "error",
      error: { code: "CYPRESS_CONFIG_INVALID" },
    });
  });

  it("reports missing Cypress without invoking any installer or runner", async () => {
    const root = await project(false);
    const commandRunner = runner(report());
    const { run } = await runVerificationPlan(root, plan(), { commandRunner, now: () => NOW });
    expect(run.results[0]).toMatchObject({
      status: "unavailable",
      error: { code: "CYPRESS_NOT_INSTALLED" },
    });
    expect(commandRunner.run).not.toHaveBeenCalled();
  });

  it("does not fall back to running the entire suite when no specs are selected", async () => {
    const root = await project();
    const commandRunner = runner(report());
    const { run } = await runVerificationPlan(root, plan([]), { commandRunner, now: () => NOW });
    expect(run.results[0]).toMatchObject({
      status: "skipped",
      error: { code: "NO_TESTS_SELECTED" },
    });
    expect(commandRunner.run).not.toHaveBeenCalled();
  });

  it.each(["../outside.cy.ts", "cypress/**/*.cy.ts", "first.cy.ts,second.cy.ts"])(
    "rejects unsafe or nonliteral spec %s",
    async (file) => {
      const root = await project();
      const commandRunner = runner(report());
      const { run } = await runVerificationPlan(root, plan([file]), {
        commandRunner,
        now: () => NOW,
      });
      expect(run.results[0]).toMatchObject({
        status: "error",
        error: { code: "CYPRESS_SPEC_INVALID" },
      });
      expect(commandRunner.run).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { ...report(), totalFailed: 1 },
    report(["passed"], "unselected.cy.ts"),
    report(["unknown"]),
  ])("rejects incomplete or inconsistent reports", async (value) => {
    const root = await project();
    const { run } = await runVerificationPlan(root, plan(), {
      commandRunner: runner(value),
      now: () => NOW,
    });
    expect(run.results[0]).toMatchObject({
      status: "error",
      error: { code: "CYPRESS_REPORT_INVALID" },
    });
  });

  it("treats a spec compilation error as an execution error", async () => {
    const root = await project();
    const value = {
      ...report(),
      runs: [{ spec: { relative: SPEC }, error: "Webpack compilation failed", tests: [] }],
    };
    const { run } = await runVerificationPlan(root, plan(), {
      commandRunner: runner(value, 1),
      now: () => NOW,
    });
    expect(run.results[0]).toMatchObject({
      status: "error",
      error: { code: "ADAPTER_EXECUTION_FAILED" },
    });
  });

  it("preserves timeout and spawn failures even when a report exists", async () => {
    const root = await project();
    for (const [timedOut, exitCode] of [
      [true, 0],
      [true, 1],
      [false, null],
    ] as const) {
      const commandRunner: CommandRunner = {
        run: async (request) => {
          const input = JSON.parse(request.args.at(-1) ?? "") as { reportPath: string };
          await writeFile(input.reportPath, JSON.stringify(report()));
          return {
            durationMs: 42,
            exitCode,
            timedOut,
            stdout: "",
            stderr: "failed",
          };
        },
      };
      const { run } = await runVerificationPlan(root, plan(), { commandRunner, now: () => NOW });
      expect(run.results[0]).toMatchObject({
        status: "error",
        error: { code: timedOut ? "ADAPTER_TIMEOUT" : "ADAPTER_EXECUTION_FAILED" },
      });
    }
  });

  it("does not accept a passing report from an unsuccessful process", async () => {
    const root = await project();
    const { run } = await runVerificationPlan(root, plan(), {
      commandRunner: runner(report(), 1),
      now: () => NOW,
    });
    expect(run.results[0]).toMatchObject({
      status: "error",
      error: { code: "ADAPTER_EXECUTION_FAILED" },
    });
  });

  it("rejects a report that omitted one of the selected specs", async () => {
    const root = await project();
    const { run } = await runVerificationPlan(root, plan([SPEC, "cypress/e2e/other.cy.ts"]), {
      commandRunner: runner(report()),
      now: () => NOW,
    });
    expect(run.results[0]).toMatchObject({
      status: "error",
      error: { code: "CYPRESS_REPORT_INVALID" },
    });
  });

  it("requires a report even when the process exits successfully", async () => {
    const root = await project();
    const { run } = await runVerificationPlan(root, plan(), {
      commandRunner: {
        run: async () => ({ durationMs: 1, exitCode: 0, stdout: "all good", stderr: "" }),
      },
      now: () => NOW,
    });
    expect(run.results[0]).toMatchObject({
      status: "error",
      error: { code: "CYPRESS_REPORT_INVALID" },
    });
  });

  it("exercises the actual subprocess bootstrap against a local Cypress API fixture", async () => {
    const root = await project();
    await writeFile(
      join(root, "node_modules/cypress/index.js"),
      `
      exports.run = async (options) => {
        if (process.env.ELECTRON_RUN_AS_NODE) throw new Error('Electron host flag leaked to Cypress');
        if (options.record !== false || options.testingType !== 'e2e' || options.spec !== ${JSON.stringify(SPEC)}) throw new Error('Wrong Cypress options');
        if (!options.config.screenshotsFolder.includes('test-output')) throw new Error('Wrong artifact directory');
        return ${JSON.stringify(report())};
      };
    `,
    );
    const { run } = await runVerificationPlan(root, plan(), { now: () => NOW });
    expect(run.results[0]).toMatchObject({
      status: "passed",
      testResults: [{ file: SPEC, status: "passed" }],
    });
    await writeFile(
      join(root, "node_modules/cypress/index.js"),
      "exports.run = async () => { throw new Error('Your configFile is invalid'); };",
    );
    const failed = await runVerificationPlan(root, plan(), { now: () => NOW });
    expect(failed.run.results[0]).toMatchObject({
      status: "error",
      error: { code: "CYPRESS_CONFIG_INVALID" },
    });
  });
});
