import type {
  CommandRunner,
  TemporaryTest,
  VerificationResultStatus,
  VerificationRun,
  VerificationRunResult,
  VerificationRunStatus,
} from "@maru/execution";
import type {
  RecommendedTestCategory,
  RiskLevel,
} from "@maru/risk";
import type {
  VerificationAdapter,
  VerificationPlan,
  VerificationPlanResult,
} from "@maru/planner";

export const VERIFICATION_REPORT_SCHEMA_VERSION = 1;

export type EvidenceStatus = "failed" | "inconclusive" | "passed";
export type EvidenceType =
  | "accessibility"
  | "api-test"
  | "e2e-test"
  | "manual"
  | "planning-gap"
  | "unit-test";
export type FindingKind = "execution-error" | "requirement-failure" | "verification-gap";
export type FindingSeverity = "critical" | "high" | "info" | "low" | "medium";
export type FindingStatus =
  | "accepted-risk"
  | "confirmed"
  | "deferred"
  | "false-positive"
  | "fixed"
  | "open";
export type RequirementEvidenceStatus = EvidenceStatus | "unverified";

export interface Evidence {
  readonly adapter: VerificationAdapter | "planner";
  readonly artifactRefs: readonly string[];
  readonly categories: readonly RecommendedTestCategory[];
  readonly createdAt: string;
  readonly diagnostic: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly id: string;
  readonly requirementRefs: readonly string[];
  readonly runId: string;
  readonly status: EvidenceStatus;
  readonly stepIds: readonly string[];
  readonly testFiles: readonly string[];
  readonly tool: string;
  readonly type: EvidenceType;
}

export interface RequirementEvidence {
  readonly blocking: boolean;
  readonly contractId: string;
  readonly contractTitle: string;
  readonly evidenceIds: readonly string[];
  readonly expected: string;
  readonly kind: "invariant" | "requirement";
  readonly requirementId: string;
  readonly requirementRef: string;
  readonly status: RequirementEvidenceStatus;
}

export interface FindingReproduction {
  readonly command: string;
  readonly steps: readonly string[];
}

interface FindingBase {
  readonly actual: string;
  readonly artifactRefs: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly explanation: string;
  readonly id: string;
  readonly kind: FindingKind;
  readonly reproduction: FindingReproduction;
  readonly severity: FindingSeverity;
  readonly sourceLocations: readonly { readonly file: string; readonly line?: number }[];
  readonly status: FindingStatus;
  readonly title: string;
}

export interface BlockingFinding extends FindingBase {
  readonly blocking: true;
  readonly contractId: string;
  readonly contractTitle: string;
  readonly expected: string;
  readonly requirementId: string;
  readonly requirementRef: string;
}

export interface AdvisoryFinding extends FindingBase {
  readonly blocking: false;
  readonly contractId?: string;
  readonly contractTitle?: string;
  readonly expected?: string;
  readonly requirementId?: string;
  readonly requirementRef?: string;
}

export type Finding = AdvisoryFinding | BlockingFinding;

export interface VerificationReport {
  readonly artifacts: {
    readonly plan: string;
    readonly report: string;
    readonly run: string;
  };
  readonly evidence: readonly Evidence[];
  readonly findings: readonly Finding[];
  readonly gate: {
    readonly reasons: readonly string[];
    readonly status: "blocked" | "passed";
  };
  readonly generatedAt: string;
  readonly project: {
    readonly name: string;
  };
  readonly requirementEvidence: readonly RequirementEvidence[];
  readonly risk: {
    readonly level: RiskLevel;
    readonly score: number;
  };
  readonly runId: string;
  readonly runStatus: VerificationRunStatus;
  readonly schemaVersion: 1;
  readonly summary: {
    readonly blockingFindings: number;
    readonly evidence: number;
    readonly failedEvidence: number;
    readonly findings: number;
    readonly inconclusiveEvidence: number;
    readonly passedEvidence: number;
    readonly requirementsFailed: number;
    readonly requirementsInconclusive: number;
    readonly requirementsPassed: number;
    readonly requirementsUnverified: number;
  };
}

export interface VerificationReportResult {
  readonly path: string;
  readonly planPath: string;
  readonly report: VerificationReport;
  readonly run: VerificationRun;
  readonly runPath: string;
}

export interface BuildVerificationReportInput {
  readonly diagnostics?: readonly string[];
  readonly generatedAt: string;
  readonly plan: VerificationPlan;
  readonly run: VerificationRun;
}

export interface CreateVerificationReportOptions {
  readonly commandRunner?: CommandRunner;
  readonly createPlan?: (root: string, now: Date) => Promise<VerificationPlanResult>;
  readonly now?: () => Date;
  readonly runPlan?: (
    root: string,
    plan: VerificationPlan,
    options: {
      readonly commandRunner?: CommandRunner;
      readonly now: () => Date;
      readonly planPath: string;
      readonly temporaryTests: readonly TemporaryTest[];
      readonly timeoutMs?: number;
    },
  ) => Promise<VerificationRunResult>;
  readonly temporaryTests?: readonly TemporaryTest[];
  readonly timeoutMs?: number;
}

export type RawVerificationResultStatus = VerificationResultStatus;
