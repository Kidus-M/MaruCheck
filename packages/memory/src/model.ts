export const QA_MEMORY_SCHEMA_VERSION = 1;

export type MemorySeverity = "critical" | "high" | "info" | "low" | "medium";
export type MemorySource = "coding-agent" | "github" | "manual" | "production" | "verification";
export type MemoryType =
  | "bug"
  | "contract-amendment"
  | "flaky-test"
  | "production-incident"
  | "regression"
  | "risk-override"
  | "security-finding"
  | "security-regression"
  | "sensitive-integration";

export interface MemoryRegressionTest {
  readonly adapter: "playwright" | "vitest";
  readonly id: string;
  readonly path: string;
  readonly requirementRefs: readonly string[];
}

export interface CreateMemoryRecordInput {
  readonly regressionTests: readonly MemoryRegressionTest[];
  readonly relatedContracts: readonly string[];
  readonly relatedFiles: readonly string[];
  readonly rootCause: string;
  readonly severity: MemorySeverity;
  readonly source?: MemorySource;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly type: MemoryType;
}

export interface QAMemoryRecord extends CreateMemoryRecordInput {
  readonly createdAt: string;
  readonly id: string;
  readonly schemaVersion: 1;
  readonly source: MemorySource;
  readonly status: "active";
}

export interface MemorySearchMatch {
  readonly matchedFields: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly record: QAMemoryRecord;
  readonly score: number;
}

export interface HistoricalRiskMatch {
  readonly exactFileMatches: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly memoryId: string;
  readonly reasons: readonly string[];
  readonly regressionTests: readonly MemoryRegressionTest[];
  readonly relatedContracts: readonly string[];
  readonly severity: MemorySeverity;
  readonly title: string;
  readonly type: MemoryType;
}

export type MemoryErrorCode =
  | "MEMORY_INVALID"
  | "MEMORY_NOT_FOUND"
  | "MEMORY_NOT_INITIALIZED"
  | "MEMORY_READ_FAILED"
  | "MEMORY_WRITE_FAILED";

export class MemoryError extends Error {
  public constructor(
    public readonly code: MemoryErrorCode,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MemoryError";
  }
}
