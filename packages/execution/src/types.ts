import type { VerificationAdapter, VerificationPlan } from "@maru/planner";

export const VERIFICATION_RUN_SCHEMA_VERSION = 1;
export const VERIFICATION_ARTIFACTS_DIRECTORY = ".maru/artifacts/runs";

export type AutomatedVerificationAdapter = Extract<
  VerificationAdapter,
  "axe" | "gitleaks" | "jest" | "playwright" | "semgrep" | "vitest"
>;
export type TestVerificationAdapter = Extract<
  VerificationAdapter,
  "jest" | "playwright" | "vitest"
>;
export type VerificationResultStatus = "error" | "failed" | "passed" | "skipped" | "unavailable";
export type VerificationRunStatus = "error" | "failed" | "incomplete" | "passed";

export interface CommandRequest {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface CommandResult {
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut?: boolean;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

export interface TemporaryTest {
  readonly adapter: TestVerificationAdapter;
  readonly id: string;
  readonly requirementRefs: readonly string[];
  readonly source: string;
  readonly targetPath: string;
}

export interface GeneratedTestArtifact {
  readonly adapter: TestVerificationAdapter;
  readonly artifactPath: string;
  readonly id: string;
  readonly requirementRefs: readonly string[];
  readonly targetPath: string;
}

export interface VerificationResultError {
  readonly code: string;
  readonly message: string;
  readonly remediation: string;
}

export interface AdapterExecutionResult {
  readonly adapter: VerificationAdapter;
  readonly artifacts: {
    readonly outputDirectory?: string;
    readonly report?: string;
    readonly stderr?: string;
    readonly stdout?: string;
  };
  readonly blocking: boolean;
  readonly command?: {
    readonly args: readonly string[];
    readonly executable: string;
  };
  readonly durationMs: number;
  readonly error?: VerificationResultError;
  readonly exitCode: number | null;
  readonly requirementRefs: readonly string[];
  readonly status: VerificationResultStatus;
  readonly stepIds: readonly string[];
  readonly targetFiles?: readonly string[];
  readonly testFiles: readonly string[];
}

export interface VerificationRun {
  readonly artifactDirectory: string;
  readonly completedAt: string;
  readonly generatedTests: readonly GeneratedTestArtifact[];
  readonly planPath: string;
  readonly results: readonly AdapterExecutionResult[];
  readonly schemaVersion: 1;
  readonly startedAt: string;
  readonly status: VerificationRunStatus;
  readonly summary: {
    readonly blockingFailures: number;
    readonly error: number;
    readonly failed: number;
    readonly passed: number;
    readonly skipped: number;
    readonly unavailable: number;
  };
}

export interface VerificationRunResult {
  readonly path: string;
  readonly run: VerificationRun;
}

export interface RunVerificationOptions {
  readonly commandRunner?: CommandRunner;
  readonly now?: () => Date;
  readonly planPath?: string;
  readonly temporaryTests?: readonly TemporaryTest[];
  readonly timeoutMs?: number;
}

export interface CreateAndRunVerificationOptions extends Omit<RunVerificationOptions, "planPath"> {
  readonly createPlan?: (
    root: string,
    now: Date,
  ) => Promise<{ readonly path: string; readonly plan: VerificationPlan }>;
}
