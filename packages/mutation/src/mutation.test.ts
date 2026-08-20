import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerificationRunResult } from "@maru/execution";
import type { GitDiffAnalysis } from "@maru/git";
import type { VerificationPlan, VerificationPlanResult } from "@maru/planner";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatMutationReport,
  runMutationVerification,
  type MutationWorktreeManager,
} from "./index.js";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const SOURCE = `export function canRead(ownerId: string, userId: string) {
  if (ownerId !== userId) return false;
  return true;
}
`;

function analysis(path = "src/access.ts"): GitDiffAnalysis {
  return {
    clean: false,
    files: [
      {
        additions: 4,
        binary: false,
        classifications: ["authorization", "business-logic", "security-sensitive"],
        deletions: 1,
        hunks: [],
        path,
        status: "modified",
        symbols: ["canRead"],
      },
    ],
    summary: { additions: 4, changedFiles: 1, deletions: 1 },
  };
}

function plan(): VerificationPlanResult {
  const verificationPlan: VerificationPlan = {
    affectedTests: [
      {
        framework: "vitest",
        historicalMemoryIds: [],
        matchedTerms: ["access"],
        path: "tests/access.test.ts",
        requirementRefs: ["invoice-access#INV-001"],
      },
    ],
    changeSummary: { additions: 4, changedFiles: 1, deletions: 1 },
    generatedAt: NOW.toISOString(),
    historicalRegressions: [],
    project: { name: "access-service", testFrameworks: ["vitest"] },
    risk: { level: "critical", score: 92 },
    schemaVersion: 1,
    scope: "working-tree",
    selectedRequirements: [],
    steps: [
      {
        adapter: "vitest",
        blocking: true,
        category: "contract-regression",
        execution: "automated",
        id: "step-01-contract-regression",
        reasons: ["Critical authorization behavior changed."],
        requirementRefs: ["invoice-access#INV-001"],
        testFiles: ["tests/access.test.ts"],
      },
    ],
    summary: {
      affectedTests: 1,
      automatedSteps: 1,
      historicalRegressions: 0,
      manualSteps: 0,
      selectedRequirements: 0,
      unavailableSteps: 0,
    },
    uncoveredRequirements: [],
  };
  return { path: ".maru/generated/verification-plan.json", plan: verificationPlan };
}

async function runResult(
  root: string,
  index: number,
  status: "failed" | "passed",
): Promise<VerificationRunResult> {
  const directory = `.maru/artifacts/runs/run-${index}`;
  await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, directory, "run.json"), `{"status":"${status}"}\n`, "utf8");
  return {
    path: `${directory}/run.json`,
    run: {
      artifactDirectory: directory,
      completedAt: NOW.toISOString(),
      generatedTests: [],
      planPath: ".maru/generated/verification-plan.json",
      results: [
        {
          adapter: "vitest",
          artifacts: {},
          blocking: true,
          durationMs: 7,
          exitCode: status === "passed" ? 0 : 1,
          requirementRefs: ["invoice-access#INV-001"],
          status,
          stepIds: ["step-01-contract-regression"],
          testFiles: ["tests/access.test.ts"],
        },
      ],
      schemaVersion: 1,
      startedAt: NOW.toISOString(),
      status,
      summary: {
        blockingFailures: status === "passed" ? 0 : 1,
        error: 0,
        failed: status === "failed" ? 1 : 0,
        passed: status === "passed" ? 1 : 0,
        skipped: 0,
        unavailable: 0,
      },
    },
  };
}

describe("mutation verification orchestration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  async function fixture(): Promise<{
    cleaned: { value: boolean };
    root: string;
    worktrees: MutationWorktreeManager;
  }> {
    const root = await mkdtemp(join(tmpdir(), "maru-mutation-project-"));
    const worktree = await mkdtemp(join(tmpdir(), "maru-mutation-fixture-"));
    temporaryDirectories.push(root, worktree);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "access.ts"), SOURCE, "utf8");
    const cleaned = { value: false };
    return {
      cleaned,
      root,
      worktrees: {
        async create() {
          await cp(root, worktree, { recursive: true });
          return {
            path: worktree,
            async cleanup() {
              cleaned.value = true;
              await rm(worktree, { force: true, recursive: true });
            },
          };
        },
      },
    };
  }

  it("kills a detected ownership regression, blocks a survivor, archives runs, and cleans up", async () => {
    const project = await fixture();
    let call = 0;
    const runPlan = vi.fn().mockImplementation(async (root: string) => {
      call += 1;
      const current = await readFile(join(root, "src", "access.ts"), "utf8");
      if (call === 1) expect(current).toBe(SOURCE);
      const status = !current.includes("if (ownerId") ? "failed" : "passed";
      return runResult(root, call, status);
    });

    const result = await runMutationVerification(project.root, NOW, {
      analysis: async () => analysis(),
      createPlan: async () => plan(),
      maxMutations: 2,
      now: () => NOW,
      runPlan,
      worktrees: project.worktrees,
    });

    expect(result.report.summary).toEqual({
      candidates: 2,
      executed: 2,
      inconclusive: 0,
      killed: 1,
      survived: 1,
    });
    expect(result.report.gate).toMatchObject({ status: "blocked" });
    expect(result.report.mutations.map((mutation) => mutation.outcome)).toEqual([
      "killed",
      "survived",
    ]);
    expect(result.report.mutations[0]?.artifactRefs[0]).toContain("runs/MUT-0001");
    expect(formatMutationReport(result)).toContain("WEAK VERIFICATION DETECTED");
    expect(project.cleaned.value).toBe(true);
    await expect(readFile(join(project.root, "src", "access.ts"), "utf8")).resolves.toBe(SOURCE);
    await expect(readFile(join(project.root, result.path), "utf8")).resolves.toContain(
      '"survived": 1',
    );
  });

  it("does not execute mutants when baseline verification already fails", async () => {
    const project = await fixture();
    const runPlan = vi.fn().mockImplementation((root: string) => runResult(root, 1, "failed"));

    const result = await runMutationVerification(project.root, NOW, {
      analysis: async () => analysis(),
      createPlan: async () => plan(),
      now: () => NOW,
      runPlan,
      worktrees: project.worktrees,
    });

    expect(runPlan).toHaveBeenCalledTimes(1);
    expect(result.report.baseline).toMatchObject({ status: "inconclusive" });
    expect(result.report.mutations).toEqual([]);
    expect(result.report.gate.reasons[0]).toContain("Baseline verification did not pass");
    expect(project.cleaned.value).toBe(true);
  });

  it("reports an unsupported diff without creating a worktree", async () => {
    const project = await fixture();
    await writeFile(join(project.root, "src", "access.ts"), "export const answer = 42;\n", "utf8");
    const create = vi.fn();

    const result = await runMutationVerification(project.root, NOW, {
      analysis: async () => analysis(),
      createPlan: async () => plan(),
      now: () => NOW,
      worktrees: { create },
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.report.summary.candidates).toBe(0);
    expect(result.report.gate).toMatchObject({ status: "blocked" });
  });

  it("rejects unsafe limits and diff paths with actionable typed errors", async () => {
    const project = await fixture();

    await expect(
      runMutationVerification(project.root, NOW, {
        analysis: async () => analysis(),
        createPlan: async () => plan(),
        maxMutations: 0,
      }),
    ).rejects.toMatchObject({ code: "MUTATION_LIMIT_INVALID" });
    await expect(
      runMutationVerification(project.root, NOW, {
        analysis: async () => analysis("../outside.ts"),
        createPlan: async () => plan(),
      }),
    ).rejects.toMatchObject({ code: "MUTATION_PATH_INVALID" });
  });
});
