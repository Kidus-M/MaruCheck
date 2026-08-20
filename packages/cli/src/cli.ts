import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  ChallengeError,
  createAndWriteChallengeReport,
  formatChallengeReport,
  type ChallengeReportResult,
} from "@maru/challenger";
import {
  CiError,
  installGitHubWorkflow,
  runPullRequestVerification,
  type GitHubWorkflowInstallResult,
  type PullRequestVerificationResult,
} from "@maru/ci";
import {
  ContractError,
  approveContract,
  createContractFromRequirements,
  diffContracts,
  getContract,
  listContracts,
  serializeQualityContract,
  validateContracts,
} from "@maru/contracts";
import {
  defaultDoctorEnvironment,
  diagnoseProject,
  initializeProject,
  MARU_PRODUCT,
  ProjectError,
  scanProject,
  writeProjectScan,
  type DoctorEnvironment,
} from "@maru/core";
import {
  EvidenceReportError,
  createAndWriteVerificationReport,
  formatVerificationReport,
  type VerificationReportResult,
} from "@maru/evidence";
import { VerificationExecutionError } from "@maru/execution";
import {
  DriftError,
  approveContractAmendment,
  checkSemanticDrift,
  formatSemanticDriftReport,
  parseObservedBehaviors,
  proposeContractAmendment,
} from "@maru/drift";
import { GitAnalysisError } from "@maru/git";
import {
  MemoryError,
  createMemoryRecord,
  getMemoryRecord,
  listMemoryRecords,
  parseMemoryRecordInput,
  searchMemoryRecords,
} from "@maru/memory";
import { runStdioMcpServer } from "@maru/mcp-server";
import {
  MutationVerificationError,
  formatMutationReport,
  runMutationVerification,
  type MutationReportResult,
} from "@maru/mutation";
import {
  VerificationPlanError,
  createAndWriteVerificationPlan,
  type VerificationPlanResult,
} from "@maru/planner";
import { ReasoningError, reasoningProviderFromEnvironment } from "@maru/reasoning";
import { assessProjectRisk, type RiskAssessment } from "@maru/risk";

export interface CliOutput {
  error(message: string): void;
  log(message: string): void;
}

export interface CliDependencies {
  readonly challengeReport?: (
    root: string,
    now: Date,
    options: {
      readonly explicit: true;
      readonly maxCostUsd?: number;
      readonly maxOutputTokens?: number;
      readonly releaseVerification?: boolean;
    },
  ) => Promise<ChallengeReportResult>;
  readonly ciVerification?: (root: string, now: Date) => Promise<PullRequestVerificationResult>;
  readonly ciWorkflowInstaller?: (root: string) => Promise<GitHubWorkflowInstallResult>;
  readonly cwd?: string;
  readonly doctorEnvironment?: DoctorEnvironment;
  readonly mcpServer?: (root: string) => Promise<void>;
  readonly mutationVerification?: (
    root: string,
    now: Date,
    maxMutations?: number,
  ) => Promise<MutationReportResult>;
  readonly now?: () => Date;
  readonly riskAssessment?: (root: string) => Promise<RiskAssessment>;
  readonly verificationPlan?: (root: string, now: Date) => Promise<VerificationPlanResult>;
  readonly verificationReport?: (root: string, now: Date) => Promise<VerificationReportResult>;
}

const HELP = `${MARU_PRODUCT.name} — ${MARU_PRODUCT.positioning}

Usage: maru <command>

Commands:
  challenge  Run bounded independent adversarial reasoning for the current diff
  init       Initialize MaruCheck in the current repository
  scan       Inventory project architecture, routes, tests, and dependencies
  doctor     Diagnose local prerequisites and configuration
  contract   Create, validate, inspect, diff, and approve Quality Contracts
  drift      Check protected expectations and manage contract amendments
  memory     Record, list, search, and inspect historical QA knowledge
  mutate     Test selected verification by introducing isolated temporary mutations
  risk       Assess the current Git diff with deterministic rules
  plan       Create an inspectable verification plan for the current diff
  verify     Execute tests and write evidence, findings, and a JSON report
  ci         Install and run GitHub pull-request verification
  mcp        Run the local MaruCheck MCP server over stdio

Contract commands:
  maru contract create [--from requirements.md] [--id contract-id] [--title "Title"]
  maru contract validate [path]
  maru contract list
  maru contract show <id>
  maru contract diff <id-or-path> <id-or-path>
  maru contract approve <id> --by <owner>

Semantic drift commands:
  maru drift check --from observations.json
  maru drift propose <contract-id> --from observations.json --reason "Why" --by <proposer>
  maru drift approve <proposal-path> --by <contract-owner>

QA memory commands:
  maru memory add --from memory.json
  maru memory list
  maru memory search "authorization"
  maru memory show <MEM-id>

Risk commands:
  maru risk --diff

Planning commands:
  maru plan --diff

Verification commands:
  maru verify --diff

Mutation commands:
  maru mutate --diff [--max 20]

Challenger commands:
  maru challenge --diff [--release] [--max-cost 1] [--max-output-tokens 2000]

CI commands:
  maru ci init
  maru ci verify

Options:
  -h, --help       Show help
  -v, --version    Show version`;

function stackSummary(result: Awaited<ReturnType<typeof initializeProject>>): string {
  const detected = [
    result.stack.packageManager,
    ...result.stack.frameworks,
    ...result.stack.languages,
    ...result.stack.testFrameworks,
  ].filter((value) => value !== "unknown");
  return detected.length > 0 ? detected.join(", ") : "no supported stack markers";
}

function reportProjectError(error: ProjectError, output: CliOutput): void {
  output.error(
    `${error.code}\nOperation: ${error.operation}\n${error.message}\nFix: ${error.remediation}`,
  );
}

function reportContractError(error: ContractError, output: CliOutput): void {
  const issueLines = error.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
  output.error(
    `${error.code}\n${error.message}${issueLines.length === 0 ? "" : `\n${issueLines}`}\nFix: ${error.remediation}`,
  );
}

function reportGitError(error: GitAnalysisError, output: CliOutput): void {
  output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
}

function formatRiskAssessment(assessment: RiskAssessment): string {
  const related = assessment.relatedContracts.map((contract) => contract.contractId).join(", ");
  return [
    `Risk: ${assessment.level.toUpperCase()} (${assessment.score}/100)`,
    `Changed files: ${assessment.analysis.summary.changedFiles} (+${assessment.analysis.summary.additions} -${assessment.analysis.summary.deletions})`,
    `Related contracts: ${related.length === 0 ? "none" : related}`,
    `Historical risks: ${assessment.historicalRisks.length === 0 ? "none" : assessment.historicalRisks.map((memory) => memory.memoryId).join(", ")}`,
    "Why:",
    ...assessment.reasons.map((reason) => `  +${reason.points} ${reason.message}`),
    `Recommended tests: ${assessment.recommendedTestCategories.join(", ") || "none"}`,
  ].join("\n");
}

function formatVerificationPlan(result: VerificationPlanResult): string {
  const { plan } = result;
  return [
    `Verification plan written: ${result.path}`,
    `Risk: ${plan.risk.level.toUpperCase()} (${plan.risk.score}/100)`,
    `Requirements: ${plan.summary.selectedRequirements}`,
    `Affected tests: ${plan.summary.affectedTests}`,
    `Historical regressions: ${plan.summary.historicalRegressions}`,
    `Steps: ${plan.steps.length} (${plan.summary.automatedSteps} automated, ${plan.summary.manualSteps} manual, ${plan.summary.unavailableSteps} unavailable)`,
    `Uncovered requirements: ${plan.uncoveredRequirements.length}`,
  ].join("\n");
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ContractError(
      "CONTRACT_INVALID",
      `Missing value for ${name}.`,
      `Pass a value after ${name}.`,
    );
  }
  return value;
}

function challengeOptions(args: readonly string[]):
  | {
      readonly maxCostUsd?: number;
      readonly maxOutputTokens?: number;
      readonly releaseVerification?: boolean;
    }
  | undefined {
  if (args[0] !== "--diff") return undefined;
  let maxCostUsd: number | undefined;
  let maxOutputTokens: number | undefined;
  let releaseVerification = false;
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const name = args[index];
    if (name === undefined || seen.has(name)) return undefined;
    seen.add(name);
    if (name === "--release") {
      releaseVerification = true;
      continue;
    }
    if (name !== "--max-cost" && name !== "--max-output-tokens") return undefined;
    const raw = args[index + 1];
    if (raw === undefined || raw.startsWith("--")) return undefined;
    index += 1;
    const value = Number(raw);
    if (name === "--max-cost") {
      if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
      maxCostUsd = value;
    } else {
      if (!Number.isSafeInteger(value) || value < 100 || value > 10_000) return undefined;
      maxOutputTokens = value;
    }
  }
  return {
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(releaseVerification ? { releaseVerification: true } : {}),
  };
}

function resolveInsideRoot(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new ContractError(
      "CONTRACT_ID_INVALID",
      `Path escapes the project root: ${path}`,
      "Use a requirements file inside the project root.",
    );
  }
  return target;
}

async function runContractCommand(
  args: readonly string[],
  root: string,
  output: CliOutput,
  now: Date,
): Promise<number> {
  const [action, ...actionArgs] = args;
  if (action === "create") {
    const sourcePath = option(actionArgs, "--from");
    const requirements =
      sourcePath === undefined
        ? "The feature must satisfy its approved requirements and preserve expected behavior."
        : await readFile(resolveInsideRoot(root, sourcePath), "utf8");
    const result = await createContractFromRequirements(root, requirements, {
      id: option(actionArgs, "--id"),
      now,
      title: option(actionArgs, "--title"),
    });
    output.log(
      `Draft contract created: ${result.path}\nVersion: ${result.versionHash}\nReview the draft before approval.`,
    );
    return 0;
  }

  if (action === "list") {
    const contracts = await listContracts(root);
    output.log(
      contracts.length === 0
        ? "No Quality Contracts found."
        : contracts
            .map(
              (contract) =>
                `${contract.id}\t${contract.status}\t${contract.criticality}\t${contract.versionHash.slice(0, 12)}`,
            )
            .join("\n"),
    );
    return 0;
  }

  if (action === "show") {
    const id = actionArgs[0];
    if (id === undefined) {
      throw new ContractError(
        "CONTRACT_INVALID",
        "A contract identifier is required.",
        "Run maru contract show <id>.",
      );
    }
    output.log(serializeQualityContract(await getContract(root, id)).trimEnd());
    return 0;
  }

  if (action === "validate") {
    const report = await validateContracts(root, actionArgs[0]);
    for (const invalid of report.invalid) {
      output.error(
        `${invalid.path}\n${invalid.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`,
      );
    }
    output.log(
      `Contracts valid: ${report.valid.length}\nContracts invalid: ${report.invalid.length}`,
    );
    return report.invalid.length === 0 ? 0 : 1;
  }

  if (action === "diff") {
    const [left, right] = actionArgs;
    if (left === undefined || right === undefined) {
      throw new ContractError(
        "CONTRACT_INVALID",
        "Two contract identifiers or paths are required.",
        "Run maru contract diff <id-or-path> <id-or-path>.",
      );
    }
    const result = await diffContracts(root, left, right);
    output.log(
      [
        `Contract diff: ${result.classification}`,
        ...result.changes.map(
          (item) => `${item.semantic ? "SEMANTIC" : "MECHANICAL"} ${item.kind} ${item.path}`,
        ),
      ].join("\n"),
    );
    return 0;
  }

  if (action === "approve") {
    const id = actionArgs[0];
    const approvedBy = option(actionArgs, "--by");
    if (id === undefined || approvedBy === undefined) {
      throw new ContractError(
        "CONTRACT_INVALID",
        "A contract identifier and approver are required.",
        "Run maru contract approve <id> --by <owner>.",
      );
    }
    const result = await approveContract(root, id, { approvedAt: now, approvedBy });
    output.log(
      `Contract approved: ${result.contract.id}\nVersion: ${result.versionHash}\nSnapshot: .maru/contracts/.history/${result.contract.id}/${result.versionHash}.yml`,
    );
    return 0;
  }

  throw new ContractError(
    "CONTRACT_INVALID",
    `Unknown contract command: ${action ?? "(missing)"}`,
    "Run maru --help for contract command usage.",
  );
}

async function observationsFromFile(root: string, path: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolveInsideRoot(root, path), "utf8")) as unknown;
  } catch (error) {
    throw new DriftError(
      "DRIFT_INVALID_INPUT",
      `Unable to read observations from ${path}.`,
      "Provide a valid JSON file inside the project root.",
      { cause: error },
    );
  }
  return parseObservedBehaviors(parsed);
}

async function runDriftCommand(
  args: readonly string[],
  root: string,
  output: CliOutput,
  now: Date,
): Promise<number> {
  const [action, ...actionArgs] = args;
  if (action === "check") {
    const sourcePath = option(actionArgs, "--from");
    if (sourcePath === undefined) {
      throw new DriftError(
        "DRIFT_INVALID_INPUT",
        "An observations file is required.",
        "Run maru drift check --from observations.json.",
      );
    }
    const summaries = await listContracts(root);
    const contracts = await Promise.all(summaries.map((item) => getContract(root, item.id)));
    const report = checkSemanticDrift(contracts, await observationsFromFile(root, sourcePath), now);
    output.log(formatSemanticDriftReport(report));
    return report.gate.status === "blocked" ? 1 : 0;
  }

  if (action === "propose") {
    const contractId = actionArgs[0];
    const sourcePath = option(actionArgs, "--from");
    const reason = option(actionArgs, "--reason");
    const proposedBy = option(actionArgs, "--by");
    if (
      contractId === undefined ||
      sourcePath === undefined ||
      reason === undefined ||
      proposedBy === undefined
    ) {
      throw new DriftError(
        "DRIFT_INVALID_INPUT",
        "A contract, observations file, reason, and proposer are required.",
        'Run maru drift propose <contract-id> --from observations.json --reason "Why" --by <proposer>.',
      );
    }
    const result = await proposeContractAmendment(
      root,
      contractId,
      await observationsFromFile(root, sourcePath),
      { now, proposedBy, reason },
    );
    output.log(
      `Amendment proposed: ${result.path}\nSemantic changes: ${result.proposal.changes.filter((item) => item.semantic).length}\nApproval required from: ${result.proposal.approval.eligibleApprovers.join(", ") || "an accountable owner"}\nThe current contract was not changed.`,
    );
    return 0;
  }

  if (action === "approve") {
    const proposalPath = actionArgs[0];
    const approvedBy = option(actionArgs, "--by");
    if (proposalPath === undefined || approvedBy === undefined) {
      throw new DriftError(
        "DRIFT_APPROVAL_REQUIRED",
        "A proposal path and approving contract owner are required.",
        "Run maru drift approve <proposal-path> --by <contract-owner>.",
      );
    }
    const result = await approveContractAmendment(root, proposalPath, { approvedBy, now });
    output.log(
      `Amendment approved: ${result.contract.id}\nVersion: ${result.versionHash}\nAudit: ${result.auditPath}`,
    );
    return 0;
  }

  throw new DriftError(
    "DRIFT_INVALID_INPUT",
    `Unknown drift command: ${action ?? "(missing)"}`,
    "Run maru --help for semantic drift command usage.",
  );
}

async function memoryInputFromFile(root: string, path: string) {
  try {
    return parseMemoryRecordInput(
      JSON.parse(await readFile(resolveInsideRoot(root, path), "utf8")) as unknown,
    );
  } catch (error) {
    if (error instanceof MemoryError) throw error;
    throw new MemoryError(
      "MEMORY_INVALID",
      `Unable to read QA memory input from ${path}.`,
      "Provide a valid JSON file inside the project root.",
      { cause: error },
    );
  }
}

async function runMemoryCommand(
  args: readonly string[],
  root: string,
  output: CliOutput,
  now: Date,
): Promise<number> {
  const [action, ...actionArgs] = args;
  if (action === "add") {
    const sourcePath = option(actionArgs, "--from");
    if (sourcePath === undefined) {
      throw new MemoryError(
        "MEMORY_INVALID",
        "A QA memory input file is required.",
        "Run maru memory add --from memory.json.",
      );
    }
    const result = await createMemoryRecord(root, await memoryInputFromFile(root, sourcePath), {
      now,
    });
    output.log(
      `QA memory recorded: ${result.record.id}\nSeverity: ${result.record.severity}\nPath: ${result.path}\nRegression tests: ${result.record.regressionTests.length}`,
    );
    return 0;
  }

  if (action === "list") {
    const records = await listMemoryRecords(root);
    output.log(
      records.length === 0
        ? "No QA memory records found."
        : records
            .map((record) => `${record.id}\t${record.severity}\t${record.type}\t${record.title}`)
            .join("\n"),
    );
    return 0;
  }

  if (action === "search") {
    const query = actionArgs.join(" ").trim();
    const matches = await searchMemoryRecords(root, query);
    output.log(
      [
        `Memory matches: ${matches.length}`,
        ...matches.map(
          (match) =>
            `${match.record.id}\t${match.record.severity}\t${match.record.title}\n  Terms: ${match.matchedTerms.join(", ")}\n  Fields: ${match.matchedFields.join(", ")}`,
        ),
      ].join("\n"),
    );
    return 0;
  }

  if (action === "show") {
    const id = actionArgs[0];
    if (id === undefined) {
      throw new MemoryError(
        "MEMORY_INVALID",
        "A QA memory identifier is required.",
        "Run maru memory show <MEM-id>.",
      );
    }
    output.log(JSON.stringify(await getMemoryRecord(root, id), null, 2));
    return 0;
  }

  throw new MemoryError(
    "MEMORY_INVALID",
    `Unknown memory command: ${action ?? "(missing)"}`,
    "Run maru --help for QA memory command usage.",
  );
}

/**
 * Execute a MaruCheck CLI command against a project directory.
 *
 * Returns a process-compatible exit code and reports only safe, actionable error details.
 */
export async function runCli(
  args: readonly string[],
  output: CliOutput,
  dependencies: CliDependencies = {},
): Promise<number> {
  const [command] = args;
  const root = dependencies.cwd ?? process.cwd();

  if (command === undefined || command === "--help" || command === "-h") {
    output.log(HELP);
    return Promise.resolve(0);
  }

  if (command === "--version" || command === "-v") {
    output.log("0.1.0");
    return Promise.resolve(0);
  }

  try {
    if (command === "init") {
      const result = await initializeProject(root);
      output.log(
        result.created
          ? `MaruCheck initialized.\nConfig: ${result.configPath}\nDetected: ${stackSummary(result)}\nNext: maru scan`
          : `MaruCheck is already initialized.\nConfig preserved: ${result.configPath}\nDetected: ${stackSummary(result)}`,
      );
      return 0;
    }

    if (command === "scan") {
      const scan = await scanProject(root, dependencies.now?.() ?? new Date());
      const outputPath = await writeProjectScan(root, scan);
      output.log(
        `Project scan written: ${outputPath}\nRoutes: ${scan.routes.length}\nTests: ${scan.tests.files.length}\nSource files: ${scan.source.fileCount}`,
      );
      return 0;
    }

    if (command === "doctor") {
      const report = await diagnoseProject(
        root,
        dependencies.doctorEnvironment ?? defaultDoctorEnvironment,
      );
      for (const check of report.checks) {
        const remediation = check.remediation === undefined ? "" : ` Fix: ${check.remediation}`;
        output.log(`${check.status.toUpperCase()} ${check.code}: ${check.details}${remediation}`);
      }
      output.log(
        report.ok
          ? "Doctor: all required checks passed."
          : "Doctor: one or more required checks failed.",
      );
      return report.ok ? 0 : 1;
    }

    if (command === "contract") {
      return await runContractCommand(
        args.slice(1),
        root,
        output,
        dependencies.now?.() ?? new Date(),
      );
    }

    if (command === "drift") {
      return await runDriftCommand(args.slice(1), root, output, dependencies.now?.() ?? new Date());
    }

    if (command === "memory") {
      return await runMemoryCommand(
        args.slice(1),
        root,
        output,
        dependencies.now?.() ?? new Date(),
      );
    }

    if (command === "risk") {
      if (args.length !== 2 || args[1] !== "--diff") {
        output.error("Invalid risk command.\nRun maru risk --diff.");
        return 1;
      }
      const assessment = await (dependencies.riskAssessment ?? assessProjectRisk)(root);
      output.log(formatRiskAssessment(assessment));
      return 0;
    }

    if (command === "plan") {
      if (args.length !== 2 || args[1] !== "--diff") {
        output.error("Invalid planning command.\nRun maru plan --diff.");
        return 1;
      }
      const result = await (dependencies.verificationPlan ?? createAndWriteVerificationPlan)(
        root,
        dependencies.now?.() ?? new Date(),
      );
      output.log(formatVerificationPlan(result));
      return 0;
    }

    if (command === "verify") {
      if (args.length !== 2 || args[1] !== "--diff") {
        output.error("Invalid verification command.\nRun maru verify --diff.");
        return 1;
      }
      const result = await (dependencies.verificationReport ?? createAndWriteVerificationReport)(
        root,
        dependencies.now?.() ?? new Date(),
      );
      output.log(formatVerificationReport(result));
      return result.report.gate.status === "blocked" ? 1 : 0;
    }

    if (command === "mutate") {
      const validShape =
        (args.length === 2 && args[1] === "--diff") ||
        (args.length === 4 && args[1] === "--diff" && args[2] === "--max");
      if (!validShape) {
        output.error("Invalid mutation command.\nRun maru mutate --diff [--max 20].");
        return 1;
      }
      const rawMaximum = args[3];
      const maximum = rawMaximum === undefined ? undefined : Number(rawMaximum);
      if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 1 || maximum > 100)) {
        output.error("Invalid mutation limit.\nPass --max with an integer from 1 to 100.");
        return 1;
      }
      const result = await (
        dependencies.mutationVerification ??
        ((projectRoot, generatedAt, maxMutations) =>
          runMutationVerification(projectRoot, generatedAt, { maxMutations }))
      )(root, dependencies.now?.() ?? new Date(), maximum);
      output.log(formatMutationReport(result));
      return result.report.gate.status === "blocked" ? 1 : 0;
    }

    if (command === "challenge") {
      const parsed = challengeOptions(args.slice(1));
      if (parsed === undefined) {
        output.error(
          "Invalid Challenger command.\nRun maru challenge --diff [--release] [--max-cost 1] [--max-output-tokens 2000].",
        );
        return 1;
      }
      const generatedAt = dependencies.now?.() ?? new Date();
      const result = await (
        dependencies.challengeReport ??
        ((projectRoot, date, options) =>
          createAndWriteChallengeReport(projectRoot, date, {
            ...options,
            provider: reasoningProviderFromEnvironment(),
          }))
      )(root, generatedAt, { explicit: true, ...parsed });
      output.log(formatChallengeReport(result));
      return result.report.gate.status === "blocked" ? 1 : 0;
    }

    if (command === "ci") {
      const action = args[1];
      if (args.length !== 2 || (action !== "init" && action !== "verify")) {
        output.error("Invalid CI command.\nRun maru ci init or maru ci verify.");
        return 1;
      }
      if (action === "init") {
        const result = await (dependencies.ciWorkflowInstaller ?? installGitHubWorkflow)(root);
        output.log(
          result.created
            ? `GitHub workflow installed: ${result.path}\nNext: commit the workflow and open a pull request.`
            : `GitHub workflow already installed: ${result.path}`,
        );
        return 0;
      }
      const result = await (
        dependencies.ciVerification ??
        (async (projectRoot, date) => {
          const provider = reasoningProviderFromEnvironment();
          return runPullRequestVerification(projectRoot, date, {
            ...(provider === undefined
              ? {}
              : {
                  challengeReport: (challengeRoot, challengeDate, challengeOptions) =>
                    createAndWriteChallengeReport(challengeRoot, challengeDate, {
                      ...challengeOptions,
                      provider,
                    }),
                }),
          });
        })
      )(root, dependencies.now?.() ?? new Date());
      output.log(
        [
          `ProofLayer: ${result.conclusion.toUpperCase()}`,
          `Evidence report: ${result.reportPath}`,
          ...(result.challengeReportPath === undefined
            ? []
            : [`Challenger report: ${result.challengeReportPath}`]),
          `GitHub summary: ${result.summaryPath}`,
          `Published to GitHub: ${result.publishedToGitHub ? "yes" : "no (local run)"}`,
        ].join("\n"),
      );
      return result.conclusion === "failure" ? 1 : 0;
    }

    if (command === "mcp") {
      await (
        dependencies.mcpServer ?? (async (projectRoot) => runStdioMcpServer({ root: projectRoot }))
      )(root);
      return 0;
    }
  } catch (error) {
    if (error instanceof ContractError) {
      reportContractError(error, output);
      return 1;
    }
    if (error instanceof ProjectError) {
      reportProjectError(error, output);
      return 1;
    }
    if (error instanceof GitAnalysisError) {
      reportGitError(error, output);
      return 1;
    }
    if (error instanceof VerificationPlanError) {
      output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
      return 1;
    }
    if (error instanceof VerificationExecutionError) {
      output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
      return 1;
    }
    if (error instanceof EvidenceReportError) {
      output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
      return 1;
    }
    if (error instanceof DriftError) {
      output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
      return 1;
    }
    if (error instanceof MemoryError) {
      output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
      return 1;
    }
    if (error instanceof MutationVerificationError) {
      output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
      return 1;
    }
    if (error instanceof ChallengeError || error instanceof ReasoningError) {
      output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
      return 1;
    }
    if (error instanceof CiError) {
      output.error(`${error.code}\n${error.message}\nFix: ${error.remediation}`);
      return 1;
    }

    output.error(
      "UNEXPECTED_ERROR\nOperation: run CLI command\nThe command failed unexpectedly.\nFix: Run maru doctor, then retry with a readable project directory.",
    );
    return 1;
  }

  output.error(`Unknown command: ${command}\nRun maru --help for usage.`);
  return 1;
}
