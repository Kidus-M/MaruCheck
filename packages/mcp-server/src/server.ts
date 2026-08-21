import {
  MARU_MCP_TOOLS,
  UnknownMcpToolError,
  callMaruTool,
  type MaruToolDependencies,
} from "./tools.js";
import type { JsonObject, JsonRpcId, JsonRpcResponse } from "./types.js";

export const MCP_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([MCP_PROTOCOL_VERSION, "2025-06-18", "2024-11-05"]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestId(value: unknown): JsonRpcId | undefined {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
    ? value
    : undefined;
}

function response(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { id, jsonrpc: "2.0", result };
}

function errorResponse(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    error: { code, message, ...(data === undefined ? {} : { data }) },
    id,
    jsonrpc: "2.0",
  };
}

function requestedProtocol(params: JsonObject): string | undefined {
  return typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
}

/** Stateful MCP JSON-RPC handler implementing initialization, ping, and tool operations. */
export class MaruMcpServer {
  private initializeCompleted = false;
  private initialized = false;

  public constructor(private readonly dependencies: MaruToolDependencies) {}

  public async handle(message: unknown): Promise<JsonRpcResponse | undefined> {
    if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return errorResponse(null, -32600, "Invalid Request");
    }

    const id = requestId(message.id);
    const notification = message.id === undefined;
    if (!notification && id === undefined) {
      return errorResponse(null, -32600, "Request id must be a string or finite number");
    }
    const params = message.params === undefined ? {} : message.params;
    if (!isObject(params)) {
      return notification ? undefined : errorResponse(id ?? null, -32602, "Invalid params");
    }

    if (message.method === "ping") {
      return notification ? undefined : response(id!, {});
    }

    if (message.method === "initialize") {
      if (notification || id === undefined)
        return errorResponse(null, -32600, "Initialize must be a request");
      if (this.initializeCompleted)
        return errorResponse(id, -32600, "Server is already initialized");
      const protocolVersion = requestedProtocol(params);
      if (
        protocolVersion === undefined ||
        !isObject(params.capabilities) ||
        !isObject(params.clientInfo) ||
        typeof params.clientInfo.name !== "string" ||
        typeof params.clientInfo.version !== "string"
      ) {
        return errorResponse(id, -32602, "Invalid initialize parameters");
      }
      this.initializeCompleted = true;
      return response(id, {
        capabilities: { tools: { listChanged: false } },
        instructions:
          "Query MaruCheck project context, Quality Contracts, and relevant QA memory before changing behavior. Check observed behavior for semantic drift before changing protected expectations. Record confirmed bugs with regression tests so future risk and planning include them. Analyze the diff, assess risk, create an inspectable verification plan, and run verification with evidence and findings after edits. For high-risk or release work, prepare a Challenger brief, give it to a fresh thread or subagent without the builder conversation, then submit the isolated response with truthful provenance. Treat Challenger hypotheses as review inputs rather than verified findings. Drafts and amendment proposals never approve product intent.",
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)
          ? protocolVersion
          : MCP_PROTOCOL_VERSION,
        serverInfo: {
          description: "Local-first MaruCheck project and Quality Contract tools",
          name: "maru",
          title: "MaruCheck",
          version: "0.2.1",
        },
      });
    }

    if (message.method === "notifications/initialized") {
      if (this.initializeCompleted) this.initialized = true;
      return undefined;
    }

    if (!this.initialized) {
      return notification ? undefined : errorResponse(id ?? null, -32002, "Server not initialized");
    }

    if (message.method === "tools/list") {
      if (notification || id === undefined) return undefined;
      if (params.cursor !== undefined) {
        return errorResponse(
          id,
          -32602,
          "Pagination cursor is not supported for this fixed tool list",
        );
      }
      return response(id, { tools: MARU_MCP_TOOLS });
    }

    if (message.method === "tools/call") {
      if (notification || id === undefined) return undefined;
      if (typeof params.name !== "string") {
        return errorResponse(id, -32602, "Tool name must be a string");
      }
      try {
        return response(
          id,
          await callMaruTool(params.name, params.arguments ?? {}, this.dependencies),
        );
      } catch (error) {
        if (error instanceof UnknownMcpToolError) {
          return errorResponse(id, -32602, error.message);
        }
        return errorResponse(id, -32603, "Internal error");
      }
    }

    return notification ? undefined : errorResponse(id ?? null, -32601, "Method not found");
  }
}

/** Parse one stdio frame and serialize the optional JSON-RPC response. */
export async function handleJsonLine(
  server: MaruMcpServer,
  line: string,
): Promise<string | undefined> {
  let message: unknown;
  try {
    message = JSON.parse(line) as unknown;
  } catch {
    return JSON.stringify(errorResponse(null, -32700, "Parse error"));
  }
  const result = await server.handle(message);
  return result === undefined ? undefined : JSON.stringify(result);
}
