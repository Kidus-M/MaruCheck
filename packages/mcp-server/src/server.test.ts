import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MARU_MCP_TOOLS,
  MCP_PROTOCOL_VERSION,
  MaruMcpServer,
  callMaruTool,
  handleJsonLine,
  runStdioMcpServer,
} from "./index.js";

async function writeFixture(root: string, path: string, content: string): Promise<void> {
  const target = join(root, ...path.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

const CONTRACT = `version: 1
id: web-foundation
title: Web Foundation
status: draft
criticality: medium
intent: The web application exposes a safe health endpoint.
owners:
  - product
  - engineering
requirements:
  - id: WEB-001
    statement: The health endpoint returns a successful JSON response.
    priority: required
invariants:
  - id: WEB-INV-001
    statement: The health endpoint never exposes secrets.
edge_cases:
  - the application is starting
security:
  - do not expose configuration values
data_integrity:
  - return a stable status shape
evidence_policy:
  blocking_requirements:
    - WEB-001
    - WEB-INV-001
`;

describe("MaruCheck MCP server", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "maru-mcp-"));
    await writeFixture(
      root,
      "package.json",
      JSON.stringify({ name: "mcp-fixture", dependencies: { next: "16.0.0", react: "19.0.0" } }),
    );
    await writeFixture(root, "package-lock.json", "{}");
    await writeFixture(root, ".maru/maru.yml", "version: 1\n");
    await writeFixture(root, ".maru/contracts/web-foundation.yml", CONTRACT);
    await writeFixture(root, "src/app/page.tsx", "export default function Page() { return null; }");
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("publishes six namespaced tools with closed input schemas and safety annotations", () => {
    expect(MARU_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "maru_get_project_context",
      "maru_list_contracts",
      "maru_get_contract",
      "maru_create_contract",
      "maru_validate_contract",
      "maru_analyze_diff",
    ]);
    for (const tool of MARU_MCP_TOOLS) {
      expect(tool.inputSchema).toMatchObject({ additionalProperties: false, type: "object" });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
      expect(tool.annotations.openWorldHint).toBe(false);
    }
    expect(
      MARU_MCP_TOOLS.find((tool) => tool.name === "maru_create_contract")?.annotations,
    ).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
      readOnlyHint: false,
    });
  });

  it("lets an agent query project context and a contract before editing code", async () => {
    const context = await callMaruTool("maru_get_project_context", {}, { root });
    const contract = await callMaruTool("maru_get_contract", { id: "web-foundation" }, { root });

    expect(context).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        project: { project: { name: "mcp-fixture" } },
        contracts: [{ id: "web-foundation" }],
      },
    });
    expect(contract).toMatchObject({
      isError: false,
      structuredContent: {
        contract: { id: "web-foundation", requirements: [{ id: "WEB-001" }] },
        ok: true,
      },
    });
  });

  it("creates only draft contracts and validates them", async () => {
    const created = await callMaruTool(
      "maru_create_contract",
      {
        id: "subscription-management",
        requirements:
          "Free users receive 10 generations per month. Upgrades require a verified payment webhook.",
        title: "Subscription Management",
      },
      { root },
    );
    const validation = await callMaruTool("maru_validate_contract", {}, { root });
    const listed = await callMaruTool("maru_list_contracts", {}, { root });

    expect(created).toMatchObject({
      isError: false,
      structuredContent: { contract: { id: "subscription-management", status: "draft" }, ok: true },
    });
    expect(validation).toMatchObject({
      isError: false,
      structuredContent: { invalid: [], ok: true },
    });
    expect(listed.structuredContent).toMatchObject({ ok: true });
    expect((listed.structuredContent as { contracts: unknown[] }).contracts).toHaveLength(2);
  });

  it("returns actionable tool errors and rejects unknown arguments", async () => {
    const missing = await callMaruTool("maru_get_contract", { id: "missing" }, { root });
    const invalid = await callMaruTool(
      "maru_get_contract",
      { id: "web-foundation", extra: true },
      { root },
    );

    expect(missing).toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: "CONTRACT_NOT_FOUND", remediation: expect.stringContaining("list") },
        ok: false,
      },
    });
    expect(invalid).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "INVALID_TOOL_ARGUMENTS" }, ok: false },
    });
  });

  it("returns a bounded Git inventory through analyze_diff", async () => {
    const analyzeDiff = vi.fn().mockResolvedValue({
      clean: false,
      files: [{ indexStatus: "modified", path: "src/app/page.tsx", worktreeStatus: "unchanged" }],
      summary: { added: 0, conflicted: 0, deleted: 0, modified: 1, renamed: 0, untracked: 0 },
    });

    const result = await callMaruTool("maru_analyze_diff", {}, { root, analyzeDiff });

    expect(result).toMatchObject({
      isError: false,
      structuredContent: { diff: { clean: false }, ok: true },
    });
    expect(analyzeDiff).toHaveBeenCalledWith(root);
  });

  it("enforces initialization before listing or calling tools", async () => {
    const server = new MaruMcpServer({ root });
    await expect(
      server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    ).resolves.toMatchObject({ error: { code: -32002 }, id: 1 });

    await expect(
      server.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
          protocolVersion: MCP_PROTOCOL_VERSION,
        },
      }),
    ).resolves.toMatchObject({
      id: 2,
      result: {
        capabilities: { tools: { listChanged: false } },
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: "maru", version: "0.1.0" },
      },
    });
    await expect(
      server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).resolves.toBeUndefined();
    await expect(
      server.handle({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
    ).resolves.toMatchObject({ id: 3, result: { tools: MARU_MCP_TOOLS } });
  });

  it("handles newline-delimited JSON-RPC parsing and protocol errors", async () => {
    const server = new MaruMcpServer({ root });

    await expect(handleJsonLine(server, "not-json")).resolves.toContain('"code":-32700');
    await expect(
      server.handle({ jsonrpc: "2.0", id: null, method: "ping" }),
    ).resolves.toMatchObject({ error: { code: -32600 }, id: null });
    await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
        protocolVersion: MCP_PROTOCOL_VERSION,
      },
    });
    await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
    await expect(
      handleJsonLine(server, JSON.stringify({ jsonrpc: "2.0", id: 4, method: "unknown" })),
    ).resolves.toContain('"code":-32601');
  });

  it("runs a clean newline-delimited stdio session", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let stdout = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      stdout += chunk;
    });
    const session = runStdioMcpServer({ input, output, root });

    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "stdio-test", version: "1.0.0" },
          protocolVersion: MCP_PROTOCOL_VERSION,
        },
      })}\n`,
    );
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.end(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    await session;

    const messages = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 1, jsonrpc: "2.0" });
    expect(messages[1]).toMatchObject({ id: 2, result: { tools: MARU_MCP_TOOLS } });
  });
});
