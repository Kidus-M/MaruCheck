import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { getContract } from "@maru/contracts";
import { assessProjectRisk, type RiskAssessment } from "@maru/risk";
import {
  CHALLENGE_ARTIFACT_DIRECTORY,
  CHALLENGE_BRIEF_SCHEMA_VERSION,
  CHALLENGE_REPORT_SCHEMA_VERSION,
  ChallengeError,
  type ChallengeActivation,
  type ChallengeBrief,
  type ChallengeBriefResult,
  type ChallengeReport,
  type ChallengeReportResult,
  type ContractRequirementContext,
  type PrepareChallengeOptions,
} from "./model.js";
import { CHALLENGE_RESPONSE_SCHEMA, parseChallengeSubmission } from "./validation.js";

const MAX_JSON_BYTES = 1_000_000;
const MAX_FILES = 100;
const MAX_HUNKS_PER_FILE = 20;
const MAX_SYMBOLS_PER_FILE = 50;
const MAX_HISTORICAL_RISKS = 20;
const MAX_REQUIREMENTS = 100;
const MAX_RISK_REASONS = 50;

function portable(path: string): string {
  return path.split(sep).join("/");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function withoutBriefHash(brief: Record<string, unknown>): Record<string, unknown> {
  const { briefHash: _briefHash, ...core } = brief;
  return core;
}

export function buildChallengeActivation(
  level: RiskAssessment["level"],
  options: Pick<PrepareChallengeOptions, "explicit" | "releaseVerification"> = {},
): ChallengeActivation {
  const triggers = [
    ...(level === "critical" ? (["critical-risk"] as const) : []),
    ...(level === "high" ? (["high-risk"] as const) : []),
    ...(options.explicit === true ? (["explicit-request"] as const) : []),
    ...(options.releaseVerification === true ? (["release-verification"] as const) : []),
  ];
  return { activated: triggers.length > 0, triggers };
}

async function defaultContractRequirements(
  root: string,
  assessment: RiskAssessment,
): Promise<readonly ContractRequirementContext[]> {
  const result: ContractRequirementContext[] = [];
  for (const match of assessment.relatedContracts) {
    const contract = await getContract(root, match.contractId);
    for (const requirement of contract.requirements) {
      if (match.requirementIds.length === 0 || match.requirementIds.includes(requirement.id)) {
        result.push({
          contractId: contract.id,
          id: requirement.id,
          kind: "requirement",
          statement: requirement.statement,
        });
      }
    }
    for (const invariant of contract.invariants) {
      if (match.invariantIds.length === 0 || match.invariantIds.includes(invariant.id)) {
        result.push({
          contractId: contract.id,
          id: invariant.id,
          kind: "invariant",
          statement: invariant.statement,
        });
      }
    }
  }
  return result.slice(0, MAX_REQUIREMENTS);
}

function briefId(now: Date): string {
  return `challenge-${now.toISOString().replaceAll(/[^0-9]/gu, "")}`;
}

async function allocateChallengeDirectory(root: string, id: string): Promise<string> {
  const base = resolve(root, CHALLENGE_ARTIFACT_DIRECTORY);
  try {
    await mkdir(base, { recursive: true });
    for (let suffix = 0; suffix < 1_000; suffix += 1) {
      const directory = resolve(base, suffix === 0 ? id : `${id}-${suffix}`);
      try {
        await mkdir(directory);
        return directory;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  } catch (error) {
    throw new ChallengeError(
      "CHALLENGE_WRITE_FAILED",
      "Unable to allocate a Challenger artifact directory.",
      "Check write permissions for .maru/artifacts/challenges, then retry.",
      { cause: error },
    );
  }
  throw new ChallengeError(
    "CHALLENGE_WRITE_FAILED",
    "Unable to allocate a unique Challenger artifact directory.",
    "Retry with a later timestamp.",
  );
}

/** Prepare a bounded, source-free QA brief for a fresh client thread or subagent. */
export async function prepareAndWriteChallengeBrief(
  root: string,
  now = new Date(),
  options: PrepareChallengeOptions = {},
): Promise<ChallengeBriefResult> {
  const assessment = await (options.assessRisk ?? assessProjectRisk)(root);
  const requirements = await (options.contractRequirements ?? defaultContractRequirements)(
    root,
    assessment,
  );
  const id = briefId(now);
  const activation = buildChallengeActivation(assessment.level, options);
  const core = {
    activation,
    briefId: id,
    context: {
      changedFiles: assessment.analysis.files.slice(0, MAX_FILES).map((file) => ({
        additions: file.additions,
        classifications: file.classifications,
        deletions: file.deletions,
        hunks: file.hunks.slice(0, MAX_HUNKS_PER_FILE),
        path: file.path,
        status: file.status,
        symbols: file.symbols.slice(0, MAX_SYMBOLS_PER_FILE),
      })),
      historicalRisks: assessment.historicalRisks.slice(0, MAX_HISTORICAL_RISKS).map((memory) => ({
        memoryId: memory.memoryId,
        reasons: memory.reasons,
        severity: memory.severity,
        title: memory.title,
      })),
      requirements: requirements.slice(0, MAX_REQUIREMENTS),
      riskReasons: assessment.reasons.slice(0, MAX_RISK_REASONS),
    },
    createdAt: now.toISOString(),
    instructions: [
      "Analyze this brief in a fresh thread, separate agent, or subagent without the builder conversation.",
      "Act as an adversarial QA reviewer and challenge the implementation assumptions represented by the bounded metadata.",
      "Return JSON only, matching responseSchema exactly; the enclosing client must add briefId, briefHash, and provenance before submission.",
      "Propose concrete counterexamples and verification objectives, not source code, shell commands, contract changes, pass/fail claims, or verified findings.",
      "Reference only requirement IDs and changed file paths present in this brief.",
    ],
    responseSchema: CHALLENGE_RESPONSE_SCHEMA,
    risk: { level: assessment.level, score: assessment.score },
    schemaVersion: CHALLENGE_BRIEF_SCHEMA_VERSION,
    scope: "working-tree",
  } as const;
  const brief: ChallengeBrief = { ...core, briefHash: hash(core) };
  const directory = await allocateChallengeDirectory(root, id);
  const target = resolve(directory, "brief.json");
  try {
    await writeFile(target, `${JSON.stringify(brief, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    throw new ChallengeError(
      "CHALLENGE_WRITE_FAILED",
      "Unable to write the Challenger brief.",
      "Check project artifact permissions, then retry.",
      { cause: error },
    );
  }
  return { brief, path: portable(relative(resolve(root), target)) };
}

function invalidBrief(message: string): never {
  throw new ChallengeError(
    "CHALLENGE_INVALID_BRIEF",
    message,
    "Prepare a new brief with MaruCheck and do not edit it before submission.",
  );
}

function resolvedProjectFile(root: string, path: string, kind: "brief" | "response"): string {
  if (path.trim().length === 0 || isAbsolute(path)) {
    return invalidBrief(`${kind} path must be project-relative.`);
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target === absoluteRoot || !target.startsWith(`${absoluteRoot}${sep}`)) {
    return invalidBrief(`${kind} path escapes the project root.`);
  }
  if (kind === "brief") {
    const relativePath = portable(relative(absoluteRoot, target));
    if (
      !relativePath.startsWith(`${CHALLENGE_ARTIFACT_DIRECTORY}/challenge-`) ||
      basename(target) !== "brief.json"
    ) {
      return invalidBrief("brief path must reference a generated Challenger brief artifact.");
    }
  }
  return target;
}

async function readBoundedJson(
  root: string,
  path: string,
  kind: "brief" | "response",
): Promise<unknown> {
  const target = resolvedProjectFile(root, path, kind);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) {
      return invalidBrief(
        `${kind} must be a regular JSON file no larger than ${MAX_JSON_BYTES} bytes.`,
      );
    }
    return JSON.parse(await readFile(target, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof ChallengeError) throw error;
    throw new ChallengeError(
      "CHALLENGE_READ_FAILED",
      `Unable to read the Challenger ${kind} JSON.`,
      `Confirm the ${kind} path is a readable JSON file inside the project, then retry.`,
      { cause: error },
    );
  }
}

function validateBrief(value: unknown): ChallengeBrief {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidBrief("Challenger brief must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const context = record.context;
  const risk = record.risk;
  if (
    record.schemaVersion !== CHALLENGE_BRIEF_SCHEMA_VERSION ||
    typeof record.briefId !== "string" ||
    !/^challenge-[a-z0-9-]+$/u.test(record.briefId) ||
    typeof record.briefHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.briefHash) ||
    typeof record.createdAt !== "string" ||
    record.scope !== "working-tree" ||
    typeof context !== "object" ||
    context === null ||
    Array.isArray(context) ||
    !Array.isArray((context as Record<string, unknown>).changedFiles) ||
    !Array.isArray((context as Record<string, unknown>).requirements) ||
    typeof risk !== "object" ||
    risk === null ||
    Array.isArray(risk)
  ) {
    return invalidBrief("Challenger brief has an invalid structure.");
  }
  if (hash(withoutBriefHash(record)) !== record.briefHash) {
    return invalidBrief("Challenger brief hash does not match its contents.");
  }
  return value as ChallengeBrief;
}

async function readChallengeBrief(root: string, briefPath: string): Promise<ChallengeBrief> {
  return validateBrief(await readBoundedJson(root, briefPath, "brief"));
}

/** Validate and persist a client-produced Challenger submission. */
export async function submitChallengeResponse(
  root: string,
  briefPath: string,
  submissionValue: unknown,
  now = new Date(),
): Promise<ChallengeReportResult> {
  const brief = await readChallengeBrief(root, briefPath);
  if (!brief.activation.activated) {
    throw new ChallengeError(
      "CHALLENGE_INACTIVE",
      "This brief was not activated by risk, an explicit request, or release verification.",
      "Prepare an explicit Challenger brief or use the deterministic verification workflow.",
    );
  }
  const allowedRequirementRefs = new Set(
    brief.context.requirements.map((item) => `${item.contractId}#${item.id}`),
  );
  const allowedFiles = new Set(brief.context.changedFiles.map((file) => file.path));
  const submission = parseChallengeSubmission(
    submissionValue,
    allowedRequirementRefs,
    allowedFiles,
  );
  if (submission.briefId !== brief.briefId || submission.briefHash !== brief.briefHash) {
    throw new ChallengeError(
      "CHALLENGE_INVALID_SUBMISSION",
      "Submission briefId or briefHash does not match the prepared brief.",
      "Submit the response with the exact identifiers from the corresponding brief.json.",
    );
  }
  const attested = submission.provenance.attested && submission.provenance.isolation !== "unknown";
  const reasons = attested
    ? []
    : ["The client did not attest that reasoning occurred in an isolated QA context."];
  const report: ChallengeReport = {
    brief: { hash: brief.briefHash, id: brief.briefId, path: portable(briefPath) },
    challenges: submission.result.challenges,
    gate: { reasons, status: attested ? "passed" : "blocked" },
    generatedAt: now.toISOString(),
    provenance: submission.provenance,
    risk: brief.risk,
    schemaVersion: CHALLENGE_REPORT_SCHEMA_VERSION,
    scope: "working-tree",
    status: attested ? "completed" : "unattested",
    summary: submission.result.summary,
  };
  const target = resolve(resolvedProjectFile(root, briefPath, "brief"), "..", "report.json");
  try {
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ChallengeError(
        "CHALLENGE_ALREADY_SUBMITTED",
        "This Challenger brief already has a report.",
        "Inspect the existing report or prepare a new brief for another independent review.",
        { cause: error },
      );
    }
    throw new ChallengeError(
      "CHALLENGE_WRITE_FAILED",
      "Unable to write the Challenger report.",
      "Check project artifact permissions, then retry.",
      { cause: error },
    );
  }
  return { path: portable(relative(resolve(root), target)), report };
}

/** Read a project-local response file, validate it, and persist the resulting report. */
export async function submitChallengeFromFile(
  root: string,
  briefPath: string,
  responsePath: string,
  now = new Date(),
): Promise<ChallengeReportResult> {
  const response = await readBoundedJson(root, responsePath, "response");
  return submitChallengeResponse(root, briefPath, response, now);
}

export function formatChallengeBrief(result: ChallengeBriefResult): string {
  const { brief } = result;
  return [
    `Challenger brief written: ${result.path}`,
    `Risk: ${brief.risk.level.toUpperCase()} (${brief.risk.score}/100)`,
    `Activation: ${brief.activation.activated ? brief.activation.triggers.join(", ") : "inactive"}`,
    `Context: ${brief.context.changedFiles.length} changed files, ${brief.context.requirements.length} protected requirements, ${brief.context.historicalRisks.length} historical risks`,
    `Brief hash: ${brief.briefHash}`,
    "Next: give brief.json to a fresh QA thread/subagent, save its attested JSON envelope, then run maru challenge submit --brief <brief.json> --from <response.json>.",
  ].join("\n");
}

export function formatChallengeReport(result: ChallengeReportResult): string {
  const { report } = result;
  const usage = report.provenance.usage;
  return [
    `Challenger: ${report.gate.status.toUpperCase()} (${report.status})`,
    `Report: ${result.path}`,
    `Reviewer: ${report.provenance.client}${report.provenance.model === undefined ? "" : ` / ${report.provenance.model}`}`,
    `Isolation: ${report.provenance.isolation} (${report.provenance.attested ? "attested" : "not attested"})`,
    `Usage: ${usage.source === "not-reported" ? "not reported" : `${usage.totalTokens ?? "unknown"} tokens, ${usage.estimatedCostUsd ?? "unknown"} USD`}`,
    `Challenge hypotheses: ${report.challenges.length}`,
    "These are review hypotheses, not verified findings or pass/fail evidence.",
  ].join("\n");
}

export { CHALLENGE_RESPONSE_SCHEMA, parseChallengeSubmission } from "./validation.js";
export * from "./model.js";
