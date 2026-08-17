import type { QualityContract } from "@maru/contracts";
import {
  SEMANTIC_DRIFT_SCHEMA_VERSION,
  type AllowedMechanicalChange,
  type ObservedBehavior,
  type SemanticDriftConflict,
  type SemanticDriftReport,
} from "./model.js";

const REFERENCE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,119})#([A-Za-z0-9][A-Za-z0-9._-]{0,119})$/u;
const ACTIONS = [
  "mark-implementation-bug",
  "propose-contract-amendment",
  "investigate",
] as const;

function normalize(statement: string): string {
  return statement.trim().replace(/\s+/gu, " ");
}

function lookup(
  contracts: readonly QualityContract[],
  reference: string,
):
  | {
      readonly contract: QualityContract;
      readonly expected: string;
      readonly kind: "invariant" | "requirement";
      readonly requirementId: string;
    }
  | undefined {
  const match = REFERENCE.exec(reference);
  if (match === null) return undefined;
  const contract = contracts.find((item) => item.id === match[1]);
  if (contract === undefined) return undefined;
  const requirement = contract.requirements.find((item) => item.id === match[2]);
  if (requirement !== undefined) {
    return { contract, expected: requirement.statement, kind: "requirement", requirementId: requirement.id };
  }
  const invariant = contract.invariants.find((item) => item.id === match[2]);
  if (invariant !== undefined) {
    return { contract, expected: invariant.statement, kind: "invariant", requirementId: invariant.id };
  }
  return undefined;
}

/** Compare observed behavior with protected contract meaning without mutating either input. */
export function checkSemanticDrift(
  contracts: readonly QualityContract[],
  observations: readonly ObservedBehavior[],
  checkedAt: Date = new Date(),
): SemanticDriftReport {
  const conflicts: SemanticDriftConflict[] = [];
  const allowedChanges: AllowedMechanicalChange[] = [];

  for (const observation of observations) {
    const target = lookup(contracts, observation.requirementRef);
    if (target === undefined) {
      const [contractId = "unknown", requirementId = "unknown"] = observation.requirementRef.split("#");
      conflicts.push({
        actions: ACTIONS,
        approvalRequired: true,
        blocking: false,
        contractId,
        expected: "No matching contract requirement or invariant was found.",
        id: `drift-${String(conflicts.length + 1).padStart(3, "0")}`,
        kind: "unknown-reference",
        observed: observation.observed,
        requirementId,
        requirementRef: observation.requirementRef,
        ...(observation.source === undefined ? {} : { source: observation.source }),
      });
      continue;
    }

    if (normalize(target.expected) === normalize(observation.observed)) {
      if (observation.maintenanceKind !== undefined) {
        allowedChanges.push({
          kind: observation.maintenanceKind,
          requirementRef: observation.requirementRef,
          ...(observation.source === undefined ? {} : { source: observation.source }),
        });
      }
      continue;
    }

    conflicts.push({
      actions: ACTIONS,
      approvalRequired: true,
      blocking: target.contract.status === "approved",
      contractId: target.contract.id,
      contractStatus: target.contract.status,
      expected: target.expected,
      id: `drift-${String(conflicts.length + 1).padStart(3, "0")}`,
      kind: target.kind,
      observed: observation.observed,
      requirementId: target.requirementId,
      requirementRef: observation.requirementRef,
      ...(observation.source === undefined ? {} : { source: observation.source }),
    });
  }

  const blockingConflicts = conflicts.filter((item) => item.blocking).length;
  return {
    allowedChanges,
    checkedAt: checkedAt.toISOString(),
    classification:
      conflicts.length > 0 ? "semantic" : allowedChanges.length > 0 ? "mechanical" : "none",
    conflicts,
    gate: {
      reasons:
        blockingConflicts === 0
          ? []
          : [
              `${blockingConflicts} approved contract expectation${blockingConflicts === 1 ? "" : "s"} conflict with observed behavior.`,
              "Fix the implementation or obtain explicit approval for a contract amendment.",
            ],
      status: blockingConflicts > 0 ? "blocked" : "passed",
    },
    schemaVersion: SEMANTIC_DRIFT_SCHEMA_VERSION,
    summary: {
      allowedMechanicalChanges: allowedChanges.length,
      blockingConflicts,
      observations: observations.length,
      semanticConflicts: conflicts.length,
    },
  };
}

export function formatSemanticDriftReport(report: SemanticDriftReport): string {
  const lines = [
    `Semantic drift: ${report.gate.status.toUpperCase()}`,
    `Classification: ${report.classification}`,
    `Conflicts: ${report.summary.semanticConflicts} (${report.summary.blockingConflicts} blocking)`,
    `Allowed mechanical changes: ${report.summary.allowedMechanicalChanges}`,
  ];
  for (const conflict of report.conflicts) {
    lines.push(
      "",
      `[${conflict.requirementRef}] ${conflict.blocking ? "BLOCKING" : "REVIEW"}`,
      `Contract: ${conflict.expected}`,
      `Observed: ${conflict.observed}`,
      "Actions: mark implementation bug, propose contract amendment, or investigate",
    );
  }
  return lines.join("\n");
}
