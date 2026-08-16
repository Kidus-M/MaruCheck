import {
  ContractError,
  type ContractApproval,
  type ContractCriticality,
  type ContractInvariant,
  type ContractRequirement,
  type ContractStatus,
  type ContractValidationIssue,
  type QualityContract,
  type RequirementPriority,
} from "./model.js";
import { parseYaml, serializeYaml } from "./yaml.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string, issues: ContractValidationIssue[]): UnknownRecord {
  if (isRecord(value)) return value;
  issues.push({ message: "must be a mapping", path });
  return {};
}

function text(value: unknown, path: string, issues: ContractValidationIssue[]): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  issues.push({ message: "must be a non-empty string", path });
  return "";
}

function stringList(value: unknown, path: string, issues: ContractValidationIssue[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ message: "must contain at least one item", path });
    return [];
  }
  return value.map((item, index) => text(item, `${path}.${index}`, issues));
}

function optionalStringList(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): string[] {
  if (value === undefined) return [];
  return stringList(value, path, issues);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: ContractValidationIssue[],
): T {
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  issues.push({ message: `must be one of: ${allowed.join(", ")}`, path });
  return allowed[0]!;
}

function requirementList(value: unknown, issues: ContractValidationIssue[]): ContractRequirement[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ message: "must contain at least one requirement", path: "requirements" });
    return [];
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const path = `requirements.${index}`;
    const input = record(item, path, issues);
    const id = text(input.id, `${path}.id`, issues);
    if (seen.has(id))
      issues.push({ message: `duplicate requirement id: ${id}`, path: `${path}.id` });
    seen.add(id);
    return {
      id,
      priority: enumValue<RequirementPriority>(
        input.priority,
        ["required", "recommended", "optional"],
        `${path}.priority`,
        issues,
      ),
      statement: text(input.statement, `${path}.statement`, issues),
    };
  });
}

function invariantList(value: unknown, issues: ContractValidationIssue[]): ContractInvariant[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ message: "must contain at least one invariant", path: "invariants" });
    return [];
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const path = `invariants.${index}`;
    const input = record(item, path, issues);
    const id = text(input.id, `${path}.id`, issues);
    if (seen.has(id)) issues.push({ message: `duplicate invariant id: ${id}`, path: `${path}.id` });
    seen.add(id);
    return { id, statement: text(input.statement, `${path}.statement`, issues) };
  });
}

function approvalValue(
  value: unknown,
  status: ContractStatus,
  issues: ContractValidationIssue[],
): ContractApproval | undefined {
  if (value === undefined || value === null) {
    if (status === "approved") {
      issues.push({ message: "is required when status is approved", path: "approval" });
    }
    return undefined;
  }
  const input = record(value, "approval", issues);
  const approvedAt = text(input.approved_at, "approval.approved_at", issues);
  const approvedBy = text(input.approved_by, "approval.approved_by", issues);
  const versionHash = text(input.version_hash, "approval.version_hash", issues);
  if (approvedAt.length > 0 && Number.isNaN(Date.parse(approvedAt))) {
    issues.push({ message: "must be an ISO-8601 timestamp", path: "approval.approved_at" });
  }
  if (versionHash.length > 0 && !/^[a-f0-9]{64}$/u.test(versionHash)) {
    issues.push({ message: "must be a SHA-256 hash", path: "approval.version_hash" });
  }
  return { approvedAt, approvedBy, versionHash };
}

/** Parse and validate a MaruCheck Quality Contract YAML document. */
export function parseQualityContract(source: string, sourceName = "contract"): QualityContract {
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      "CONTRACT_INVALID",
      `${sourceName} could not be parsed.`,
      "Fix the YAML syntax and run maru contract validate again.",
      [{ message: "could not be parsed", path: "yaml" }],
      { cause: error },
    );
  }

  const issues: ContractValidationIssue[] = [];
  const input = record(value, "contract", issues);
  if (input.version !== 1) issues.push({ message: "must equal 1", path: "version" });
  const id = text(input.id, "id", issues);
  if (id.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    issues.push({ message: "must be a lowercase kebab-case identifier", path: "id" });
  }
  const status = enumValue<ContractStatus>(
    input.status,
    ["draft", "review", "approved", "amended", "deprecated"],
    "status",
    issues,
  );
  const requirements = requirementList(input.requirements, issues);
  const invariants = invariantList(input.invariants, issues);
  const evidenceInput = record(input.evidence_policy, "evidence_policy", issues);
  const blockingRequirements = stringList(
    evidenceInput.blocking_requirements,
    "evidence_policy.blocking_requirements",
    issues,
  );
  const knownIds = new Set([...requirements, ...invariants].map((item) => item.id));
  for (const [index, blocked] of blockingRequirements.entries()) {
    if (!knownIds.has(blocked)) {
      issues.push({
        message: `references unknown requirement or invariant: ${blocked}`,
        path: `evidence_policy.blocking_requirements.${index}`,
      });
    }
  }

  const accessibilityInput =
    input.accessibility === undefined
      ? undefined
      : record(input.accessibility, "accessibility", issues);
  const performanceInput =
    input.performance === undefined ? undefined : record(input.performance, "performance", issues);
  const observabilityInput =
    input.observability === undefined
      ? undefined
      : record(input.observability, "observability", issues);

  const contract: QualityContract = {
    version: 1,
    id,
    title: text(input.title, "title", issues),
    status,
    criticality: enumValue<ContractCriticality>(
      input.criticality,
      ["low", "medium", "high", "critical"],
      "criticality",
      issues,
    ),
    intent: text(input.intent, "intent", issues),
    owners: stringList(input.owners, "owners", issues),
    requirements,
    invariants,
    edgeCases: stringList(input.edge_cases, "edge_cases", issues),
    security: stringList(input.security, "security", issues),
    dataIntegrity: stringList(input.data_integrity, "data_integrity", issues),
    evidencePolicy: { blockingRequirements },
    approval: approvalValue(input.approval, status, issues),
    ...(accessibilityInput === undefined
      ? {}
      : {
          accessibility: {
            required:
              typeof accessibilityInput.required === "boolean"
                ? accessibilityInput.required
                : (issues.push({ message: "must be a boolean", path: "accessibility.required" }),
                  false),
            ...(typeof accessibilityInput.standard === "string"
              ? { standard: accessibilityInput.standard }
              : {}),
          },
        }),
    ...(performanceInput === undefined
      ? {}
      : {
          performance: {
            requirements: optionalStringList(
              performanceInput.requirements,
              "performance.requirements",
              issues,
            ),
          },
        }),
    ...(observabilityInput === undefined
      ? {}
      : {
          observability: {
            expectedEvents: optionalStringList(
              observabilityInput.expected_events,
              "observability.expected_events",
              issues,
            ),
          },
        }),
  };

  if (issues.length > 0) {
    throw new ContractError(
      "CONTRACT_INVALID",
      `${sourceName} has ${issues.length} validation issue${issues.length === 1 ? "" : "s"}.`,
      "Correct the reported fields and run maru contract validate again.",
      issues,
    );
  }
  return contract;
}

/** Serialize a validated Quality Contract using stable YAML field ordering. */
export function serializeQualityContract(contract: QualityContract): string {
  return serializeYaml({
    version: contract.version,
    id: contract.id,
    title: contract.title,
    status: contract.status,
    criticality: contract.criticality,
    intent: contract.intent,
    owners: [...contract.owners],
    requirements: contract.requirements.map((item) => ({ ...item })),
    invariants: contract.invariants.map((item) => ({ ...item })),
    edge_cases: [...contract.edgeCases],
    security: [...contract.security],
    data_integrity: [...contract.dataIntegrity],
    ...(contract.accessibility === undefined
      ? {}
      : { accessibility: { ...contract.accessibility } }),
    ...(contract.performance === undefined
      ? {}
      : { performance: { requirements: [...contract.performance.requirements] } }),
    ...(contract.observability === undefined
      ? {}
      : { observability: { expected_events: [...contract.observability.expectedEvents] } }),
    evidence_policy: { blocking_requirements: [...contract.evidencePolicy.blockingRequirements] },
    ...(contract.approval === undefined
      ? {}
      : {
          approval: {
            approved_by: contract.approval.approvedBy,
            approved_at: contract.approval.approvedAt,
            version_hash: contract.approval.versionHash,
          },
        }),
  });
}
