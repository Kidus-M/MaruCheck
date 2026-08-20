import {
  ContractError,
  contractVersionHash,
  createContractFromRequirements,
  getContract,
  listContracts,
  validateContracts,
} from "@maru/contracts";
import { ProjectError, scanProject, type ProjectScan } from "@maru/core";
import {
  EvidenceReportError,
  createAndWriteVerificationReport,
  type VerificationReportResult,
} from "@maru/evidence";
import { VerificationExecutionError, type TemporaryTest } from "@maru/execution";
import {
  DriftError,
  checkSemanticDrift,
  parseObservedBehaviors,
  proposeContractAmendment,
} from "@maru/drift";
import {
  MemoryError,
  createMemoryRecord,
  parseMemoryRecordInput,
  searchMemoryRecords,
} from "@maru/memory";
import { GitAnalysisError, analyzeGitDiff, type GitDiffAnalysis } from "@maru/git";
import {
  MutationVerificationError,
  runMutationVerification,
  type MutationReportResult,
} from "@maru/mutation";
import {
  VerificationPlanError,
  createAndWriteVerificationPlan,
  type VerificationPlanResult,
} from "@maru/planner";
import { assessProjectRisk, type RiskAssessment } from "@maru/risk";
import type { JsonObject, MaruMcpToolName, McpToolDefinition, McpToolResult } from "./types.js";

const CLOSED_EMPTY_SCHEMA = {
  additionalProperties: false,
  properties: {},
  type: "object",
} as const;
const BASE_OUTPUT_SCHEMA = {
  additionalProperties: true,
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  type: "object",
} as const;
const MAX_CONTEXT_ITEMS = 100;
const OBSERVATION_SCHEMA = {
  additionalProperties: false,
  properties: {
    maintenanceKind: {
      enum: ["dom-structure", "fixture-setup", "route-timing", "selector", "wait-condition"],
      type: "string",
    },
    observed: { maxLength: 10000, minLength: 1, type: "string" },
    requirementRef: {
      maxLength: 241,
      minLength: 3,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}#[A-Za-z0-9][A-Za-z0-9._-]{0,119}$",
      type: "string",
    },
    source: {
      additionalProperties: false,
      properties: {
        line: { minimum: 1, type: "integer" },
        path: { maxLength: 500, minLength: 1, type: "string" },
      },
      required: ["path"],
      type: "object",
    },
  },
  required: ["observed", "requirementRef"],
  type: "object",
} as const;
const MEMORY_REGRESSION_TEST_SCHEMA = {
  additionalProperties: false,
  properties: {
    adapter: { enum: ["playwright", "vitest"], type: "string" },
    id: {
      maxLength: 100,
      minLength: 1,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      type: "string",
    },
    path: { maxLength: 500, minLength: 1, type: "string" },
    requirementRefs: {
      items: {
        maxLength: 241,
        minLength: 3,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}#[A-Za-z0-9][A-Za-z0-9._-]{0,119}$",
        type: "string",
      },
      maxItems: 100,
      type: "array",
    },
  },
  required: ["adapter", "id", "path", "requirementRefs"],
  type: "object",
} as const;

function schema(properties: JsonObject, required: readonly string[] = []): JsonObject {
  return {
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
    type: "object",
  };
}

function definition(
  name: MaruMcpToolName,
  title: string,
  description: string,
  inputSchema: JsonObject,
  readOnly: boolean,
): McpToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema,
    outputSchema: BASE_OUTPUT_SCHEMA,
    annotations: {
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false,
      readOnlyHint: readOnly,
    },
  };
}

export const MARU_MCP_TOOLS: readonly McpToolDefinition[] = [
  definition(
    "maru_get_project_context",
    "Get MaruCheck project context",
    "Inspect the current project architecture and Quality Contract summaries before modifying code.",
    CLOSED_EMPTY_SCHEMA,
    true,
  ),
  definition(
    "maru_list_contracts",
    "List Quality Contracts",
    "List current Quality Contracts with lifecycle state, criticality, and stable version hash.",
    CLOSED_EMPTY_SCHEMA,
    true,
  ),
  definition(
    "maru_get_contract",
    "Get a Quality Contract",
    "Read one validated Quality Contract by its lowercase kebab-case identifier.",
    schema(
      { id: { description: "Contract identifier", maxLength: 120, minLength: 1, type: "string" } },
      ["id"],
    ),
    true,
  ),
  definition(
    "maru_create_contract",
    "Create a draft Quality Contract",
    "Create a local draft from natural-language requirements. This never approves product intent.",
    schema(
      {
        id: { maxLength: 120, minLength: 1, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", type: "string" },
        requirements: {
          description: "Natural-language product requirements",
          maxLength: 100000,
          minLength: 8,
          type: "string",
        },
        title: { maxLength: 200, minLength: 1, type: "string" },
      },
      ["requirements"],
    ),
    false,
  ),
  definition(
    "maru_validate_contract",
    "Validate Quality Contracts",
    "Validate every current contract or one YAML path inside the project root.",
    schema({ path: { maxLength: 500, minLength: 1, type: "string" } }),
    true,
  ),
  definition(
    "maru_analyze_diff",
    "Analyze the Git diff",
    "Parse staged and unstaged hunks, classify changed paths, and report bounded change metadata without returning source lines.",
    CLOSED_EMPTY_SCHEMA,
    true,
  ),
  definition(
    "maru_assess_risk",
    "Assess deterministic change risk",
    "Score the current Git diff from 0 to 100 with explicit rule contributions, related contracts, and recommended test categories.",
    CLOSED_EMPTY_SCHEMA,
    true,
  ),
  definition(
    "maru_create_verification_plan",
    "Create a verification plan",
    "Select related requirements and affected tests, choose risk-based adapters, explain every step, and write the versioned local plan artifact.",
    CLOSED_EMPTY_SCHEMA,
    false,
  ),
  definition(
    "maru_run_verification",
    "Run verification",
    "Rebuild the current-diff plan, execute selected local tests plus optional requirement-tagged temporary tests, and persist raw artifacts plus normalized evidence, requirement mappings, findings, reproduction instructions, and a JSON report. Temporary test source is executed inside the project and removed after the run.",
    schema({
      temporaryTests: {
        items: {
          additionalProperties: false,
          properties: {
            adapter: { enum: ["playwright", "vitest"], type: "string" },
            id: {
              maxLength: 80,
              minLength: 1,
              pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
              type: "string",
            },
            requirementRefs: {
              items: {
                maxLength: 241,
                minLength: 3,
                pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}#[A-Za-z0-9][A-Za-z0-9._-]{0,119}$",
                type: "string",
              },
              maxItems: 100,
              minItems: 1,
              type: "array",
            },
            source: { maxLength: 100000, minLength: 1, type: "string" },
            targetPath: { maxLength: 500, minLength: 1, type: "string" },
          },
          required: ["adapter", "id", "requirementRefs", "source", "targetPath"],
          type: "object",
        },
        maxItems: 20,
        type: "array",
      },
    }),
    false,
  ),
  definition(
    "maru_run_mutation_verification",
    "Run isolated mutation verification",
    "Prove selected local tests reject bounded TypeScript mutations in a detached temporary Git worktree. This executes project tests, writes local artifacts, and never mutates the active checkout.",
    schema({
      maxMutations: {
        description: "Maximum deterministic mutation candidates to execute",
        maximum: 100,
        minimum: 1,
        type: "integer",
      },
    }),
    false,
  ),
  definition(
    "maru_check_semantic_drift",
    "Check protected contract expectations",
    "Compare explicit observed behavior with current contract requirements and invariants. Approved semantic conflicts block; selector, DOM, timing, wait, and fixture maintenance is allowed only when protected meaning is unchanged.",
    schema(
      {
        observations: {
          items: OBSERVATION_SCHEMA,
          maxItems: 100,
          minItems: 1,
          type: "array",
        },
      },
      ["observations"],
    ),
    true,
  ),
  definition(
    "maru_propose_contract_amendment",
    "Propose a contract amendment",
    "Write an immutable, pending amendment proposal for a semantic conflict. This tool never approves or rewrites the current contract.",
    schema(
      {
        contractId: {
          maxLength: 120,
          minLength: 1,
          pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          type: "string",
        },
        observations: {
          items: OBSERVATION_SCHEMA,
          maxItems: 100,
          minItems: 1,
          type: "array",
        },
        proposedBy: { maxLength: 200, minLength: 1, type: "string" },
        reason: { maxLength: 2000, minLength: 1, type: "string" },
      },
      ["contractId", "observations", "proposedBy", "reason"],
    ),
    false,
  ),
  definition(
    "maru_record_bug",
    "Record a QA bug memory",
    "Persist an immutable historical bug, its root cause, affected files/contracts, tags, and executable regression tests for future verification.",
    schema(
      {
        regressionTests: {
          items: MEMORY_REGRESSION_TEST_SCHEMA,
          maxItems: 50,
          type: "array",
        },
        relatedContracts: {
          items: {
            maxLength: 120,
            minLength: 1,
            pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
            type: "string",
          },
          maxItems: 50,
          type: "array",
        },
        relatedFiles: {
          items: { maxLength: 500, minLength: 1, type: "string" },
          maxItems: 100,
          type: "array",
        },
        rootCause: { maxLength: 5000, minLength: 1, type: "string" },
        severity: {
          enum: ["critical", "high", "info", "low", "medium"],
          type: "string",
        },
        summary: { maxLength: 10000, minLength: 1, type: "string" },
        tags: {
          items: { maxLength: 80, minLength: 1, type: "string" },
          maxItems: 100,
          type: "array",
        },
        title: { maxLength: 300, minLength: 1, type: "string" },
        type: {
          enum: [
            "bug",
            "contract-amendment",
            "flaky-test",
            "production-incident",
            "regression",
            "risk-override",
            "security-finding",
            "security-regression",
            "sensitive-integration",
          ],
          type: "string",
        },
      },
      [
        "regressionTests",
        "relatedContracts",
        "relatedFiles",
        "rootCause",
        "severity",
        "summary",
        "tags",
        "title",
        "type",
      ],
    ),
    false,
  ),
  definition(
    "maru_query_memory",
    "Query QA memory",
    "Search historical bugs, incidents, root causes, paths, contracts, and regression tests with explainable deterministic matches.",
    schema({ query: { maxLength: 500, minLength: 1, type: "string" } }, ["query"]),
    true,
  ),
];

class ToolInputError extends Error {
  public readonly code = "INVALID_TOOL_ARGUMENTS";
  public readonly remediation = "Use the tool's published inputSchema and remove unknown fields.";

  public constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export class UnknownMcpToolError extends Error {
  public constructor(public readonly toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = "UnknownMcpToolError";
  }
}

function objectArguments(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolInputError("Tool arguments must be an object.");
  }
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new ToolInputError(
      `Unknown argument${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
    );
  return input;
}

function requiredString(input: Record<string, unknown>, key: string, maximum: number): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new ToolInputError(
      `${key} must be a non-empty string no longer than ${maximum} characters.`,
    );
  }
  return value.trim();
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
  maximum: number,
): string | undefined {
  if (input[key] === undefined) return undefined;
  return requiredString(input, key, maximum);
}

function temporaryTests(input: Record<string, unknown>): TemporaryTest[] {
  const value = input.temporaryTests;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new ToolInputError("temporaryTests must be an array containing at most 20 tests.");
  }
  return value.map((item, index) => {
    const test = objectArguments(item, [
      "adapter",
      "id",
      "requirementRefs",
      "source",
      "targetPath",
    ]);
    if (test.adapter !== "vitest" && test.adapter !== "playwright") {
      throw new ToolInputError(`temporaryTests[${index}].adapter must be vitest or playwright.`);
    }
    if (
      !Array.isArray(test.requirementRefs) ||
      test.requirementRefs.length === 0 ||
      test.requirementRefs.length > 100 ||
      test.requirementRefs.some(
        (reference) =>
          typeof reference !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}#[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(reference),
      )
    ) {
      throw new ToolInputError(
        `temporaryTests[${index}].requirementRefs must contain 1 to 100 contract-id#requirement-id strings.`,
      );
    }
    if (
      typeof test.source !== "string" ||
      test.source.trim().length === 0 ||
      test.source.length > 100_000
    ) {
      throw new ToolInputError(
        `temporaryTests[${index}].source must be non-empty and no longer than 100000 characters.`,
      );
    }
    return {
      adapter: test.adapter,
      id: requiredString(test, "id", 80),
      requirementRefs: test.requirementRefs as string[],
      source: test.source,
      targetPath: requiredString(test, "targetPath", 500),
    };
  });
}

function success(data: JsonObject): McpToolResult {
  const structuredContent = { ok: true, ...data };
  return {
    content: [{ text: JSON.stringify(structuredContent, null, 2), type: "text" }],
    isError: false,
    structuredContent,
  };
}

function boundedProjectContext(scan: ProjectScan): JsonObject {
  return {
    ci: scan.ci,
    dependencies: {
      development: scan.dependencies.development.slice(0, MAX_CONTEXT_ITEMS),
      developmentCount: scan.dependencies.development.length,
      production: scan.dependencies.production.slice(0, MAX_CONTEXT_ITEMS),
      productionCount: scan.dependencies.production.length,
      truncated:
        scan.dependencies.development.length > MAX_CONTEXT_ITEMS ||
        scan.dependencies.production.length > MAX_CONTEXT_ITEMS,
    },
    generatedAt: scan.generatedAt,
    project: scan.project,
    routeCount: scan.routes.length,
    routes: scan.routes.slice(0, MAX_CONTEXT_ITEMS),
    routesTruncated: scan.routes.length > MAX_CONTEXT_ITEMS,
    schemaVersion: scan.schemaVersion,
    source: {
      directories: scan.source.directories,
      fileCount: scan.source.fileCount,
      filesByExtension: scan.source.filesByExtension,
      filesTruncated: scan.source.files.length > MAX_CONTEXT_ITEMS,
      sampleFiles: scan.source.files.slice(0, MAX_CONTEXT_ITEMS),
    },
    tests: {
      directories: scan.tests.directories,
      fileCount: scan.tests.files.length,
      files: scan.tests.files.slice(0, MAX_CONTEXT_ITEMS),
      filesTruncated: scan.tests.files.length > MAX_CONTEXT_ITEMS,
      frameworks: scan.tests.frameworks,
    },
  };
}

function failure(error: unknown): McpToolResult {
  let code = "MCP_TOOL_EXECUTION_FAILED";
  let message = "The MaruCheck tool could not complete safely.";
  let remediation = "Confirm the project is initialized, then retry with valid arguments.";
  let issues: readonly unknown[] = [];

  if (
    error instanceof ContractError ||
    error instanceof DriftError ||
    error instanceof MemoryError ||
    error instanceof EvidenceReportError ||
    error instanceof ProjectError ||
    error instanceof GitAnalysisError ||
    error instanceof VerificationExecutionError ||
    error instanceof MutationVerificationError ||
    error instanceof VerificationPlanError ||
    error instanceof ToolInputError
  ) {
    code = error.code;
    message = error.message;
    remediation = error.remediation;
    if (error instanceof ContractError) issues = error.issues;
  }
  const structuredContent = { error: { code, issues, message, remediation }, ok: false };
  return {
    content: [{ text: JSON.stringify(structuredContent, null, 2), type: "text" }],
    isError: true,
    structuredContent,
  };
}

export interface MaruToolDependencies {
  readonly analyzeDiff?: (root: string) => Promise<GitDiffAnalysis>;
  readonly assessRisk?: (root: string) => Promise<RiskAssessment>;
  readonly createVerificationPlan?: (root: string, now: Date) => Promise<VerificationPlanResult>;
  readonly now?: () => Date;
  readonly mutationVerification?: (
    root: string,
    now: Date,
    options: { readonly maxMutations?: number },
  ) => Promise<MutationReportResult>;
  readonly root: string;
  readonly verificationReport?: (
    root: string,
    now: Date,
    options: { readonly temporaryTests: readonly TemporaryTest[] },
  ) => Promise<VerificationReportResult>;
}

function isToolName(name: string): name is MaruMcpToolName {
  return MARU_MCP_TOOLS.some((tool) => tool.name === name);
}

/** Execute one validated MaruCheck MCP tool against the configured project root. */
export async function callMaruTool(
  name: string,
  args: unknown,
  dependencies: MaruToolDependencies,
): Promise<McpToolResult> {
  if (!isToolName(name)) throw new UnknownMcpToolError(name);
  const { root } = dependencies;

  try {
    if (name === "maru_get_project_context") {
      objectArguments(args, []);
      const [project, contracts, validation] = await Promise.all([
        scanProject(root, dependencies.now?.() ?? new Date()),
        listContracts(root),
        validateContracts(root),
      ]);
      return success({
        contractCount: contracts.length,
        contracts: contracts.slice(0, MAX_CONTEXT_ITEMS),
        contractsTruncated: contracts.length > MAX_CONTEXT_ITEMS,
        contractValidation: {
          invalid: validation.invalid,
          validCount: validation.valid.length,
        },
        project: boundedProjectContext(project),
      });
    }

    if (name === "maru_list_contracts") {
      objectArguments(args, []);
      return success({ contracts: await listContracts(root) });
    }

    if (name === "maru_get_contract") {
      const input = objectArguments(args, ["id"]);
      const contract = await getContract(root, requiredString(input, "id", 120));
      return success({ contract, versionHash: contractVersionHash(contract) });
    }

    if (name === "maru_create_contract") {
      const input = objectArguments(args, ["id", "requirements", "title"]);
      const created = await createContractFromRequirements(
        root,
        requiredString(input, "requirements", 100_000),
        {
          id: optionalString(input, "id", 120),
          now: dependencies.now?.() ?? new Date(),
          title: optionalString(input, "title", 200),
        },
      );
      return success({ ...created, reviewRequired: true });
    }

    if (name === "maru_validate_contract") {
      const input = objectArguments(args, ["path"]);
      const validation = await validateContracts(root, optionalString(input, "path", 500));
      return success({ invalid: validation.invalid, valid: validation.valid });
    }

    if (name === "maru_run_verification") {
      const input = objectArguments(args, ["temporaryTests"]);
      const tests = temporaryTests(input);
      const result = await (dependencies.verificationReport ?? createAndWriteVerificationReport)(
        root,
        dependencies.now?.() ?? new Date(),
        { temporaryTests: tests },
      );
      return success({
        path: result.path,
        planPath: result.planPath,
        report: result.report,
        run: result.run,
        runPath: result.runPath,
      });
    }

    if (name === "maru_run_mutation_verification") {
      const input = objectArguments(args, ["maxMutations"]);
      const maximum = input.maxMutations;
      if (
        maximum !== undefined &&
        (typeof maximum !== "number" || !Number.isInteger(maximum) || maximum < 1 || maximum > 100)
      ) {
        throw new ToolInputError("maxMutations must be an integer from 1 to 100.");
      }
      const result = await (dependencies.mutationVerification ?? runMutationVerification)(
        root,
        dependencies.now?.() ?? new Date(),
        { ...(maximum === undefined ? {} : { maxMutations: maximum }) },
      );
      return success({ path: result.path, report: result.report });
    }

    if (name === "maru_check_semantic_drift") {
      const input = objectArguments(args, ["observations"]);
      const observations = parseObservedBehaviors({ observations: input.observations });
      const summaries = await listContracts(root);
      const contracts = await Promise.all(summaries.map((item) => getContract(root, item.id)));
      return success({
        report: checkSemanticDrift(contracts, observations, dependencies.now?.() ?? new Date()),
      });
    }

    if (name === "maru_propose_contract_amendment") {
      const input = objectArguments(args, ["contractId", "observations", "proposedBy", "reason"]);
      const result = await proposeContractAmendment(
        root,
        requiredString(input, "contractId", 120),
        parseObservedBehaviors({ observations: input.observations }),
        {
          now: dependencies.now?.() ?? new Date(),
          proposedBy: requiredString(input, "proposedBy", 200),
          reason: requiredString(input, "reason", 2000),
        },
      );
      return success({ ...result, approvalRequired: true });
    }

    if (name === "maru_record_bug") {
      const input = objectArguments(args, [
        "regressionTests",
        "relatedContracts",
        "relatedFiles",
        "rootCause",
        "severity",
        "summary",
        "tags",
        "title",
        "type",
      ]);
      const result = await createMemoryRecord(
        root,
        parseMemoryRecordInput({ ...input, source: "coding-agent" }),
        { now: dependencies.now?.() ?? new Date() },
      );
      return success(result);
    }

    if (name === "maru_query_memory") {
      const input = objectArguments(args, ["query"]);
      return success({
        matches: await searchMemoryRecords(root, requiredString(input, "query", 500)),
      });
    }

    objectArguments(args, []);
    if (name === "maru_analyze_diff") {
      const diff = await (dependencies.analyzeDiff ?? analyzeGitDiff)(root);
      return success({ diff, scope: "staged-unstaged-untracked" });
    }
    if (name === "maru_assess_risk") {
      const assessment = await (dependencies.assessRisk ?? assessProjectRisk)(root);
      return success({ assessment });
    }
    const result = await (dependencies.createVerificationPlan ?? createAndWriteVerificationPlan)(
      root,
      dependencies.now?.() ?? new Date(),
    );
    return success({ path: result.path, plan: result.plan });
  } catch (error) {
    return failure(error);
  }
}
