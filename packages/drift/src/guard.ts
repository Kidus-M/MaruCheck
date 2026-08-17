import type { QualityContract } from "@maru/contracts";
import {
  DriftError,
  SEMANTIC_DRIFT_SCHEMA_VERSION,
  type AllowedMechanicalChange,
  type ObservedBehavior,
  type SemanticDriftConflict,
  type SemanticDriftReport,
} from "./model.js";

const REFERENCE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,119})#([A-Za-z0-9][A-Za-z0-9._-]{0,119})$/u;
const ACTIONS = ["mark-implementation-bug", "propose-contract-amendment", "investigate"] as const;
const MAINTENANCE_KINDS = new Set([
  "dom-structure",
  "fixture-setup",
  "route-timing",
  "selector",
  "wait-condition",
]);

function normalize(statement: string): string {
  return statement.trim().replace(/\s+/gu, " ");
}

/** Validate bounded observations supplied by a CLI file or MCP client. */
export function parseObservedBehaviors(value: unknown): ObservedBehavior[] {
  const candidate =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).observations
      : value;
  if (!Array.isArray(candidate) || candidate.length === 0 || candidate.length > 100) {
    throw new DriftError(
      "DRIFT_INVALID_INPUT",
      "Observations must contain between 1 and 100 entries.",
      "Provide an array, or an object with an observations array, using contract-id#requirement-id references.",
    );
  }
  return candidate.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new DriftError(
        "DRIFT_INVALID_INPUT",
        `Observation ${index + 1} must be an object.`,
        "Provide requirementRef and observed strings for every observation.",
      );
    }
    const input = item as Record<string, unknown>;
    const unknown = Object.keys(input).filter(
      (key) => !["maintenanceKind", "observed", "requirementRef", "source"].includes(key),
    );
    if (
      unknown.length > 0 ||
      typeof input.requirementRef !== "string" ||
      !REFERENCE.test(input.requirementRef) ||
      typeof input.observed !== "string" ||
      input.observed.trim().length === 0 ||
      input.observed.length > 10_000 ||
      (input.maintenanceKind !== undefined &&
        (typeof input.maintenanceKind !== "string" ||
          !MAINTENANCE_KINDS.has(input.maintenanceKind)))
    ) {
      throw new DriftError(
        "DRIFT_INVALID_INPUT",
        `Observation ${index + 1} is invalid.`,
        "Use a valid requirementRef, a non-empty observed statement, and an optional published maintenanceKind.",
      );
    }
    let source: ObservedBehavior["source"];
    if (input.source !== undefined) {
      if (
        typeof input.source !== "object" ||
        input.source === null ||
        Array.isArray(input.source) ||
        typeof (input.source as Record<string, unknown>).path !== "string"
      ) {
        throw new DriftError(
          "DRIFT_INVALID_INPUT",
          `Observation ${index + 1} has an invalid source.`,
          "Use source.path and an optional positive source.line.",
        );
      }
      const raw = input.source as Record<string, unknown>;
      const sourcePath = raw.path;
      if (
        typeof sourcePath !== "string" ||
        sourcePath.length === 0 ||
        sourcePath.length > 500 ||
        (raw.line !== undefined &&
          (typeof raw.line !== "number" || !Number.isInteger(raw.line) || raw.line < 1))
      ) {
        throw new DriftError(
          "DRIFT_INVALID_INPUT",
          `Observation ${index + 1} has an invalid source.`,
          "Use source.path and an optional positive source.line.",
        );
      }
      source = {
        path: sourcePath,
        ...(typeof raw.line === "number" ? { line: raw.line } : {}),
      };
    }
    return {
      ...(typeof input.maintenanceKind === "string"
        ? { maintenanceKind: input.maintenanceKind as ObservedBehavior["maintenanceKind"] }
        : {}),
      observed: input.observed.trim(),
      requirementRef: input.requirementRef,
      ...(source === undefined ? {} : { source }),
    };
  });
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
    return {
      contract,
      expected: requirement.statement,
      kind: "requirement",
      requirementId: requirement.id,
    };
  }
  const invariant = contract.invariants.find((item) => item.id === match[2]);
  if (invariant !== undefined) {
    return {
      contract,
      expected: invariant.statement,
      kind: "invariant",
      requirementId: invariant.id,
    };
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
      const [contractId = "unknown", requirementId = "unknown"] =
        observation.requirementRef.split("#");
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
