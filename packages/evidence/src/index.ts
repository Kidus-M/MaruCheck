import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  runVerificationPlan,
  type AdapterExecutionResult,
  type VerificationResultStatus,
} from "@maru/execution";
import {
  createAndWriteVerificationPlan,
  type SelectedRequirement,
  type VerificationPlan,
  type VerificationStep,
} from "@maru/planner";
import type { RecommendedTestCategory, RiskLevel } from "@maru/risk";
import type {
  AdvisoryFinding,
  BlockingFinding,
  BuildVerificationReportInput,
  CreateVerificationReportOptions,
  Evidence,
  EvidenceStatus,
  EvidenceType,
  Finding,
  FindingKind,
  FindingSeverity,
  RequirementEvidence,
  RequirementEvidenceStatus,
  VerificationReport,
  VerificationReportResult,
} from "./types.js";
import { VERIFICATION_REPORT_SCHEMA_VERSION } from "./types.js";

export * from "./types.js";

const MAX_DIAGNOSTIC_LENGTH = 500;

export class EvidenceReportError extends Error {
  public readonly code = "EVIDENCE_REPORT_WRITE_FAILED";
  public readonly remediation =
    "Inspect the raw run artifacts and check project directory permissions, then retry.";

  public constructor(options?: ErrorOptions) {
    super("Unable to create or persist the verification evidence report.", options);
    this.name = "EvidenceReportError";
  }
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function runId(artifactDirectory: string): string {
  return portablePath(artifactDirectory).split("/").filter(Boolean).at(-1) ?? "unknown-run";
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function diagnosticExcerpt(value: string, fallback: string): string {
  const lines = value
    .replaceAll("\u0000", "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred =
    lines.find((line) => /received:/iu.test(line)) ??
    lines.find((line) => /assertionerror|expected.+(?:to|but)/iu.test(line)) ??
    lines[0] ??
    fallback;
  return preferred.slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function evidenceStatus(status: VerificationResultStatus): EvidenceStatus {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  return "inconclusive";
}

function categoriesFor(
  result: AdapterExecutionResult,
  stepsById: ReadonlyMap<string, VerificationStep>,
): RecommendedTestCategory[] {
  return unique(
    result.stepIds
      .map((id) => stepsById.get(id)?.category)
      .filter((category): category is RecommendedTestCategory => category !== undefined),
  ) as RecommendedTestCategory[];
}

function evidenceType(
  adapter: AdapterExecutionResult["adapter"],
  categories: readonly RecommendedTestCategory[],
): EvidenceType {
  if (adapter === "manual-review") return "manual";
  if (categories.length === 1 && categories[0] === "accessibility") return "accessibility";
  if (adapter === "playwright" || categories.includes("e2e")) return "e2e-test";
  if (categories.length === 1 && categories[0] === "api") return "api-test";
  return "unit-test";
}

function artifactRefs(
  result: AdapterExecutionResult,
  generated: VerificationReport["artifacts"],
  generatedTestArtifacts: readonly string[],
): string[] {
  return unique([
    ...Object.values(result.artifacts).filter((path): path is string => path !== undefined),
    ...generatedTestArtifacts,
    generated.run,
  ]);
}

function resultEvidence(
  plan: VerificationPlan,
  run: BuildVerificationReportInput["run"],
  diagnostics: readonly string[],
  artifacts: VerificationReport["artifacts"],
): Evidence[] {
  const stepsById = new Map(plan.steps.map((step) => [step.id, step]));
  const id = runId(run.artifactDirectory);
  return run.results.map((result, index): Evidence => {
    const categories = categoriesFor(result, stepsById);
    const fallback =
      result.error?.message ??
      (result.status === "passed"
        ? `${result.adapter} completed successfully.`
        : `${result.adapter} returned ${result.status}.`);
    return {
      adapter: result.adapter,
      artifactRefs: artifactRefs(
        result,
        artifacts,
        run.generatedTests
          .filter((test) => test.adapter === result.adapter)
          .map((test) => test.artifactPath),
      ),
      categories,
      createdAt: run.completedAt,
      diagnostic: diagnosticExcerpt(diagnostics[index] ?? "", fallback),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      id: `evidence-${String(index + 1).padStart(3, "0")}-${safeId(result.adapter)}`,
      requirementRefs: unique(result.requirementRefs),
      runId: id,
      status: evidenceStatus(result.status),
      stepIds: unique(result.stepIds),
      testFiles: unique(result.testFiles),
      tool: result.adapter,
      type: evidenceType(result.adapter, categories),
    };
  });
}

function requirementRef(requirement: SelectedRequirement): string {
  return `${requirement.contractId}#${requirement.id}`;
}

function requirementStatus(evidence: readonly Evidence[]): RequirementEvidenceStatus {
  if (evidence.length === 0) return "unverified";
  if (evidence.some((item) => item.status === "failed")) return "failed";
  if (evidence.some((item) => item.status === "inconclusive")) return "inconclusive";
  return "passed";
}

function planningGapEvidence(
  reportRunId: string,
  requirement: SelectedRequirement,
  planPath: string,
  createdAt: string,
  index: number,
): Evidence {
  const reference = requirementRef(requirement);
  return {
    adapter: "planner",
    artifactRefs: [planPath],
    categories: [],
    createdAt,
    diagnostic: "No verification result referenced this selected requirement.",
    durationMs: 0,
    exitCode: null,
    id: `evidence-gap-${String(index + 1).padStart(3, "0")}-${safeId(reference)}`,
    requirementRefs: [reference],
    runId: reportRunId,
    status: "inconclusive",
    stepIds: [],
    testFiles: [],
    tool: "planner",
    type: "planning-gap",
  };
}

function severity(
  kind: FindingKind,
  blocking: boolean,
  risk: RiskLevel,
): FindingSeverity {
  if (kind === "requirement-failure") {
    if (blocking && risk === "critical") return "critical";
    if (blocking || risk === "critical" || risk === "high") return "high";
    return "medium";
  }
  if (kind === "execution-error") return blocking ? "high" : "medium";
  return blocking ? "high" : "low";
}

function findingKind(evidence: readonly Evidence[], status: RequirementEvidenceStatus): FindingKind {
  if (status === "failed") return "requirement-failure";
  if (
    evidence.some((item) =>
      /could not start|execution failed|exceeded.+timeout/iu.test(item.diagnostic),
    )
  ) {
    return "execution-error";
  }
  return "verification-gap";
}

function reproduction(
  requirement: RequirementEvidence | undefined,
  evidence: readonly Evidence[],
): Finding["reproduction"] {
  const files = unique(evidence.flatMap((item) => item.testFiles));
  return {
    command: "maru verify --diff",
    steps: [
      "Run verification from the project root with the same working-tree change.",
      ...(files.length === 0 ? [] : [`Inspect the selected test files: ${files.join(", ")}.`]),
      requirement === undefined
        ? "Inspect the linked raw artifacts for the adapter failure."
        : `Compare the observed result with ${requirement.requirementRef}: ${requirement.expected}`,
    ],
  };
}

function requirementFinding(
  requirement: RequirementEvidence,
  evidence: readonly Evidence[],
  risk: RiskLevel,
  index: number,
): Finding {
  const relevant = evidence.filter((item) => requirement.evidenceIds.includes(item.id));
  const observed =
    relevant.find((item) => item.status === "failed") ??
    relevant.find((item) => item.status === "inconclusive") ??
    relevant[0];
  const kind = findingKind(relevant, requirement.status);
  const common = {
    actual: observed?.diagnostic ?? "No verification evidence was produced.",
    artifactRefs: unique(relevant.flatMap((item) => item.artifactRefs)),
    evidenceIds: requirement.evidenceIds,
    explanation:
      kind === "requirement-failure"
        ? "A selected automated check failed while verifying this requirement."
        : kind === "execution-error"
          ? "The selected adapter could not complete, so this requirement remains unverified."
          : "The available verification was inconclusive, so this requirement remains unverified.",
    id: `finding-${String(index + 1).padStart(3, "0")}-${safeId(requirement.requirementRef)}`,
    kind,
    reproduction: reproduction(requirement, relevant),
    severity: severity(kind, requirement.blocking, risk),
    sourceLocations: unique(relevant.flatMap((item) => item.testFiles)).map((file) => ({ file })),
    status: "open" as const,
    title:
      kind === "requirement-failure"
        ? `${requirement.requirementId} verification failed`
        : `${requirement.requirementId} lacks conclusive verification`,
  };
  if (requirement.blocking) {
    const finding: BlockingFinding = {
      ...common,
      blocking: true,
      contractId: requirement.contractId,
      contractTitle: requirement.contractTitle,
      expected: requirement.expected,
      requirementId: requirement.requirementId,
      requirementRef: requirement.requirementRef,
    };
    return finding;
  }
  const finding: AdvisoryFinding = {
    ...common,
    blocking: false,
    contractId: requirement.contractId,
    contractTitle: requirement.contractTitle,
    expected: requirement.expected,
    requirementId: requirement.requirementId,
    requirementRef: requirement.requirementRef,
  };
  return finding;
}

function unlinkedFinding(evidence: Evidence, risk: RiskLevel, index: number): AdvisoryFinding {
  const kind: FindingKind = evidence.status === "failed" ? "requirement-failure" : "verification-gap";
  return {
    actual: evidence.diagnostic,
    artifactRefs: evidence.artifactRefs,
    blocking: false,
    evidenceIds: [evidence.id],
    explanation: "This non-passing execution result was not linked to a selected requirement.",
    id: `finding-unlinked-${String(index + 1).padStart(3, "0")}-${safeId(evidence.adapter)}`,
    kind,
    reproduction: reproduction(undefined, [evidence]),
    severity: severity(kind, false, risk),
    sourceLocations: evidence.testFiles.map((file) => ({ file })),
    status: "open",
    title: `${evidence.tool} produced an unlinked ${evidence.status} result`,
  };
}

function summary(
  evidence: readonly Evidence[],
  requirements: readonly RequirementEvidence[],
  findings: readonly Finding[],
): VerificationReport["summary"] {
  const evidenceCount = (status: EvidenceStatus): number =>
    evidence.filter((item) => item.status === status).length;
  const requirementCount = (status: RequirementEvidenceStatus): number =>
    requirements.filter((item) => item.status === status).length;
  return {
    blockingFindings: findings.filter((finding) => finding.blocking).length,
    evidence: evidence.length,
    failedEvidence: evidenceCount("failed"),
    findings: findings.length,
    inconclusiveEvidence: evidenceCount("inconclusive"),
    passedEvidence: evidenceCount("passed"),
    requirementsFailed: requirementCount("failed"),
    requirementsInconclusive: requirementCount("inconclusive"),
    requirementsPassed: requirementCount("passed"),
    requirementsUnverified: requirementCount("unverified"),
  };
}

/** Normalize one raw execution run into requirement evidence, findings, and a release gate. */
export function buildVerificationReport(input: BuildVerificationReportInput): VerificationReport {
  const id = runId(input.run.artifactDirectory);
  const artifacts = {
    plan: input.run.planPath,
    report: `${portablePath(input.run.artifactDirectory)}/report.json`,
    run: `${portablePath(input.run.artifactDirectory)}/run.json`,
  } as const;
  const evidence = resultEvidence(input.plan, input.run, input.diagnostics ?? [], artifacts);

  for (const [index, requirement] of input.plan.selectedRequirements.entries()) {
    const reference = requirementRef(requirement);
    if (!evidence.some((item) => item.requirementRefs.includes(reference))) {
      evidence.push(planningGapEvidence(id, requirement, artifacts.plan, input.generatedAt, index));
    }
  }

  const requirements: RequirementEvidence[] = input.plan.selectedRequirements.map((requirement) => {
    const reference = requirementRef(requirement);
    const linked = evidence.filter((item) => item.requirementRefs.includes(reference));
    const blocking =
      requirement.blocking ||
      input.plan.steps.some(
        (step) => step.blocking && step.requirementRefs.includes(reference),
      );
    return {
      blocking,
      contractId: requirement.contractId,
      contractTitle: requirement.contractTitle,
      evidenceIds: linked.map((item) => item.id),
      expected: requirement.statement,
      kind: requirement.kind,
      requirementId: requirement.id,
      requirementRef: reference,
      status: requirementStatus(linked),
    };
  });

  const findings: Finding[] = requirements
    .filter((requirement) => requirement.status !== "passed")
    .map((requirement, index) => requirementFinding(requirement, evidence, input.plan.risk.level, index));
  const linkedEvidenceIds = new Set(requirements.flatMap((requirement) => requirement.evidenceIds));
  findings.push(
    ...evidence
      .filter((item) => item.status !== "passed" && !linkedEvidenceIds.has(item.id))
      .map((item, index) => unlinkedFinding(item, input.plan.risk.level, index)),
  );

  const reportSummary = summary(evidence, requirements, findings);
  const reasons = [
    ...(input.run.status === "failed" || input.run.status === "error"
      ? [`The raw verification run ended with status ${input.run.status}.`]
      : []),
    ...(reportSummary.blockingFindings > 0
      ? [`${reportSummary.blockingFindings} blocking finding(s) remain open.`]
      : []),
  ];
  return {
    artifacts,
    evidence,
    findings,
    gate: { reasons, status: reasons.length > 0 ? "blocked" : "passed" },
    generatedAt: input.generatedAt,
    project: { name: input.plan.project.name },
    requirementEvidence: requirements,
    risk: input.plan.risk,
    runId: id,
    runStatus: input.run.status,
    schemaVersion: VERIFICATION_REPORT_SCHEMA_VERSION,
    summary: reportSummary,
  };
}

/** Serialize a report with stable indentation and a trailing newline. */
export function serializeVerificationReport(report: VerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function resolveInsideRoot(root: string, path: string): string {
  if (isAbsolute(path)) throw new EvidenceReportError();
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target === absoluteRoot || !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new EvidenceReportError();
  }
  return target;
}

/** Persist report.json next to the immutable raw run artifacts. */
export async function writeVerificationReport(
  root: string,
  report: VerificationReport,
): Promise<string> {
  try {
    const target = resolveInsideRoot(root, report.artifacts.report);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, serializeVerificationReport(report), "utf8");
    return portablePath(relative(resolve(root), target));
  } catch (error) {
    if (error instanceof EvidenceReportError) throw error;
    throw new EvidenceReportError({ cause: error });
  }
}

async function readDiagnostic(root: string, result: AdapterExecutionResult): Promise<string> {
  for (const path of [result.artifacts.stderr, result.artifacts.stdout]) {
    if (path === undefined) continue;
    try {
      const source = await readFile(resolveInsideRoot(root, path), "utf8");
      if (source.trim().length > 0) return source.slice(0, 4_000);
    } catch {
      // Missing diagnostics remain represented by the typed adapter status and error.
    }
  }
  return "";
}

/** Create the plan, execute it, normalize raw results, and persist report.json. */
export async function createAndWriteVerificationReport(
  root: string,
  now = new Date(),
  options: CreateVerificationReportOptions = {},
): Promise<VerificationReportResult> {
  const planned = await (options.createPlan ?? createAndWriteVerificationPlan)(root, now);
  const runOptions = {
    ...(options.commandRunner === undefined ? {} : { commandRunner: options.commandRunner }),
    now: options.now ?? (() => now),
    planPath: planned.path,
    temporaryTests: options.temporaryTests ?? [],
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  const executed = await (options.runPlan ?? runVerificationPlan)(root, planned.plan, runOptions);
  const diagnostics = await Promise.all(
    executed.run.results.map((result) => readDiagnostic(root, result)),
  );
  const report = buildVerificationReport({
    diagnostics,
    generatedAt: (options.now?.() ?? now).toISOString(),
    plan: planned.plan,
    run: executed.run,
  });
  const path = await writeVerificationReport(root, report);
  return {
    path,
    planPath: planned.path,
    report,
    run: executed.run,
    runPath: executed.path,
  };
}

function findingLines(finding: Finding): string[] {
  return [
    `[${finding.severity.toUpperCase()}] ${finding.blocking ? "BLOCKING" : "ADVISORY"} ${finding.id}: ${finding.title}`,
    ...(finding.contractId === undefined ? [] : [`Contract: ${finding.contractId}`]),
    ...(finding.requirementId === undefined ? [] : [`Requirement: ${finding.requirementId}`]),
    ...(finding.expected === undefined ? [] : [`Expected: ${finding.expected}`]),
    `Actual: ${finding.actual}`,
    `Reproduce: ${finding.reproduction.command}`,
    `Evidence: ${finding.evidenceIds.join(", ")}`,
    `Artifacts: ${finding.artifactRefs.join(", ") || "none"}`,
  ];
}

/** Render the human terminal view of a structured report without losing JSON traceability. */
export function formatVerificationReport(result: {
  readonly path: string;
  readonly report: VerificationReport;
}): string {
  const { report } = result;
  return [
    `Verification gate: ${report.gate.status.toUpperCase()}`,
    `Run: ${report.runId} (${report.runStatus})`,
    `Evidence: ${report.summary.evidence} (${report.summary.passedEvidence} passed, ${report.summary.failedEvidence} failed, ${report.summary.inconclusiveEvidence} inconclusive)`,
    `Requirements: ${report.summary.requirementsPassed} passed, ${report.summary.requirementsFailed} failed, ${report.summary.requirementsInconclusive} inconclusive, ${report.summary.requirementsUnverified} unverified`,
    `Findings: ${report.summary.findings} (${report.summary.blockingFindings} blocking)`,
    ...report.findings.flatMap((finding) => ["", ...findingLines(finding)]),
    "",
    `JSON report: ${result.path}`,
  ].join("\n");
}
