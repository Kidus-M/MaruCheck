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
  readonly adapter: "jest" | "playwright" | "vitest";
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
  /** Older records whose failure context this record replaces. */
  readonly supersedes?: readonly string[];
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
  readonly supersedes: readonly string[];
}

export type MemoryRelevanceLevel = "high" | "low" | "medium";
export type MemoryRelevanceSignalCode =
  | "age"
  | "current-change"
  | "regression-tests-changed"
  | "regression-tests-present"
  | "related-contracts-active"
  | "related-files-present"
  | "superseded";

export interface MemoryRelevanceSignal {
  readonly code: MemoryRelevanceSignalCode;
  readonly message: string;
  readonly paths?: readonly string[];
  readonly points: number;
}

/** Deterministic freshness of one historical record relative to the current project. */
export interface MemoryRelevance {
  readonly level: MemoryRelevanceLevel;
  readonly score: number;
  readonly signals: readonly MemoryRelevanceSignal[];
  readonly supersededBy: readonly string[];
}

export interface MemoryRelevanceContract {
  readonly id: string;
  readonly status: "amended" | "approved" | "deprecated" | "draft" | "review";
}

export interface MemoryPathCommit {
  readonly committedAt: string;
  readonly paths: readonly string[];
}

/**
 * Project evidence used to judge relevance. Every field is optional so callers without that
 * evidence skip the related signal instead of guessing.
 */
export interface MemoryRelevanceContext {
  /** Every Quality Contract currently present in the project; recorded contracts absent here no longer exist. */
  readonly contracts?: readonly MemoryRelevanceContract[];
  /** Every recorded path that currently exists; recorded paths absent here no longer exist. */
  readonly existingPaths?: ReadonlySet<string>;
  /** Commits that touched recorded regression tests, used to detect tests rewritten since the record. */
  readonly history?: readonly MemoryPathCommit[];
  /** ISO timestamp used for the secondary age signal. */
  readonly now?: string;
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
  readonly relevance: MemoryRelevance;
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
