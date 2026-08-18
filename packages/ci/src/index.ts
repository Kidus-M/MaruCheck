import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  createAndWriteVerificationReport,
  type VerificationReport,
  type VerificationReportResult,
} from "@maru/evidence";

export const CI_GITHUB_WORKFLOW_PATH = ".github/workflows/marucheck.yml";
export const CI_GITHUB_SUMMARY_PATH = ".maru/generated/github-summary.md";

export type CiErrorCode =
  | "CI_NOT_INITIALIZED"
  | "CI_SUMMARY_WRITE_FAILED"
  | "CI_WORKFLOW_EXISTS"
  | "CI_WORKFLOW_WRITE_FAILED";

export class CiError extends Error {
  public constructor(
    public readonly code: CiErrorCode,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CiError";
  }
}

export interface GitHubWorkflowInstallResult {
  readonly created: boolean;
  readonly path: typeof CI_GITHUB_WORKFLOW_PATH;
}

export interface PullRequestVerificationOptions {
  readonly githubStepSummaryPath?: string;
  readonly verificationReport?: (root: string, now: Date) => Promise<VerificationReportResult>;
}

export interface PullRequestVerificationResult {
  readonly conclusion: "failure" | "success";
  readonly publishedToGitHub: boolean;
  readonly reportPath: string;
  readonly summaryPath: typeof CI_GITHUB_SUMMARY_PATH;
}

/** Return the deterministic pull-request workflow installed by `maru ci init`. */
export function createGitHubWorkflow(): string {
  return `name: MaruCheck

on:
  pull_request:

permissions:
  contents: read

concurrency:
  group: marucheck-\${{ github.workflow }}-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  prooflayer:
    name: ProofLayer
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Checkout pull request
        uses: actions/checkout@v7
        with:
          persist-credentials: false

      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Verify Quality Contracts
        run: npx --no-install maru ci verify

      - name: Upload verification evidence
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: marucheck-evidence-\${{ github.run_id }}-\${{ github.run_attempt }}
          path: |
            .maru/artifacts/
            .maru/generated/verification-plan.json
            .maru/generated/github-summary.md
          if-no-files-found: warn
          include-hidden-files: true
          retention-days: 14
`;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  );
}

async function initialized(root: string): Promise<boolean> {
  try {
    await access(join(resolve(root), ".maru", "maru.yml"));
    return true;
  } catch {
    return false;
  }
}

/** Install the GitHub workflow without overwriting user customization. */
export async function installGitHubWorkflow(root: string): Promise<GitHubWorkflowInstallResult> {
  if (!(await initialized(root))) {
    throw new CiError(
      "CI_NOT_INITIALIZED",
      "MaruCheck must be initialized before CI can be installed.",
      "Run maru init from the repository root, then run maru ci init again.",
    );
  }

  const target = join(resolve(root), ...CI_GITHUB_WORKFLOW_PATH.split("/"));
  const workflow = createGitHubWorkflow();
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, workflow, { encoding: "utf8", flag: "wx" });
    return { created: true, path: CI_GITHUB_WORKFLOW_PATH };
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      try {
        if ((await readFile(target, "utf8")) === workflow) {
          return { created: false, path: CI_GITHUB_WORKFLOW_PATH };
        }
      } catch (readError) {
        throw new CiError(
          "CI_WORKFLOW_WRITE_FAILED",
          `Unable to inspect ${CI_GITHUB_WORKFLOW_PATH}.`,
          "Check repository permissions and retry.",
          { cause: readError },
        );
      }
      throw new CiError(
        "CI_WORKFLOW_EXISTS",
        `${CI_GITHUB_WORKFLOW_PATH} already exists with different content.`,
        "Review the existing workflow and merge the MaruCheck steps manually; it was not overwritten.",
      );
    }
    throw new CiError(
      "CI_WORKFLOW_WRITE_FAILED",
      `Unable to write ${CI_GITHUB_WORKFLOW_PATH}.`,
      "Check repository permissions and available disk space, then retry.",
      { cause: error },
    );
  }
}

function safeInline(value: string, limit = 500): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replaceAll("`", "\\`")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

function findingSummary(report: VerificationReport): string[] {
  if (report.findings.length === 0) {
    return ["## Findings", "", "No open findings were produced."];
  }

  const visible = report.findings.slice(0, 20);
  const lines = visible.flatMap((finding) => [
    `### ${finding.severity.toUpperCase()} · ${finding.blocking ? "Blocking" : "Advisory"} · ${safeInline(finding.title)}`,
    "",
    ...(finding.requirementRef === undefined
      ? []
      : [`- Contract requirement: \`${safeInline(finding.requirementRef)}\``]),
    ...(finding.expected === undefined ? [] : [`- Expected: ${safeInline(finding.expected)}`]),
    `- Actual: ${safeInline(finding.actual)}`,
    `- Reproduce: \`${safeInline(finding.reproduction.command)}\``,
    `- Evidence: ${finding.artifactRefs.map((path) => `\`${safeInline(path)}\``).join(", ") || "none"}`,
    "",
  ]);
  if (report.findings.length > visible.length) {
    lines.push(
      `_${report.findings.length - visible.length} additional finding(s) are in the JSON report._`,
    );
  }
  return ["## Findings", "", ...lines];
}

/** Render a bounded Markdown summary suitable for `GITHUB_STEP_SUMMARY`. */
export function formatGitHubSummary(report: VerificationReport): string {
  const failed = report.gate.status === "blocked";
  const gate = failed ? "❌ BLOCKED" : "✅ PASSED";
  return [
    "# MaruCheck ProofLayer",
    "",
    `## ${gate}`,
    "",
    "| Result | Value |",
    "| --- | --- |",
    `| Project | ${safeInline(report.project.name)} |`,
    `| Risk | ${report.risk.level.toUpperCase()} (${report.risk.score}/100) |`,
    `| Run | \`${safeInline(report.runId)}\` (${report.runStatus}) |`,
    `| Evidence | ${report.summary.passedEvidence} passed, ${report.summary.failedEvidence} failed, ${report.summary.inconclusiveEvidence} inconclusive |`,
    `| Requirements | ${report.summary.requirementsPassed} passed, ${report.summary.requirementsFailed} failed, ${report.summary.requirementsInconclusive} inconclusive, ${report.summary.requirementsUnverified} unverified |`,
    `| Findings | ${report.summary.findings} total, ${report.summary.blockingFindings} blocking |`,
    "",
    ...(report.gate.reasons.length === 0
      ? []
      : [
          "## Gate reasons",
          "",
          ...report.gate.reasons.slice(0, 10).map((reason) => `- ${safeInline(reason)}`),
          "",
        ]),
    ...findingSummary(report),
    "",
    `Full JSON report: \`${safeInline(report.artifacts.report)}\``,
    "",
  ].join("\n");
}

async function writeSummary(
  root: string,
  report: VerificationReport,
  githubStepSummaryPath?: string,
): Promise<boolean> {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, ...CI_GITHUB_SUMMARY_PATH.split("/"));
  if (!target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new CiError(
      "CI_SUMMARY_WRITE_FAILED",
      "The generated summary path escapes the project root.",
      "Run CI verification from the repository root.",
    );
  }
  const summary = formatGitHubSummary(report);
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, summary, "utf8");
    if (githubStepSummaryPath !== undefined && githubStepSummaryPath.trim().length > 0) {
      await appendFile(githubStepSummaryPath, summary, "utf8");
      return true;
    }
    return false;
  } catch (error) {
    throw new CiError(
      "CI_SUMMARY_WRITE_FAILED",
      "Unable to persist the pull-request verification summary.",
      "Check project and GitHub runner summary permissions, then retry.",
      { cause: error },
    );
  }
}

/** Execute verification, publish its summary, and map the gate to a GitHub check conclusion. */
export async function runPullRequestVerification(
  root: string,
  now = new Date(),
  options: PullRequestVerificationOptions = {},
): Promise<PullRequestVerificationResult> {
  const verification = await (options.verificationReport ?? createAndWriteVerificationReport)(
    root,
    now,
  );
  const publishedToGitHub = await writeSummary(
    root,
    verification.report,
    options.githubStepSummaryPath ?? process.env.GITHUB_STEP_SUMMARY,
  );
  return {
    conclusion: verification.report.gate.status === "blocked" ? "failure" : "success",
    publishedToGitHub,
    reportPath: verification.path,
    summaryPath: portablePath(relative(resolve(root), resolve(root, CI_GITHUB_SUMMARY_PATH))),
  };
}

function portablePath(path: string): typeof CI_GITHUB_SUMMARY_PATH {
  return path.split(sep).join("/") as typeof CI_GITHUB_SUMMARY_PATH;
}
