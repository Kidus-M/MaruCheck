import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CI_GITHUB_SUMMARY_PATH,
  installGitHubWorkflow,
  runPullRequestVerification,
} from "../packages/ci/dist/index.js";
import { runCli } from "../packages/cli/dist/cli.js";

const root = await mkdtemp(join(tmpdir(), "maru-pr-acceptance-"));

try {
  await mkdir(join(root, ".maru"), { recursive: true });
  await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n", "utf8");
  const installed = await installGitHubWorkflow(root);
  if (!installed.created) throw new Error("Expected a new GitHub workflow.");

  const report = {
    artifacts: {
      plan: ".maru/generated/verification-plan.json",
      report: ".maru/artifacts/runs/pr-42/report.json",
      run: ".maru/artifacts/runs/pr-42/run.json",
    },
    evidence: [],
    findings: [
      {
        actual: "A user received another account's invoice.",
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
    requirementEvidence: [],
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
  const githubSummaryPath = join(root, "github-step-summary.md");
  const verificationReport = async () => ({
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
      status: "failed",
      summary: {
        blockingFailures: 1,
        error: 0,
        failed: 1,
        passed: 0,
        skipped: 0,
        unavailable: 0,
      },
    },
    runPath: report.artifacts.run,
  });
  const output = { error: console.error, log: console.log };
  const verification = await runPullRequestVerification(root, new Date(report.generatedAt), {
    githubStepSummaryPath,
    verificationReport,
  });
  const exitCode = await runCli(["ci", "verify"], output, {
    ciVerification: async () => verification,
    cwd: root,
    now: () => new Date(report.generatedAt),
  });

  if (exitCode !== 1) throw new Error(`Expected blocking exit code 1, received ${exitCode}.`);
  const artifactSummary = await readFile(join(root, CI_GITHUB_SUMMARY_PATH), "utf8");
  const githubSummary = await readFile(githubSummaryPath, "utf8");
  for (const value of [
    "BLOCKED",
    "invoice-access#INV-001",
    "Users can only read invoices owned by their account.",
    "A user received another account's invoice.",
  ]) {
    if (!artifactSummary.includes(value) || !githubSummary.includes(value)) {
      throw new Error(`Expected both summaries to include: ${value}`);
    }
  }
  console.log(
    "Acceptance passed: a blocking contract violation fails ProofLayer with a readable summary.",
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
