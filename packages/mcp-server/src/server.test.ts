import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("publishes sixteen namespaced tools with closed input schemas and safety annotations", () => {
    expect(MARU_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "maru_get_project_context",
      "maru_list_contracts",
      "maru_get_contract",
      "maru_create_contract",
      "maru_validate_contract",
      "maru_analyze_diff",
      "maru_assess_risk",
      "maru_create_verification_plan",
      "maru_run_verification",
      "maru_run_mutation_verification",
      "maru_prepare_challenge",
      "maru_submit_challenge",
      "maru_check_semantic_drift",
      "maru_propose_contract_amendment",
      "maru_record_bug",
      "maru_query_memory",
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
    expect(
      MARU_MCP_TOOLS.find((tool) => tool.name === "maru_create_verification_plan")?.annotations,
    ).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
      readOnlyHint: false,
    });
    expect(
      MARU_MCP_TOOLS.find((tool) => tool.name === "maru_run_verification")?.annotations,
    ).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
      readOnlyHint: false,
    });
    expect(
      MARU_MCP_TOOLS.find((tool) => tool.name === "maru_run_mutation_verification")?.annotations,
    ).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
      readOnlyHint: false,
    });
    expect(
      MARU_MCP_TOOLS.find((tool) => tool.name === "maru_check_semantic_drift")?.annotations,
    ).toMatchObject({ readOnlyHint: true });
    expect(
      MARU_MCP_TOOLS.find((tool) => tool.name === "maru_propose_contract_amendment")?.annotations,
    ).toMatchObject({ readOnlyHint: false });
    expect(
      MARU_MCP_TOOLS.find((tool) => tool.name === "maru_record_bug")?.annotations,
    ).toMatchObject({ readOnlyHint: false });
    expect(
      MARU_MCP_TOOLS.find((tool) => tool.name === "maru_query_memory")?.annotations,
    ).toMatchObject({ readOnlyHint: true });
  });

  it("lets an agent query project context and a contract before editing code", async () => {
    const context = await callMaruTool("maru_get_project_context", {}, { root });
    const contract = await callMaruTool("maru_get_contract", { id: "web-foundation" }, { root });

    expect(context).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        project: {
          project: { name: "mcp-fixture" },
          source: {
            fileCount: 1,
            filesTruncated: false,
            sampleFiles: ["src/app/page.tsx"],
          },
        },
        contracts: [{ id: "web-foundation" }],
      },
    });
    expect(
      (context.structuredContent.project as { source: Record<string, unknown> }).source,
    ).not.toHaveProperty("files");
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

  it("returns deterministic risk and related contract evidence through assess_risk", async () => {
    const assessRisk = vi.fn().mockResolvedValue({
      analysis: {
        clean: false,
        files: [],
        summary: { additions: 3, changedFiles: 1, deletions: 1 },
      },
      level: "critical",
      reasons: [{ code: "billing", message: "Touches billing.", points: 30 }],
      recommendedTestCategories: ["api", "security"],
      relatedContracts: [{ contractId: "subscription-management" }],
      score: 86,
    });

    const result = await callMaruTool("maru_assess_risk", {}, { root, assessRisk });

    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        assessment: {
          level: "critical",
          relatedContracts: [{ contractId: "subscription-management" }],
          score: 86,
        },
        ok: true,
      },
    });
    expect(assessRisk).toHaveBeenCalledWith(root);
  });

  it("creates a persisted, requirement-linked verification plan", async () => {
    const createVerificationPlan = vi.fn().mockResolvedValue({
      path: ".maru/generated/verification-plan.json",
      plan: {
        risk: { level: "high", score: 70 },
        schemaVersion: 1,
        selectedRequirements: [{ contractId: "web-foundation", id: "WEB-001" }],
        steps: [{ adapter: "vitest", category: "unit" }],
      },
    });

    const result = await callMaruTool(
      "maru_create_verification_plan",
      {},
      { root, createVerificationPlan, now: () => new Date("2026-08-16T12:00:00.000Z") },
    );

    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        path: ".maru/generated/verification-plan.json",
        plan: {
          selectedRequirements: [{ contractId: "web-foundation", id: "WEB-001" }],
          steps: [{ adapter: "vitest", category: "unit" }],
        },
      },
    });
    expect(createVerificationPlan).toHaveBeenCalledWith(root, new Date("2026-08-16T12:00:00.000Z"));
  });

  it("runs verification with optional requirement-tagged temporary tests", async () => {
    const verificationReport = vi.fn().mockResolvedValue({
      path: ".maru/artifacts/runs/run-id/report.json",
      planPath: ".maru/generated/verification-plan.json",
      report: {
        evidence: [{ id: "evidence-001-vitest", status: "failed" }],
        findings: [
          {
            blocking: true,
            contractId: "web-foundation",
            evidenceIds: ["evidence-001-vitest"],
            requirementId: "WEB-001",
            severity: "high",
          },
        ],
        gate: { status: "blocked" },
        schemaVersion: 1,
      },
      run: {
        generatedTests: [
          {
            adapter: "vitest",
            artifactPath: ".maru/artifacts/runs/run-id/generated/vitest-cancel.test.ts",
            id: "cancel-immediately",
            requirementRefs: ["web-foundation#WEB-001"],
            targetPath: "tests/.maru-cancel.test.ts",
          },
        ],
        status: "failed",
        summary: { blockingFailures: 1, failed: 1 },
      },
      runPath: ".maru/artifacts/runs/run-id/run.json",
    });
    const temporaryTests = [
      {
        adapter: "vitest",
        id: "cancel-immediately",
        requirementRefs: ["web-foundation#WEB-001"],
        source: "test('cancel', () => expect(false).toBe(true));",
        targetPath: "tests/.maru-cancel.test.ts",
      },
    ];

    const result = await callMaruTool(
      "maru_run_verification",
      { temporaryTests },
      {
        now: () => new Date("2026-08-17T09:30:00.000Z"),
        root,
        verificationReport,
      },
    );

    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        path: ".maru/artifacts/runs/run-id/report.json",
        report: {
          findings: [
            expect.objectContaining({
              contractId: "web-foundation",
              evidenceIds: ["evidence-001-vitest"],
              requirementId: "WEB-001",
            }),
          ],
          gate: { status: "blocked" },
        },
        run: { status: "failed", summary: { blockingFailures: 1 } },
        runPath: ".maru/artifacts/runs/run-id/run.json",
      },
    });
    expect(verificationReport).toHaveBeenCalledWith(root, new Date("2026-08-17T09:30:00.000Z"), {
      temporaryTests,
    });
  });

  it("lets any compatible agent run bounded isolated mutation verification", async () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const mutationVerification = vi.fn().mockResolvedValue({
      path: ".maru/artifacts/mutations/run/report.json",
      report: {
        baseline: { artifactRefs: [], resultStatuses: ["passed"], status: "passed" },
        completedAt: now.toISOString(),
        generatedAt: now.toISOString(),
        gate: { reasons: ["All 1 executed mutations were killed."], status: "passed" },
        mutations: [],
        project: { name: "mcp-fixture" },
        schemaVersion: 1,
        scope: "working-tree",
        summary: { candidates: 1, executed: 1, inconclusive: 0, killed: 1, survived: 0 },
        worktreeCleaned: true,
      },
    });

    const result = await callMaruTool(
      "maru_run_mutation_verification",
      { maxMutations: 6 },
      { mutationVerification, now: () => now, root },
    );

    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        path: ".maru/artifacts/mutations/run/report.json",
        report: { gate: { status: "passed" }, worktreeCleaned: true },
      },
    });
    expect(mutationVerification).toHaveBeenCalledWith(root, now, { maxMutations: 6 });

    const invalid = await callMaruTool(
      "maru_run_mutation_verification",
      { maxMutations: 0 },
      { mutationVerification, root },
    );
    expect(invalid).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "INVALID_TOOL_ARGUMENTS" } },
    });
  });

  it("lets compatible clients prepare and submit an isolated challenge", async () => {
    const now = new Date("2026-08-20T20:15:00.000Z");
    const challengeBrief = vi.fn().mockResolvedValue({
      path: ".maru/artifacts/challenges/challenge-id/brief.json",
      brief: {
        activation: { activated: true, triggers: ["explicit-request"] },
        briefHash: "a".repeat(64),
        briefId: "challenge-id",
        schemaVersion: 1,
      },
    });

    const prepared = await callMaruTool(
      "maru_prepare_challenge",
      { releaseVerification: true },
      { challengeBrief, now: () => now, root },
    );

    expect(prepared).toMatchObject({
      isError: false,
      structuredContent: {
        brief: { briefId: "challenge-id" },
        ok: true,
        path: ".maru/artifacts/challenges/challenge-id/brief.json",
      },
    });
    expect(challengeBrief).toHaveBeenCalledWith(root, now, {
      explicit: true,
      releaseVerification: true,
    });

    const submission = {
      briefHash: "a".repeat(64),
      briefId: "challenge-id",
      provenance: { attested: true, client: "Codex", isolation: "subagent" },
      result: { challenges: [], summary: "No additional challenge found." },
      schemaVersion: 1,
    };
    const challengeSubmission = vi.fn().mockResolvedValue({
      path: ".maru/artifacts/challenges/challenge-id/report.json",
      report: { gate: { status: "passed" }, status: "completed" },
    });
    const submitted = await callMaruTool(
      "maru_submit_challenge",
      {
        briefPath: ".maru/artifacts/challenges/challenge-id/brief.json",
        submission,
      },
      { challengeSubmission, now: () => now, root },
    );
    expect(submitted).toMatchObject({
      isError: false,
      structuredContent: { ok: true, report: { status: "completed" } },
    });
    expect(challengeSubmission).toHaveBeenCalledWith(
      root,
      ".maru/artifacts/challenges/challenge-id/brief.json",
      submission,
      now,
    );

    const invalid = await callMaruTool(
      "maru_prepare_challenge",
      { releaseVerification: "yes" },
      { challengeBrief, root },
    );
    expect(invalid).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "INVALID_TOOL_ARGUMENTS" } },
    });
  });

  it("reports semantic conflicts and can propose but never approve an amendment", async () => {
    await writeFixture(
      root,
      ".maru/contracts/web-foundation.yml",
      CONTRACT.replace("status: draft", "status: approved").replace(
        "evidence_policy:",
        `approval:
  approved_by: product
  approved_at: "2026-08-16T10:00:00.000Z"
  version_hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
evidence_policy:`,
      ),
    );
    const observations = [
      {
        observed: "The health endpoint returns an unsuccessful JSON response.",
        requirementRef: "web-foundation#WEB-001",
      },
    ];

    const checked = await callMaruTool("maru_check_semantic_drift", { observations }, { root });
    const proposed = await callMaruTool(
      "maru_propose_contract_amendment",
      {
        contractId: "web-foundation",
        observations,
        proposedBy: "codex",
        reason: "Observed local behavior differs from the approved requirement.",
      },
      { now: () => new Date("2026-08-17T14:00:00.000Z"), root },
    );

    expect(checked).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        report: {
          classification: "semantic",
          gate: { status: "blocked" },
        },
      },
    });
    expect(proposed).toMatchObject({
      isError: false,
      structuredContent: {
        approvalRequired: true,
        ok: true,
        proposal: { approval: { status: "pending" }, status: "proposed" },
      },
    });
    expect(await readFile(join(root, ".maru/contracts/web-foundation.yml"), "utf8")).toContain(
      "The health endpoint returns a successful JSON response.",
    );
  });

  it("records a historical bug and returns it to any compatible coding agent", async () => {
    const memory = {
      regressionTests: [
        {
          adapter: "vitest",
          id: "invoice-cross-account-access",
          path: "tests/regressions/cross-account.test.ts",
          requirementRefs: ["invoice-access#INV-001"],
        },
      ],
      relatedContracts: ["invoice-access"],
      relatedFiles: ["src/services/invoices.ts"],
      rootCause: "Missing ownership check.",
      severity: "critical",
      summary: "Users could access another account's invoice.",
      tags: ["authorization", "idor", "invoices"],
      title: "Cross-account invoice access",
      type: "security-regression",
    };

    const recorded = await callMaruTool("maru_record_bug", memory, {
      now: () => new Date("2026-08-18T08:00:00.000Z"),
      root,
    });
    const queried = await callMaruTool(
      "maru_query_memory",
      { query: "invoice authorization" },
      { root },
    );

    expect(recorded).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        path: ".maru/memory/MEM-0001.json",
        record: { id: "MEM-0001", source: "coding-agent" },
      },
    });
    expect(queried).toMatchObject({
      isError: false,
      structuredContent: {
        matches: [expect.objectContaining({ record: expect.objectContaining({ id: "MEM-0001" }) })],
        ok: true,
      },
    });
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
        serverInfo: { name: "maru", version: "0.4.0" },
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
