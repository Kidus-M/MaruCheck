import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerificationReport, VerificationReportResult } from "@maru/evidence";
import type { ChallengeReportResult } from "@maru/challenger";
import {
  CI_GITHUB_SUMMARY_PATH,
  CI_GITHUB_WORKFLOW_PATH,
  CiError,
  createGitHubWorkflow,
  formatGitHubSummary,
  installGitHubWorkflow,
  runPullRequestVerification,
} from "./index.js";

function blockedReport(): VerificationReport {
  return {
    artifacts: {
      plan: ".maru/generated/verification-plan.json",
      report: ".maru/artifacts/runs/pr-42/report.json",
      run: ".maru/artifacts/runs/pr-42/run.json",
    },
    evidence: [
      {
        adapter: "vitest",
        artifactRefs: [".maru/artifacts/runs/pr-42/vitest/stderr.txt"],
        categories: ["security"],
        createdAt: "2026-08-18T10:00:00.000Z",
        diagnostic: "Received another account's invoice <script>alert(1)</script>",
        durationMs: 15,
        exitCode: 1,
        id: "evidence-001-vitest",
        requirementRefs: ["invoice-access#INV-001"],
        runId: "pr-42",
        status: "failed",
        stepIds: ["step-01-security"],
        testFiles: ["tests/invoice-access.test.ts"],
        tool: "vitest",
        type: "unit-test",
      },
    ],
    findings: [
      {
        actual:
          "Received another account's invoice <script>alert(1)</script> [details](javascript:alert(1))",
        artifactRefs: [".maru/artifacts/runs/pr-42/vitest/stderr.txt"],
        blocking: true,
        contractId: "invoice-access",
        contractTitle: "Invoice access",
        evidenceIds: ["evidence-001-vitest"],
        expected: "Users can only read invoices owned by their account.",
        explanation: "The authorization contract was violated.",
        id: "finding-001-invoice-access-inv-001",
        kind: "requirement-failure",
        reproduction: {
          command: "maru verify --diff",
          steps: ["Run the cross-account invoice regression test."],
        },
        requirementId: "INV-001",
        requirementRef: "invoice-access#INV-001",
        severity: "critical",
        sourceLocations: [{ file: "tests/invoice-access.test.ts" }],
        status: "open",
        title: "Invoice ownership verification failed",
      },
    ],
    gate: { reasons: ["1 blocking finding remains open."], status: "blocked" },
    generatedAt: "2026-08-18T10:00:00.000Z",
    project: { name: "invoice-service" },
    requirementEvidence: [
      {
        blocking: true,
        contractId: "invoice-access",
        contractTitle: "Invoice access",
        evidenceIds: ["evidence-001-vitest"],
        expected: "Users can only read invoices owned by their account.",
        kind: "requirement",
        requirementId: "INV-001",
        requirementRef: "invoice-access#INV-001",
        status: "failed",
      },
    ],
    risk: { level: "critical", score: 95 },
    runId: "pr-42",
    runStatus: "failed",
    schemaVersion: 1,
    summary: {
      blockingFindings: 1,
      evidence: 1,
      failedEvidence: 1,
      findings: 1,
      inconclusiveEvidence: 0,
      passedEvidence: 0,
      requirementsFailed: 1,
      requirementsInconclusive: 0,
      requirementsPassed: 0,
      requirementsUnverified: 0,
    },
  };
}

function reportResult(report = blockedReport()): VerificationReportResult {
  return {
    path: report.artifacts.report,
    planPath: report.artifacts.plan,
    report,
    run: {
      artifactDirectory: ".maru/artifacts/runs/pr-42",
      completedAt: report.generatedAt,
      generatedTests: [],
      planPath: report.artifacts.plan,
      results: [],
      schemaVersion: 1,
      startedAt: report.generatedAt,
      status: report.runStatus,
      summary: { blockingFailures: 1, error: 0, failed: 1, passed: 0, skipped: 0, unavailable: 0 },
    },
    runPath: report.artifacts.run,
  };
}

function blockedChallenge(): ChallengeReportResult {
  return {
    path: ".maru/artifacts/challenges/challenge-pr-42/report.json",
    report: {
      activation: { activated: true, triggers: ["release-verification"] },
      challenges: [],
      gate: {
        reasons: ["The configured reasoning provider failed before producing a valid challenge."],
        status: "blocked",
      },
      generatedAt: "2026-08-20T20:20:00.000Z",
      project: { changedFiles: 1 },
      provider: { id: "gateway", model: "challenger" },
      risk: { level: "low", score: 10 },
      runId: "challenge-pr-42",
      schemaVersion: 1,
      scope: "working-tree",
      status: "provider-error",
      summary: "Required adversarial reasoning failed safely.",
      usage: {
        calls: 1,
        durationMs: 0,
        estimatedCostUsd: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    },
  };
}

describe("GitHub pull-request verification", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function project(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maru-ci-"));
    roots.push(root);
    await mkdir(join(root, ".maru"), { recursive: true });
    await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n", "utf8");
    return root;
  }

  it("generates a least-privilege npm workflow that uploads hidden evidence on every result", () => {
    const workflow = createGitHubWorkflow();

    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toMatch(/(?:issues|pull-requests): write/u);
    expect(workflow).toContain("actions/checkout@v7");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("actions/setup-node@v7");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npx --no-install maru ci verify");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("include-hidden-files: true");
    expect(workflow).toContain(".maru/artifacts/");
    expect(workflow).toContain(".maru/generated/github-summary.md");
  });

  it("installs the workflow idempotently and refuses to overwrite a customized workflow", async () => {
    const root = await project();

    await expect(installGitHubWorkflow(root)).resolves.toEqual({
      created: true,
      path: CI_GITHUB_WORKFLOW_PATH,
    });
    await expect(installGitHubWorkflow(root)).resolves.toEqual({
      created: false,
      path: CI_GITHUB_WORKFLOW_PATH,
    });
    await writeFile(join(root, CI_GITHUB_WORKFLOW_PATH), "name: Custom\n", "utf8");
    await expect(installGitHubWorkflow(root)).rejects.toMatchObject({
      code: "CI_WORKFLOW_EXISTS",
    });
  });

  it("requires MaruCheck initialization before installing CI", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-ci-uninitialized-"));
    roots.push(root);

    await expect(installGitHubWorkflow(root)).rejects.toBeInstanceOf(CiError);
    await expect(installGitHubWorkflow(root)).rejects.toMatchObject({
      code: "CI_NOT_INITIALIZED",
    });
  });

  it("renders a readable, escaped GitHub summary for a blocking contract violation", () => {
    const summary = formatGitHubSummary(blockedReport());

    expect(summary).toContain("# MaruCheck ProofLayer");
    expect(summary).toContain("BLOCKED");
    expect(summary).toContain("CRITICAL");
    expect(summary).toContain("invoice-access#INV-001");
    expect(summary).toContain("Users can only read invoices owned by their account.");
    expect(summary).toContain("maru verify --diff");
    expect(summary).toContain("&lt;script&gt;alert\\(1\\)&lt;/script&gt;");
    expect(summary).not.toContain("<script>");
    expect(summary).toContain("\\[details\\]\\(javascript:alert\\(1\\)\\)");
    expect(summary).not.toContain("[details](javascript:alert(1))");
  });

  it("shows opt-in Challenger status and cost without presenting hypotheses as findings", () => {
    const challenge = blockedChallenge();
    const summary = formatGitHubSummary(blockedReport(), challenge.report);

    expect(summary).toContain("## Challenger Agent");
    expect(summary).toContain("PROVIDER-ERROR");
    expect(summary).toContain("gateway/challenger");
    expect(summary).toContain("Cost | unknown");
    expect(summary).toContain("Hypotheses are review inputs, not verified findings");
  });

  it("writes the artifact summary, publishes it to GitHub, and returns a failed conclusion", async () => {
    const root = await project();
    const githubSummary = join(root, "github-step-summary.md");
    const verificationReport = vi.fn().mockResolvedValue(reportResult());

    const result = await runPullRequestVerification(root, new Date("2026-08-18T10:00:00Z"), {
      githubStepSummaryPath: githubSummary,
      verificationReport,
    });

    expect(result).toMatchObject({
      conclusion: "failure",
      publishedToGitHub: true,
      reportPath: ".maru/artifacts/runs/pr-42/report.json",
      summaryPath: CI_GITHUB_SUMMARY_PATH,
    });
    expect(verificationReport).toHaveBeenCalledWith(root, expect.any(Date));
    await expect(readFile(join(root, CI_GITHUB_SUMMARY_PATH), "utf8")).resolves.toContain(
      "Invoice ownership verification failed",
    );
    await expect(readFile(githubSummary, "utf8")).resolves.toContain("BLOCKED");
  });

  it("fails release verification when an enabled Challenger run fails closed", async () => {
    const root = await project();
    const passed = blockedReport();
    const report: VerificationReport = {
      ...passed,
      findings: [],
      gate: { reasons: [], status: "passed" },
      runStatus: "passed",
      summary: {
        ...passed.summary,
        blockingFindings: 0,
        failedEvidence: 0,
        findings: 0,
        passedEvidence: 1,
        requirementsFailed: 0,
        requirementsPassed: 1,
      },
    };
    const challengeReport = vi.fn().mockResolvedValue(blockedChallenge());

    const result = await runPullRequestVerification(root, new Date("2026-08-20T20:20:00Z"), {
      challengeReport,
      verificationReport: vi.fn().mockResolvedValue(reportResult(report)),
    });

    expect(challengeReport).toHaveBeenCalledWith(root, expect.any(Date), {
      releaseVerification: true,
    });
    expect(result).toMatchObject({
      challengeReportPath: ".maru/artifacts/challenges/challenge-pr-42/report.json",
      conclusion: "failure",
    });
    await expect(readFile(join(root, CI_GITHUB_SUMMARY_PATH), "utf8")).resolves.toContain(
      "Challenger Agent",
    );
  });
});
