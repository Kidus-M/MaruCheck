import {
  ContractError,
  contractVersionHash,
  createContractFromRequirements,
  getContract,
  listContracts,
  validateContracts,
} from "@maru/contracts";
import { ProjectError, scanProject } from "@maru/core";
import { GitAnalysisError, analyzeWorkingTree, type WorkingTreeAnalysis } from "@maru/git";
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
    "Analyze the Git working tree",
    "Inventory staged, unstaged, and untracked paths without reading their contents. Risk scoring is added in Phase 4.",
    CLOSED_EMPTY_SCHEMA,
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

function success(data: JsonObject): McpToolResult {
  const structuredContent = { ok: true, ...data };
  return {
    content: [{ text: JSON.stringify(structuredContent, null, 2), type: "text" }],
    isError: false,
    structuredContent,
  };
}

function failure(error: unknown): McpToolResult {
  let code = "MCP_TOOL_EXECUTION_FAILED";
  let message = "The MaruCheck tool could not complete safely.";
  let remediation = "Confirm the project is initialized, then retry with valid arguments.";
  let issues: readonly unknown[] = [];

  if (
    error instanceof ContractError ||
    error instanceof ProjectError ||
    error instanceof GitAnalysisError ||
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
  readonly analyzeDiff?: (root: string) => Promise<WorkingTreeAnalysis>;
  readonly now?: () => Date;
  readonly root: string;
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
        contracts,
        contractValidation: {
          invalid: validation.invalid,
          validCount: validation.valid.length,
        },
        project,
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

    objectArguments(args, []);
    const diff = await (dependencies.analyzeDiff ?? analyzeWorkingTree)(root);
    return success({ diff, riskAssessment: "not-included-until-phase-4", scope: "working-tree" });
  } catch (error) {
    return failure(error);
  }
}
