export const MARU_MCP_SERVER_NAME = "maru";

export { MCP_PROTOCOL_VERSION, MaruMcpServer, handleJsonLine } from "./server.js";
export { runStdioMcpServer, type StdioMcpOptions } from "./stdio.js";
export {
  MARU_MCP_TOOLS,
  UnknownMcpToolError,
  callMaruTool,
  type MaruToolDependencies,
} from "./tools.js";
export type {
  JsonObject,
  JsonRpcId,
  JsonRpcResponse,
  MaruMcpToolName,
  McpToolDefinition,
  McpToolResult,
} from "./types.js";
