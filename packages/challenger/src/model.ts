import type { RiskAssessment, RiskLevel } from "@maru/risk";

type MemoryRelevanceLevel = RiskAssessment["historicalRisks"][number]["relevance"]["level"];

export const CHALLENGE_BRIEF_SCHEMA_VERSION = 1;
export const CHALLENGE_REPORT_SCHEMA_VERSION = 1;
export const CHALLENGE_SUBMISSION_SCHEMA_VERSION = 1;
export const CHALLENGE_ARTIFACT_DIRECTORY = ".maru/artifacts/challenges";

export type ChallengeTrigger =
  "critical-risk" | "explicit-request" | "high-risk" | "release-verification";
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
  "api" | "e2e" | "integration" | "manual" | "security" | "unit";
export type ChallengeIsolation = "fresh-thread" | "separate-agent" | "subagent" | "unknown";

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

export interface ChallengeBrief {
  readonly activation: ChallengeActivation;
  readonly briefHash: string;
  readonly briefId: string;
  readonly context: {
    readonly changedFiles: readonly {
      readonly additions: number;
      readonly classifications: readonly string[];
      readonly deletions: number;
      readonly hunks: readonly {
        readonly context?: string;
        readonly newLines: number;
        readonly newStart: number;
        readonly oldLines: number;
        readonly oldStart: number;
      }[];
      readonly path: string;
      readonly status: string;
      readonly symbols: readonly string[];
    }[];
    readonly historicalRisks: readonly {
      readonly memoryId: string;
      readonly reasons: readonly string[];
      readonly relevance: MemoryRelevanceLevel;
      readonly severity: string;
      readonly title: string;
    }[];
    readonly requirements: readonly ContractRequirementContext[];
    readonly riskReasons: readonly {
      readonly code: string;
      readonly message: string;
      readonly paths?: readonly string[];
      readonly points: number;
    }[];
  };
  readonly createdAt: string;
  readonly instructions: readonly string[];
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly risk: { readonly level: RiskLevel; readonly score: number };
  readonly schemaVersion: 1;
  readonly scope: "working-tree";
}

export interface ChallengeUsage {
  readonly estimatedCostUsd: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly source: "client-reported" | "not-reported";
  readonly totalTokens: number | null;
}

export interface ChallengeProvenance {
  readonly attested: boolean;
  readonly client: string;
  readonly isolation: ChallengeIsolation;
  readonly model?: string;
  readonly usage: ChallengeUsage;
}

export interface ChallengeSubmission {
  readonly briefHash: string;
  readonly briefId: string;
  readonly provenance: ChallengeProvenance;
  readonly result: {
    readonly challenges: readonly ChallengeCase[];
    readonly summary: string;
  };
  readonly schemaVersion: 1;
}

export interface ChallengeReport {
  readonly brief: {
    readonly hash: string;
    readonly id: string;
    readonly path: string;
  };
  readonly challenges: readonly ChallengeCase[];
  readonly gate: {
    readonly reasons: readonly string[];
    readonly status: "blocked" | "passed";
  };
  readonly generatedAt: string;
  readonly provenance: ChallengeProvenance;
  readonly risk: { readonly level: RiskLevel; readonly score: number };
  readonly schemaVersion: 1;
  readonly scope: "working-tree";
  readonly status: "completed" | "unattested";
  readonly summary: string;
}

export interface ChallengeBriefResult {
  readonly brief: ChallengeBrief;
  readonly path: string;
}

export interface ChallengeReportResult {
  readonly path: string;
  readonly report: ChallengeReport;
}

export interface PrepareChallengeOptions {
  readonly assessRisk?: (root: string) => Promise<RiskAssessment>;
  readonly contractRequirements?: (
    root: string,
    assessment: RiskAssessment,
  ) => Promise<readonly ContractRequirementContext[]>;
  readonly explicit?: boolean;
  readonly releaseVerification?: boolean;
}

export type ChallengeErrorCode =
  | "CHALLENGE_ALREADY_SUBMITTED"
  | "CHALLENGE_INACTIVE"
  | "CHALLENGE_INVALID_BRIEF"
  | "CHALLENGE_INVALID_SUBMISSION"
  | "CHALLENGE_READ_FAILED"
  | "CHALLENGE_WRITE_FAILED";

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
