import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { getContract } from "@maru/contracts";
import type { ReasoningRequest, ReasoningUsage } from "@maru/reasoning";
import { assessProjectRisk, type RiskAssessment, type RiskLevel } from "@maru/risk";
import {
  CHALLENGE_ARTIFACT_DIRECTORY,
  CHALLENGE_REPORT_SCHEMA_VERSION,
  ChallengeError,
  type ChallengeActivation,
  type ChallengeReport,
  type ChallengeReportResult,
  type ChallengeUsage,
  type ContractRequirementContext,
  type CreateChallengeReportOptions,
} from "./model.js";
import { CHALLENGE_OUTPUT_SCHEMA, parseChallengeOutput } from "./validation.js";

export * from "./model.js";
export { CHALLENGE_OUTPUT_SCHEMA } from "./validation.js";

const DEFAULT_MAX_COST_USD = 1;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;

export function buildChallengeActivation(
  level: RiskLevel,
  options: { readonly explicit?: boolean; readonly releaseVerification?: boolean },
): ChallengeActivation {
  const triggers = [
    ...(level === "critical" ? (["critical-risk"] as const) : []),
    ...(level === "high" ? (["high-risk"] as const) : []),
    ...(options.explicit === true ? (["explicit-request"] as const) : []),
    ...(options.releaseVerification === true ? (["release-verification"] as const) : []),
  ];
  return { activated: triggers.length > 0, triggers };
}

async function loadContractRequirements(
  root: string,
  assessment: RiskAssessment,
): Promise<ContractRequirementContext[]> {
  const result: ContractRequirementContext[] = [];
  for (const match of assessment.relatedContracts) {
    const contract = await getContract(root, match.contractId);
    const selected = new Set([
      ...match.requirementIds,
      ...match.invariantIds,
      ...contract.evidencePolicy.blockingRequirements,
    ]);
    for (const requirement of contract.requirements) {
      if (selected.has(requirement.id)) {
        result.push({
          contractId: contract.id,
          id: requirement.id,
          kind: "requirement",
          statement: requirement.statement,
        });
      }
    }
    for (const invariant of contract.invariants) {
      if (selected.has(invariant.id)) {
        result.push({
          contractId: contract.id,
          id: invariant.id,
          kind: "invariant",
          statement: invariant.statement,
        });
      }
    }
  }
  return result.sort(
    (left, right) => left.contractId.localeCompare(right.contractId) || left.id.localeCompare(right.id),
  );
}

function request(
  reportId: string,
  assessment: RiskAssessment,
  requirements: readonly ContractRequirementContext[],
  maxOutputTokens: number,
): ReasoningRequest {
  return {
    input: {
      changedFiles: assessment.analysis.files.slice(0, 100).map((file) => ({
        additions: file.additions,
        classifications: file.classifications,
        deletions: file.deletions,
        hunks: file.hunks.slice(0, 20),
        path: file.path,
        status: file.status,
        symbols: file.symbols.slice(0, 50),
      })),
      historicalRisks: assessment.historicalRisks.slice(0, 20).map((item) => ({
        memoryId: item.memoryId,
        reasons: item.reasons,
        severity: item.severity,
        title: item.title,
      })),
      requirements: requirements.slice(0, 100),
      risk: {
        level: assessment.level,
        reasons: assessment.reasons.slice(0, 50),
        recommendedTestCategories: assessment.recommendedTestCategories,
        score: assessment.score,
      },
    },
    instructions: [
      "Act as an independent adversarial QA reviewer, not the implementation author.",
      "Ask what a normal verifier is most likely to miss under difficult or failure-inducing conditions.",
      "Focus on concrete counterexamples involving permissions, races, replay, timing, invalid transitions, boundaries, data integrity, and partial external failures.",
      "Treat approved requirements and invariants as immutable. Do not reinterpret them to match the implementation.",
      "Reference only the supplied requirement references and changed file paths.",
      "Do not output source code, shell commands, secrets, contract changes, pass/fail claims, or unsupported fields.",
    ].join(" "),
    maxOutputTokens,
    outputSchema: CHALLENGE_OUTPUT_SCHEMA,
    requestId: reportId,
    schemaVersion: 1,
    task: "challenger-analysis",
  };
}

function emptyUsage(): ChallengeUsage {
  return {
    calls: 0,
    durationMs: 0,
    estimatedCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function oneCallUsage(usage?: ReasoningUsage): ChallengeUsage {
  return {
    calls: 1,
    durationMs: usage?.durationMs ?? 0,
    estimatedCostUsd: usage?.estimatedCostUsd ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  };
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/gu, "");
}

function portable(path: string): string {
  return path.split(sep).join("/");
}

async function allocateReport(root: string, now: Date): Promise<{ absolute: string; path: string; runId: string }> {
  const absoluteRoot = resolve(root);
  const parent = resolve(absoluteRoot, ...CHALLENGE_ARTIFACT_DIRECTORY.split("/"));
  if (!parent.startsWith(`${absoluteRoot}${sep}`)) throw new ChallengeError(
    "CHALLENGE_WRITE_FAILED",
    "The Challenger artifact directory escapes the project root.",
    "Run MaruCheck from the project root.",
  );
  await mkdir(parent, { recursive: true });
  const base = `challenge-${timestamp(now)}`;
  for (let index = 0; index < 100; index += 1) {
    const runId = index === 0 ? base : `${base}-${index}`;
    const directory = resolve(parent, runId);
    try {
      await mkdir(directory);
      const absolute = resolve(directory, "report.json");
      return { absolute, path: portable(relative(absoluteRoot, absolute)), runId };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
  throw new ChallengeError(
    "CHALLENGE_WRITE_FAILED",
    "Unable to allocate a unique Challenger artifact directory.",
    "Retry with a later timestamp and check artifact-directory permissions.",
  );
}

function baseReport(
  runId: string,
  now: Date,
  assessment: RiskAssessment,
  activation: ChallengeActivation,
): Pick<
  ChallengeReport,
  "activation" | "generatedAt" | "project" | "risk" | "runId" | "schemaVersion" | "scope"
> {
  return {
    activation,
    generatedAt: now.toISOString(),
    project: { changedFiles: assessment.analysis.summary.changedFiles },
    risk: { level: assessment.level, score: assessment.score },
    runId,
    schemaVersion: CHALLENGE_REPORT_SCHEMA_VERSION,
    scope: "working-tree",
  };
}

async function persist(absolute: string, path: string, report: ChallengeReport): Promise<ChallengeReportResult> {
  try {
    await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { path, report };
  } catch (error) {
    throw new ChallengeError(
      "CHALLENGE_WRITE_FAILED",
      "Unable to persist the Challenger report.",
      "Check project directory permissions and available disk space.",
      { cause: error },
    );
  }
}

function validateOptions(maxCostUsd: number, maxOutputTokens: number): void {
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0 || maxCostUsd > 100) {
    throw new ChallengeError(
      "CHALLENGE_OPTIONS_INVALID",
      "The Challenger cost budget must be between 0 and 100 USD.",
      "Use --max-cost with a non-negative bounded amount.",
    );
  }
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 100 || maxOutputTokens > 10_000) {
    throw new ChallengeError(
      "CHALLENGE_OPTIONS_INVALID",
      "The Challenger output-token budget must be an integer from 100 to 10000.",
      "Use a bounded output-token budget.",
    );
  }
}

/** Run one policy-gated adversarial reasoning call and persist its validated report. */
export async function createAndWriteChallengeReport(
  root: string,
  now = new Date(),
  options: CreateChallengeReportOptions = {},
): Promise<ChallengeReportResult> {
  const maxCostUsd = options.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  validateOptions(maxCostUsd, maxOutputTokens);
  const assessment = await (options.assessRisk ?? assessProjectRisk)(root);
  const activation = buildChallengeActivation(assessment.level, options);
  const artifact = await allocateReport(root, now);
  const common = baseReport(artifact.runId, now, assessment, activation);

  if (!activation.activated) {
    return persist(artifact.absolute, artifact.path, {
      ...common,
      challenges: [],
      gate: { reasons: [], status: "passed" },
      provider: null,
      status: "skipped",
      summary: "Challenger reasoning was not activated for this change.",
      usage: emptyUsage(),
    });
  }

  if (options.provider === undefined) {
    return persist(artifact.absolute, artifact.path, {
      ...common,
      challenges: [],
      gate: {
        reasons: ["Challenger reasoning is required, but a reasoning provider is not configured."],
        status: "blocked",
      },
      provider: null,
      status: "unavailable",
      summary: "Required adversarial reasoning could not run.",
      usage: emptyUsage(),
    });
  }

  const requirements = await (options.contractRequirements ?? loadContractRequirements)(
    root,
    assessment,
  );
  let response: Awaited<ReturnType<typeof options.provider.reason>> | undefined;
  try {
    response = await options.provider.reason(
      request(artifact.runId, assessment, requirements, maxOutputTokens),
    );
  } catch {
    return persist(artifact.absolute, artifact.path, {
      ...common,
      challenges: [],
      gate: {
        reasons: ["The configured reasoning provider failed before producing a valid challenge."],
        status: "blocked",
      },
      provider: { id: options.provider.id, model: options.provider.model },
      status: "provider-error",
      summary: "Required adversarial reasoning failed safely.",
      usage: oneCallUsage(),
    });
  }

  const usage = oneCallUsage(response.usage);
  const provider = { id: options.provider.id, model: options.provider.model };
  if (usage.estimatedCostUsd !== null && usage.estimatedCostUsd > maxCostUsd) {
    return persist(artifact.absolute, artifact.path, {
      ...common,
      challenges: [],
      gate: {
        reasons: [
          `The reasoning call exceeded the $${maxCostUsd.toFixed(4)} budget; no further Challenger work is allowed.`,
        ],
        status: "blocked",
      },
      provider,
      status: "budget-exceeded",
      summary: "Adversarial reasoning exceeded the configured cost budget.",
      usage,
    });
  }

  try {
    const parsed = parseChallengeOutput(
      response.output,
      new Set(requirements.map((item) => `${item.contractId}#${item.id}`)),
      new Set(assessment.analysis.files.map((file) => file.path)),
    );
    return persist(artifact.absolute, artifact.path, {
      ...common,
      challenges: parsed.challenges,
      gate: { reasons: [], status: "passed" },
      provider,
      status: "completed",
      summary: parsed.summary,
      usage,
    });
  } catch {
    return persist(artifact.absolute, artifact.path, {
      ...common,
      challenges: [],
      gate: {
        reasons: ["The reasoning provider returned output that violated the Challenger schema or scope."],
        status: "blocked",
      },
      provider,
      status: "invalid-output",
      summary: "Invalid model output was rejected and was not treated as a finding.",
      usage,
    });
  }
}

/** Render the validated Challenger result without treating hypotheses as verified findings. */
export function formatChallengeReport(result: ChallengeReportResult): string {
  const { report } = result;
  return [
    `Challenger: ${report.status.toUpperCase()} (${report.gate.status.toUpperCase()})`,
    `Activation: ${report.activation.triggers.join(", ") || "not triggered"}`,
    `Risk: ${report.risk.level.toUpperCase()} (${report.risk.score}/100)`,
    `Provider: ${report.provider === null ? "none" : `${report.provider.id}/${report.provider.model}`}`,
    `Cost: ${report.usage.estimatedCostUsd === null ? "unknown" : `$${report.usage.estimatedCostUsd.toFixed(4)}`} · ${report.usage.totalTokens ?? "unknown"} tokens · ${report.usage.calls} call(s)`,
    `Challenges: ${report.challenges.length}`,
    ...report.challenges.flatMap((challenge) => [
      "",
      `[${challenge.priority.toUpperCase()}] ${challenge.title}`,
      `Counterexample: ${challenge.counterexample}`,
      `Why it may be missed: ${challenge.whyLikelyMissed}`,
      `Verify: ${challenge.verification.objective}`,
    ]),
    ...(report.gate.reasons.length === 0
      ? []
      : ["", ...report.gate.reasons.map((reason) => `BLOCKED: ${reason}`)]),
    "",
    `JSON report: ${result.path}`,
  ].join("\n");
}
