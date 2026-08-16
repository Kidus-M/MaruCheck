export type JsonRpcId = number | string;
export type JsonObject = Record<string, unknown>;

export interface JsonRpcResponse {
  readonly error?: {
    readonly code: number;
    readonly data?: unknown;
    readonly message: string;
  };
  readonly id: JsonRpcId | null;
  readonly jsonrpc: "2.0";
  readonly result?: unknown;
}

export interface McpToolDefinition {
  readonly annotations: {
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
    readonly readOnlyHint: boolean;
  };
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly name: MaruMcpToolName;
  readonly outputSchema: JsonObject;
  readonly title: string;
}

export type MaruMcpToolName =
  | "maru_analyze_diff"
  | "maru_assess_risk"
  | "maru_create_contract"
  | "maru_get_contract"
  | "maru_get_project_context"
  | "maru_list_contracts"
  | "maru_validate_contract";

export interface McpToolResult {
  readonly content: readonly { readonly text: string; readonly type: "text" }[];
  readonly isError: boolean;
  readonly structuredContent: JsonObject;
}
