export const QUALITY_CONTRACT_SCHEMA_VERSION = 1;

export type ContractStatus = "draft" | "review" | "approved" | "amended" | "deprecated";
export type ContractCriticality = "low" | "medium" | "high" | "critical";
export type RequirementPriority = "optional" | "recommended" | "required";

export interface ContractRequirement {
  readonly id: string;
  readonly statement: string;
  readonly priority: RequirementPriority;
}

export interface ContractInvariant {
  readonly id: string;
  readonly statement: string;
}

export interface ContractApproval {
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly versionHash: string;
}

export interface QualityContract {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly status: ContractStatus;
  readonly criticality: ContractCriticality;
  readonly intent: string;
  readonly owners: readonly string[];
  readonly requirements: readonly ContractRequirement[];
  readonly invariants: readonly ContractInvariant[];
  readonly edgeCases: readonly string[];
  readonly security: readonly string[];
  readonly dataIntegrity: readonly string[];
  readonly accessibility?: {
    readonly required: boolean;
    readonly standard?: string;
  };
  readonly performance?: {
    readonly requirements: readonly string[];
  };
  readonly observability?: {
    readonly expectedEvents: readonly string[];
  };
  readonly evidencePolicy: {
    readonly blockingRequirements: readonly string[];
  };
  readonly approval?: ContractApproval;
}

export interface ContractValidationIssue {
  readonly message: string;
  readonly path: string;
}

export type ContractErrorCode =
  | "CONTRACT_ALREADY_APPROVED"
  | "CONTRACT_ALREADY_EXISTS"
  | "CONTRACT_ID_INVALID"
  | "CONTRACT_INVALID"
  | "CONTRACT_NOT_FOUND"
  | "CONTRACT_READ_FAILED"
  | "CONTRACT_WRITE_FAILED"
  | "MARU_NOT_INITIALIZED"
  | "REQUIREMENTS_INVALID";

export class ContractError extends Error {
  public constructor(
    public readonly code: ContractErrorCode,
    message: string,
    public readonly remediation: string,
    public readonly issues: readonly ContractValidationIssue[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContractError";
  }
}

export interface ContractSummary {
  readonly criticality: ContractCriticality;
  readonly id: string;
  readonly path: string;
  readonly status: ContractStatus;
  readonly title: string;
  readonly versionHash: string;
}

export interface ContractChange {
  readonly kind: "added" | "changed" | "removed";
  readonly path: string;
  readonly semantic: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface ContractDiff {
  readonly classification: "none" | "mechanical" | "semantic";
  readonly changes: readonly ContractChange[];
}
