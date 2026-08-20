import type { VerificationResultStatus, VerificationRunResult } from "@maru/execution";
import type { GitDiffAnalysis } from "@maru/git";
import type { VerificationPlanResult } from "@maru/planner";

export const MUTATION_REPORT_SCHEMA_VERSION = 1;
export const MUTATION_ARTIFACTS_DIRECTORY = ".maru/artifacts/mutations";

export type MutationKind =
  "change-comparison" | "invert-boolean" | "remove-guard" | "remove-ownership-condition";
export type MutationOutcome = "inconclusive" | "killed" | "survived";
export type MutationGateStatus = "blocked" | "passed";

export interface MutationCandidate {
  readonly column: number;
  readonly description: string;
  readonly end: number;
  readonly file: string;
  readonly id: string;
  readonly kind: MutationKind;
  readonly line: number;
  readonly original: string;
  readonly replacement: string;
  readonly start: number;
}

export interface MutationExecution {
  readonly artifactRefs: readonly string[];
  readonly candidate: Omit<MutationCandidate, "end" | "start">;
  readonly durationMs: number;
  readonly diagnostic?: string;
  readonly outcome: MutationOutcome;
  readonly resultStatuses: readonly VerificationResultStatus[];
}

export interface MutationBaseline {
  readonly artifactRefs: readonly string[];
  readonly diagnostic?: string;
  readonly resultStatuses: readonly VerificationResultStatus[];
  readonly status: "inconclusive" | "passed";
}

export interface MutationReport {
  readonly baseline: MutationBaseline;
  readonly completedAt: string;
  readonly generatedAt: string;
  readonly gate: {
    readonly reasons: readonly string[];
    readonly status: MutationGateStatus;
  };
  readonly mutations: readonly MutationExecution[];
  readonly project: { readonly name: string };
  readonly schemaVersion: 1;
  readonly scope: "working-tree";
  readonly summary: {
    readonly candidates: number;
    readonly executed: number;
    readonly inconclusive: number;
    readonly killed: number;
    readonly survived: number;
  };
  readonly worktreeCleaned: boolean;
}

export interface MutationReportResult {
  readonly path: string;
  readonly report: MutationReport;
}

export interface MutationCommandResult {
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

export interface MutationCommandRunner {
  run(args: readonly string[], cwd: string): Promise<MutationCommandResult>;
}

export interface MutationWorktree {
  readonly path: string;
  cleanup(): Promise<void>;
}

export interface MutationWorktreeManager {
  create(root: string, analysis: GitDiffAnalysis): Promise<MutationWorktree>;
}

export interface RunMutationVerificationOptions {
  readonly analysis?: () => Promise<GitDiffAnalysis>;
  readonly createPlan?: () => Promise<VerificationPlanResult>;
  readonly maxMutations?: number;
  readonly now?: () => Date;
  readonly runPlan?: (
    root: string,
    plan: VerificationPlanResult["plan"],
  ) => Promise<VerificationRunResult>;
  readonly worktrees?: MutationWorktreeManager;
}

export class MutationVerificationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MutationVerificationError";
  }
}
