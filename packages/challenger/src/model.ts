import type { ReasoningProvider, ReasoningUsage } from "@maru/reasoning";
import type { RiskAssessment, RiskLevel } from "@maru/risk";

export const CHALLENGE_REPORT_SCHEMA_VERSION = 1;
export const CHALLENGE_ARTIFACT_DIRECTORY = ".maru/artifacts/challenges";

export type ChallengeTrigger =
  | "critical-risk"
  | "explicit-request"
  | "high-risk"
  | "release-verification";
export type ChallengeCategory =
  | "data-integrity"
  | "external-failure"
  | "input-boundary"
  | "invalid-state-transition"
  | "permission-abuse"
  | "race-condition"
  | "replay-attack"
  | "timing";
export type ChallengePriority = "critical" | "high" | "low" | "medium";
export type ChallengeVerificationCategory =
  | "api"
  | "e2e"
  | "integration"
  | "manual"
  | "security"
  | "unit";
export type ChallengeReportStatus =
  | "budget-exceeded"
  | "completed"
  | "invalid-output"
  | "provider-error"
  | "skipped"
  | "unavailable";

export interface ContractRequirementContext {
  readonly contractId: string;
  readonly id: string;
  readonly kind: "invariant" | "requirement";
  readonly statement: string;
}

export interface ChallengeCase {
  readonly category: ChallengeCategory;
  readonly counterexample: string;
  readonly id: string;
  readonly priority: ChallengePriority;
  readonly requirementRefs: readonly string[];
  readonly targetFiles: readonly string[];
  readonly title: string;
  readonly verification: {
    readonly category: ChallengeVerificationCategory;
    readonly objective: string;
    readonly steps: readonly string[];
  };
  readonly whyLikelyMissed: string;
}

export interface ChallengeActivation {
  readonly activated: boolean;
  readonly triggers: readonly ChallengeTrigger[];
}

export interface ChallengeUsage extends ReasoningUsage {
  readonly calls: 0 | 1;
}

export interface ChallengeReport {
  readonly activation: ChallengeActivation;
  readonly challenges: readonly ChallengeCase[];
  readonly generatedAt: string;
  readonly gate: {
    readonly reasons: readonly string[];
    readonly status: "blocked" | "passed";
  };
  readonly project: {
    readonly changedFiles: number;
  };
  readonly provider: { readonly id: string; readonly model: string } | null;
  readonly risk: { readonly level: RiskLevel; readonly score: number };
  readonly runId: string;
  readonly schemaVersion: 1;
  readonly scope: "working-tree";
  readonly status: ChallengeReportStatus;
  readonly summary: string;
  readonly usage: ChallengeUsage;
}

export interface ChallengeReportResult {
  readonly path: string;
  readonly report: ChallengeReport;
}

export interface CreateChallengeReportOptions {
  readonly assessRisk?: (root: string) => Promise<RiskAssessment>;
  readonly contractRequirements?: (
    root: string,
    assessment: RiskAssessment,
  ) => Promise<readonly ContractRequirementContext[]>;
  readonly explicit?: boolean;
  readonly maxCostUsd?: number;
  readonly maxOutputTokens?: number;
  readonly provider?: ReasoningProvider;
  readonly releaseVerification?: boolean;
}

export type ChallengeErrorCode = "CHALLENGE_OPTIONS_INVALID" | "CHALLENGE_WRITE_FAILED";

export class ChallengeError extends Error {
  public constructor(
    public readonly code: ChallengeErrorCode,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ChallengeError";
  }
}
