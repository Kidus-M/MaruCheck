import type { ContractChange, QualityContract } from "@maru/contracts";

export const SEMANTIC_DRIFT_SCHEMA_VERSION = 1;
export const CONTRACT_AMENDMENT_SCHEMA_VERSION = 1;

export type MechanicalMaintenanceKind =
  "dom-structure" | "fixture-setup" | "route-timing" | "selector" | "wait-condition";

export interface ObservedBehavior {
  readonly maintenanceKind?: MechanicalMaintenanceKind;
  readonly observed: string;
  readonly requirementRef: string;
  readonly source?: {
    readonly line?: number;
    readonly path: string;
  };
}

export interface SemanticDriftConflict {
  readonly actions: readonly [
    "mark-implementation-bug",
    "propose-contract-amendment",
    "investigate",
  ];
  readonly approvalRequired: true;
  readonly blocking: boolean;
  readonly contractId: string;
  readonly contractStatus?: QualityContract["status"];
  readonly expected: string;
  readonly id: string;
  readonly kind: "invariant" | "requirement" | "unknown-reference";
  readonly observed: string;
  readonly requirementId: string;
  readonly requirementRef: string;
  readonly source?: ObservedBehavior["source"];
}

export interface AllowedMechanicalChange {
  readonly kind: MechanicalMaintenanceKind;
  readonly requirementRef: string;
  readonly source?: ObservedBehavior["source"];
}

export interface SemanticDriftReport {
  readonly schemaVersion: 1;
  readonly checkedAt: string;
  readonly classification: "mechanical" | "none" | "semantic";
  readonly conflicts: readonly SemanticDriftConflict[];
  readonly allowedChanges: readonly AllowedMechanicalChange[];
  readonly gate: {
    readonly reasons: readonly string[];
    readonly status: "blocked" | "passed";
  };
  readonly summary: {
    readonly allowedMechanicalChanges: number;
    readonly blockingConflicts: number;
    readonly observations: number;
    readonly semanticConflicts: number;
  };
}

export interface ContractAmendmentProposal {
  readonly schemaVersion: 1;
  readonly approval: {
    readonly eligibleApprovers: readonly string[];
    readonly required: true;
    readonly status: "pending";
  };
  readonly baseVersionHash: string;
  readonly changes: readonly ContractChange[];
  readonly contractId: string;
  readonly createdAt: string;
  readonly observations: readonly ObservedBehavior[];
  readonly proposalId: string;
  readonly proposedBy: string;
  readonly proposedContract: QualityContract;
  readonly reason: string;
  readonly status: "proposed";
}

export type DriftErrorCode =
  | "DRIFT_APPROVAL_REQUIRED"
  | "DRIFT_INVALID_INPUT"
  | "DRIFT_NO_SEMANTIC_CHANGE"
  | "DRIFT_PROPOSAL_INVALID"
  | "DRIFT_PROPOSAL_STALE"
  | "DRIFT_WRITE_FAILED";

export class DriftError extends Error {
  public constructor(
    public readonly code: DriftErrorCode,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DriftError";
  }
}
