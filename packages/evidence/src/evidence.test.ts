import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerificationRun, VerificationRunResult } from "@maru/execution";
import type { VerificationPlan, VerificationPlanResult } from "@maru/planner";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVerificationReport,
  createAndWriteVerificationReport,
  formatVerificationReport,
  writeVerificationReport,
} from "./index.js";

const NOW = new Date("2026-08-17T12:00:00.000Z");
const RUN_DIRECTORY = ".maru/artifacts/runs/2026-08-17T12-00-00-000Z";

function plan(): VerificationPlan {
  return {
    affectedTests: [
      {
        framework: "vitest",
        matchedTerms: ["subscription"],
        path: "tests/subscription-cancellation.test.ts",
        requirementRefs: ["subscription-management#SUB-004"],
      },
    ],
    changeSummary: { additions: 5, changedFiles: 1, deletions: 2 },
    generatedAt: NOW.toISOString(),
    project: { name: "subscription-app", testFrameworks: ["vitest"] },
    risk: { level: "critical", score: 94 },
    schemaVersion: 1,
    scope: "working-tree",
    selectedRequirements: [
      {
        blocking: true,
        contractId: "subscription-management",
        contractTitle: "Subscription Management",
        id: "SUB-004",
        kind: "requirement",
        priority: "required",
        reasons: ["Selected by the contract evidence policy."],
        statement: "Cancellation keeps Pro access active until period_end.",
      },
    ],
    steps: [
      {
        adapter: "vitest",
        blocking: true,
        category: "contract-regression",
        execution: "automated",
        id: "step-01-contract-regression",
        reasons: ["Critical risk requires contract regression verification."],
        requirementRefs: ["subscription-management#SUB-004"],
        testFiles: ["tests/subscription-cancellation.test.ts"],
      },
    ],
    summary: {
      affectedTests: 1,
      automatedSteps: 1,
      manualSteps: 0,
      selectedRequirements: 1,
      unavailableSteps: 0,
    },
    uncoveredRequirements: [],
  };
}

function run(status: "failed" | "passed" | "unavailable" = "failed"): VerificationRun {
  const resultStatus = status === "unavailable" ? "unavailable" : status;
  return {
    artifactDirectory: RUN_DIRECTORY,
    completedAt: NOW.toISOString(),
    generatedTests: [],
    planPath: ".maru/generated/verification-plan.json",
    results: [
      {
        adapter: "vitest",
        artifacts: {
          stderr: `${RUN_DIRECTORY}/vitest/stderr.txt`,
          stdout: `${RUN_DIRECTORY}/vitest/stdout.txt`,
        },
        blocking: true,
        durationMs: 31,
        ...(status === "unavailable"
          ? {
              error: {
                code: "VITEST_NOT_INSTALLED",
                message: "Vitest is not installed in this project.",
                remediation: "Install Vitest, then retry.",
              },
            }
          : {}),
        exitCode: status === "passed" ? 0 : status === "failed" ? 1 : null,
        requirementRefs: ["subscription-management#SUB-004"],
        status: resultStatus,
        stepIds: ["step-01-contract-regression"],
        testFiles: ["tests/subscription-cancellation.test.ts"],
      },
    ],
    schemaVersion: 1,
    startedAt: NOW.toISOString(),
    status: status === "unavailable" ? "incomplete" : status,
    summary: {
      blockingFailures: status === "passed" ? 0 : 1,
      error: 0,
      failed: status === "failed" ? 1 : 0,
      passed: status === "passed" ? 1 : 0,
      skipped: 0,
      unavailable: status === "unavailable" ? 1 : 0,
    },
  };
}

describe("verification evidence and findings", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  it("turns a blocking failed test into traceable evidence and a complete critical finding", () => {
    const report = buildVerificationReport({
      diagnostics: [
        'AssertionError: expected "free" to be "pro". Received: "free".',
      ],
      generatedAt: NOW.toISOString(),
      plan: plan(),
      run: run("failed"),
    });

    expect(report.gate).toMatchObject({ status: "blocked" });
    expect(report.evidence).toEqual([
      expect.objectContaining({
        adapter: "vitest",
        artifactRefs: expect.arrayContaining([expect.stringContaining("stderr.txt")]),
        categories: ["contract-regression"],
        requirementRefs: ["subscription-management#SUB-004"],
        status: "failed",
        type: "unit-test",
      }),
    ]);
    expect(report.requirementEvidence).toEqual([
      expect.objectContaining({
        blocking: true,
        contractId: "subscription-management",
        evidenceIds: [report.evidence[0]?.id],
        requirementId: "SUB-004",
        status: "failed",
      }),
    ]);
    expect(report.findings).toEqual([
      expect.objectContaining({
        actual: expect.stringContaining('Received: "free"'),
        blocking: true,
        contractId: "subscription-management",
        evidenceIds: [report.evidence[0]?.id],
        expected: "Cancellation keeps Pro access active until period_end.",
        kind: "requirement-failure",
        reproduction: expect.objectContaining({ command: "maru verify --diff" }),
        requirementId: "SUB-004",
        severity: "critical",
        status: "open",
      }),
    ]);
    for (const finding of report.findings.filter((item) => item.blocking)) {
      expect(finding).toMatchObject({
        actual: expect.any(String),
        contractId: expect.any(String),
        evidenceIds: expect.arrayContaining([expect.any(String)]),
        expected: expect.any(String),
        reproduction: {
          command: expect.any(String),
          steps: expect.arrayContaining([expect.any(String)]),
        },
        requirementId: expect.any(String),
      });
    }
  });

  it("maps successful evidence without creating a finding or blocking the gate", () => {
    const report = buildVerificationReport({
      diagnostics: ["1 test passed"],
      generatedAt: NOW.toISOString(),
      plan: plan(),
      run: run("passed"),
    });

    expect(report.gate.status).toBe("passed");
    expect(report.evidence[0]?.status).toBe("passed");
    expect(report.requirementEvidence[0]?.status).toBe("passed");
    expect(report.findings).toEqual([]);
  });

  it("reports missing tooling as inconclusive evidence instead of a confirmed product failure", () => {
    const report = buildVerificationReport({
      diagnostics: [""],
      generatedAt: NOW.toISOString(),
      plan: plan(),
      run: run("unavailable"),
    });

    expect(report.evidence[0]).toMatchObject({ status: "inconclusive" });
    expect(report.requirementEvidence[0]).toMatchObject({ status: "inconclusive" });
    expect(report.findings[0]).toMatchObject({
      actual: "Vitest is not installed in this project.",
      blocking: true,
      kind: "verification-gap",
      severity: "high",
    });
    expect(report.gate.status).toBe("blocked");
  });

  it("links archived generated tests into their adapter evidence", () => {
    const failedRun = run("failed");
    const report = buildVerificationReport({
      diagnostics: ["Received: free"],
      generatedAt: NOW.toISOString(),
      plan: plan(),
      run: {
        ...failedRun,
        generatedTests: [
          {
            adapter: "vitest",
            artifactPath: `${RUN_DIRECTORY}/generated/vitest-cancellation.test.ts`,
            id: "cancellation",
            requirementRefs: ["subscription-management#SUB-004"],
            targetPath: "tests/.maru-cancellation.test.ts",
          },
        ],
      },
    });

    expect(report.evidence[0]?.artifactRefs).toContain(
      `${RUN_DIRECTORY}/generated/vitest-cancellation.test.ts`,
    );
  });

  it("blocks an unlinked raw blocking failure without inventing a contract violation", () => {
    const inputPlan = plan();
    const unavailableRun = run("unavailable");
    const report = buildVerificationReport({
      generatedAt: NOW.toISOString(),
      plan: {
        ...inputPlan,
        selectedRequirements: [],
        steps: inputPlan.steps.map((item) => ({ ...item, requirementRefs: [] })),
      },
      run: {
        ...unavailableRun,
        results: unavailableRun.results.map((item) => ({ ...item, requirementRefs: [] })),
      },
    });

    expect(report.gate).toMatchObject({
      reasons: expect.arrayContaining([expect.stringContaining("raw blocking")]),
      status: "blocked",
    });
    expect(report.findings).toEqual([
      expect.objectContaining({ blocking: false, contractId: undefined }),
    ]);
  });

  it("writes stable JSON and a readable terminal summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-evidence-"));
    temporaryDirectories.push(root);
    const report = buildVerificationReport({
      diagnostics: ["Received: free"],
      generatedAt: NOW.toISOString(),
      plan: plan(),
      run: run("failed"),
    });

    const path = await writeVerificationReport(root, report);
    const terminal = formatVerificationReport({ path, report });

    await expect(readFile(join(root, path), "utf8")).resolves.toContain(
      '"requirementId": "SUB-004"',
    );
    expect(path).toBe(`${RUN_DIRECTORY}/report.json`);
    expect(terminal).toContain("Verification gate: BLOCKED");
    expect(terminal).toContain("[CRITICAL] BLOCKING");
    expect(terminal).toContain("Contract: subscription-management");
    expect(terminal).toContain("Requirement: SUB-004");
    expect(terminal).toContain("Expected: Cancellation keeps Pro access active until period_end.");
    expect(terminal).toContain("Actual: Received: free");
    expect(terminal).toContain("Reproduce: maru verify --diff");
    expect(terminal).toContain(`JSON report: ${path}`);
  });

  it("orchestrates planning, execution, diagnostic reads, and report persistence", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-evidence-orchestration-"));
    temporaryDirectories.push(root);
    const stderrPath = join(root, RUN_DIRECTORY, "vitest/stderr.txt");
    await mkdir(join(stderrPath, ".."), { recursive: true });
    await writeFile(stderrPath, "Received: active instead of cancelled", "utf8");
    const planned: VerificationPlanResult = {
      path: ".maru/generated/verification-plan.json",
      plan: plan(),
    };
    const executed: VerificationRunResult = {
      path: `${RUN_DIRECTORY}/run.json`,
      run: run("failed"),
    };
    const createPlan = vi.fn().mockResolvedValue(planned);
    const runPlan = vi.fn().mockResolvedValue(executed);

    const result = await createAndWriteVerificationReport(root, NOW, { createPlan, runPlan });

    expect(createPlan).toHaveBeenCalledWith(root, NOW);
    expect(runPlan).toHaveBeenCalledWith(root, planned.plan, {
      now: expect.any(Function),
      planPath: planned.path,
      temporaryTests: [],
    });
    expect(result).toMatchObject({
      path: `${RUN_DIRECTORY}/report.json`,
      planPath: planned.path,
      report: {
        findings: [expect.objectContaining({ actual: "Received: active instead of cancelled" })],
      },
      runPath: executed.path,
    });
  });
});
