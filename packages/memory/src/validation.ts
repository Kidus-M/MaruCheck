import {
  MemoryError,
  type CreateMemoryRecordInput,
  type MemoryRegressionTest,
  type MemorySeverity,
  type MemorySource,
  type MemoryType,
  type QAMemoryRecord,
} from "./model.js";

const CONTRACT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MEMORY_ID = /^MEM-[0-9]{4,}$/u;
const REGRESSION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REQUIREMENT_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}#[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const SEVERITIES = new Set<MemorySeverity>(["critical", "high", "info", "low", "medium"]);
const SOURCES = new Set<MemorySource>([
  "coding-agent",
  "github",
  "manual",
  "production",
  "verification",
]);
const TYPES = new Set<MemoryType>([
  "bug",
  "contract-amendment",
  "flaky-test",
  "production-incident",
  "regression",
  "risk-override",
  "security-finding",
  "security-regression",
  "sensitive-integration",
]);

function invalid(message: string, remediation: string): never {
  throw new MemoryError("MEMORY_INVALID", message, remediation);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("A QA memory record must be a JSON object.", "Provide the documented memory fields.");
  }
  return value as Record<string, unknown>;
}

function stringValue(input: Record<string, unknown>, key: string, maximum: number): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    invalid(
      `${key} must be a non-empty string no longer than ${maximum} characters.`,
      `Correct ${key} in the memory input and retry.`,
    );
  }
  return value.trim();
}

function projectPath(value: string, field: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.length > 500 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment.length === 0)
  ) {
    invalid(
      `${field} must be a portable path inside the project root: ${value}`,
      "Use a relative path without parent traversal or empty segments.",
    );
  }
  return normalized;
}

function strings(
  input: Record<string, unknown>,
  key: string,
  maximumItems: number,
  itemMaximum: number,
): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.length > maximumItems) {
    invalid(`${key} must be an array with at most ${maximumItems} items.`, `Correct ${key}.`);
  }
  const result = value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > itemMaximum) {
      invalid(`${key} contains an invalid string.`, `Correct every item in ${key}.`);
    }
    return item.trim();
  });
  return [...new Set(result)];
}

function regressionTests(input: Record<string, unknown>): MemoryRegressionTest[] {
  const value = input.regressionTests;
  if (!Array.isArray(value) || value.length > 50) {
    invalid("regressionTests must contain at most 50 items.", "Correct regressionTests.");
  }
  return value.map((item, index) => {
    const test = record(item);
    const unknown = Object.keys(test).filter(
      (key) => !["adapter", "id", "path", "requirementRefs"].includes(key),
    );
    const id = stringValue(test, "id", 100);
    if (
      unknown.length > 0 ||
      (test.adapter !== "vitest" && test.adapter !== "jest" && test.adapter !== "playwright") ||
      !REGRESSION_ID.test(id)
    ) {
      invalid(
        `regressionTests[${index}] is invalid.`,
        "Use a vitest/jest/playwright adapter, kebab-case ID, project path, and requirement references.",
      );
    }
    const requirementRefs = strings(test, "requirementRefs", 100, 241);
    if (requirementRefs.some((reference) => !REQUIREMENT_REF.test(reference))) {
      invalid(
        `regressionTests[${index}].requirementRefs contains an invalid reference.`,
        "Use contract-id#requirement-id references.",
      );
    }
    return {
      adapter: test.adapter,
      id,
      path: projectPath(stringValue(test, "path", 500), `regressionTests[${index}].path`),
      requirementRefs,
    };
  });
}

/** Validate and normalize untrusted CLI or MCP memory input. */
export function parseMemoryRecordInput(
  value: unknown,
  options: { readonly defaultSource?: MemorySource } = {},
): CreateMemoryRecordInput {
  const input = record(value);
  const allowed = new Set([
    "regressionTests",
    "relatedContracts",
    "relatedFiles",
    "rootCause",
    "severity",
    "source",
    "summary",
    "tags",
    "title",
    "type",
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    invalid(
      `Unknown memory field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
      "Remove fields that are not part of schema version 1.",
    );
  }
  const type = stringValue(input, "type", 80) as MemoryType;
  const severity = stringValue(input, "severity", 20) as MemorySeverity;
  const sourceValue = input.source ?? options.defaultSource ?? "manual";
  if (!TYPES.has(type) || !SEVERITIES.has(severity) || !SOURCES.has(sourceValue as MemorySource)) {
    invalid(
      "Memory type, severity, or source is unsupported.",
      "Use a published type, severity, and source value.",
    );
  }
  const relatedContracts = strings(input, "relatedContracts", 50, 120);
  if (relatedContracts.some((id) => !CONTRACT_ID.test(id))) {
    invalid("relatedContracts contains an invalid ID.", "Use lowercase kebab-case contract IDs.");
  }
  return {
    regressionTests: regressionTests(input),
    relatedContracts,
    relatedFiles: strings(input, "relatedFiles", 100, 500).map((path) =>
      projectPath(path, "relatedFiles"),
    ),
    rootCause: stringValue(input, "rootCause", 5_000),
    severity,
    source: sourceValue as MemorySource,
    summary: stringValue(input, "summary", 10_000),
    tags: strings(input, "tags", 100, 80).map((tag) => tag.toLowerCase()),
    title: stringValue(input, "title", 300),
    type,
  };
}

export function parseStoredMemoryRecord(value: unknown, path: string): QAMemoryRecord {
  const input = record(value);
  if (
    input.schemaVersion !== 1 ||
    input.status !== "active" ||
    typeof input.id !== "string" ||
    !MEMORY_ID.test(input.id) ||
    typeof input.createdAt !== "string" ||
    !Number.isFinite(Date.parse(input.createdAt))
  ) {
    throw new MemoryError(
      "MEMORY_READ_FAILED",
      `Stored QA memory is invalid: ${path}`,
      "Repair or remove the invalid memory file, then retry.",
    );
  }
  let parsed: CreateMemoryRecordInput;
  try {
    parsed = parseMemoryRecordInput(
      {
        regressionTests: input.regressionTests,
        relatedContracts: input.relatedContracts,
        relatedFiles: input.relatedFiles,
        rootCause: input.rootCause,
        severity: input.severity,
        source: input.source,
        summary: input.summary,
        tags: input.tags,
        title: input.title,
        type: input.type,
      },
      {
        defaultSource:
          typeof input.source === "string" ? (input.source as MemorySource) : undefined,
      },
    );
  } catch (error) {
    throw new MemoryError(
      "MEMORY_READ_FAILED",
      `Stored QA memory is invalid: ${path}`,
      "Repair or remove the invalid memory file, then retry.",
      { cause: error },
    );
  }
  return {
    ...parsed,
    createdAt: input.createdAt,
    id: input.id,
    schemaVersion: 1,
    source: parsed.source ?? "manual",
    status: "active",
  };
}
