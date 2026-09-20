import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";

describe("maru CLI", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  async function createProject(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maru-cli-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src/app"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "cli-fixture",
        dependencies: { next: "16.2.11", react: "19.2.8" },
        devDependencies: { typescript: "7.0.0", vitest: "4.0.0" },
      }),
    );
    await writeFile(join(root, "package-lock.json"), "{}");
    await writeFile(
      join(root, "src/app/page.tsx"),
      "export default function Page() { return null; }",
    );
    return root;
  }

  it("prints help without requiring cloud access", async () => {
    const output = { error: vi.fn(), log: vi.fn() };

    await expect(runCli(["--help"], output)).resolves.toBe(0);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Usage: maru <command>"));
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("evidence, findings, and a JSON report"),
    );
    expect(output.error).not.toHaveBeenCalled();
  });

  it("reports the public package version", async () => {
    const output = { error: vi.fn(), log: vi.fn() };

    await expect(runCli(["--version"], output)).resolves.toBe(0);
    expect(output.log).toHaveBeenCalledWith("0.4.0");
    expect(output.error).not.toHaveBeenCalled();
  });

  it("rejects unknown commands", async () => {
    const output = { error: vi.fn(), log: vi.fn() };

    await expect(runCli(["unknown"], output)).resolves.toBe(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
  });

  it("runs init, scan, and doctor end to end", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const dependencies = {
      cwd: root,
      doctorEnvironment: {
        executableAvailable: async () => true,
        runtimeVersion: "v24.1.0",
      },
      now: () => new Date("2026-08-15T18:00:00.000Z"),
    };

    await expect(runCli(["init"], output, dependencies)).resolves.toBe(0);
    await expect(runCli(["scan"], output, dependencies)).resolves.toBe(0);
    await expect(runCli(["doctor"], output, dependencies)).resolves.toBe(0);

    await expect(readFile(join(root, ".maru/maru.yml"), "utf8")).resolves.toContain(
      'name: "cli-fixture"',
    );
    await expect(
      readFile(join(root, ".maru/generated/project-scan.json"), "utf8"),
    ).resolves.toContain('"schemaVersion": 1');
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("MaruCheck initialized"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Project scan written"));
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("Doctor: all required checks passed"),
    );
    expect(output.error).not.toHaveBeenCalled();
  });

  it("explains how to recover when scan runs before initialization", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };

    await expect(runCli(["scan"], output, { cwd: root })).resolves.toBe(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("MARU_NOT_INITIALIZED"));
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("Run maru init"));
  });

  it("runs the local Quality Contract lifecycle", async () => {
    const root = await createProject();
    const requirementsPath = join(root, "requirements.md");
    await writeFile(
      requirementsPath,
      "Free users receive 10 generations each month. Pro users have unlimited generations. Upgrades require a verified payment webhook.",
      "utf8",
    );
    const output = { error: vi.fn(), log: vi.fn() };
    const dependencies = {
      cwd: root,
      now: () => new Date("2026-08-16T09:00:00.000Z"),
    };

    await expect(runCli(["init"], output, dependencies)).resolves.toBe(0);
    await expect(
      runCli(["contract", "create", "--from", "requirements.md"], output, dependencies),
    ).resolves.toBe(0);
    await expect(runCli(["contract", "list"], output, dependencies)).resolves.toBe(0);
    await expect(
      runCli(["contract", "show", "subscription-management"], output, dependencies),
    ).resolves.toBe(0);
    await expect(runCli(["contract", "validate"], output, dependencies)).resolves.toBe(0);
    await expect(
      runCli(
        ["contract", "approve", "subscription-management", "--by", "product-owner"],
        output,
        dependencies,
      ),
    ).resolves.toBe(0);

    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Draft contract created"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("subscription-management"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Contracts valid: 1"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Contract approved"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("blocks semantic drift, stores an amendment proposal, and applies it only after approval", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const dependencies = {
      cwd: root,
      now: () => new Date("2026-08-17T14:00:00.000Z"),
    };
    await runCli(["init"], output, dependencies);
    await mkdir(join(root, ".maru", "contracts"), { recursive: true });
    await writeFile(
      join(root, ".maru", "contracts", "subscription-management.yml"),
      `version: 1
id: subscription-management
title: Subscription Management
status: approved
criticality: critical
intent: Preserve subscription limits.
owners:
  - product
requirements:
  - id: SUB-001
    statement: Free users may upload 5 files.
    priority: required
invariants:
  - id: SUB-INV-001
    statement: Billing changes require a verified webhook.
edge_cases:
  - a free user reaches the quota
security:
  - reject unauthorized plan changes
data_integrity:
  - preserve the active plan
evidence_policy:
  blocking_requirements:
    - SUB-001
approval:
  approved_by: product
  approved_at: "2026-08-16T10:00:00.000Z"
  version_hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`,
      "utf8",
    );
    await writeFile(
      join(root, "observations.json"),
      JSON.stringify({
        observations: [
          {
            observed: "Free users may upload 10 files.",
            requirementRef: "subscription-management#SUB-001",
          },
        ],
      }),
      "utf8",
    );

    await expect(
      runCli(["drift", "check", "--from", "observations.json"], output, dependencies),
    ).resolves.toBe(1);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Semantic drift: BLOCKED"));
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("Contract: Free users may upload 5 files."),
    );
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("Observed: Free users may upload 10 files."),
    );

    await expect(
      runCli(
        [
          "drift",
          "propose",
          "subscription-management",
          "--from",
          "observations.json",
          "--reason",
          "Observed implementation behavior.",
          "--by",
          "codex",
        ],
        output,
        dependencies,
      ),
    ).resolves.toBe(0);
    const proposalMessage = output.log.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.startsWith("Amendment proposed:"));
    const proposalPath = proposalMessage?.split("\n")[0]?.replace("Amendment proposed: ", "");
    expect(proposalPath).toBeTruthy();
    expect(
      await readFile(join(root, ".maru/contracts/subscription-management.yml"), "utf8"),
    ).toContain("Free users may upload 5 files.");

    await expect(
      runCli(["drift", "approve", proposalPath!, "--by", "product"], output, dependencies),
    ).resolves.toBe(0);
    expect(
      await readFile(join(root, ".maru/contracts/subscription-management.yml"), "utf8"),
    ).toContain("Free users may upload 10 files.");
  });

  it("installs the agent gate as a Claude Code Stop hook", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const dependencies = { cwd: root };

    await expect(runCli(["init"], output, dependencies)).resolves.toBe(0);
    await expect(runCli(["hook", "install"], output, dependencies)).resolves.toBe(0);

    const settings = JSON.parse(await readFile(join(root, ".claude", "settings.json"), "utf8")) as {
      hooks: { Stop: { hooks: { command: string }[] }[] };
    };
    expect(settings.hooks.Stop[0]?.hooks[0]?.command).toContain("maru hook run");
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Agent gate installed"));

    await expect(runCli(["hook", "uninstall"], output, dependencies)).resolves.toBe(0);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Agent gate removed"));
  });

  it("returns exit code 2 and the blocking reason when the gate refuses a turn", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const agentGate = vi.fn().mockResolvedValue({
      blocked: true,
      exitCode: 2,
      payload: { hookSpecificOutput: { continue: true, hookEventName: "Stop" } },
      reason: "MaruCheck gate: BLOCKED.",
    });

    await expect(
      runCli(["hook", "run"], output, {
        agentGate,
        agentHookInput: async () => '{"session_id":"abc"}',
        cwd: root,
      }),
    ).resolves.toBe(2);

    expect(agentGate).toHaveBeenCalledWith(root, '{"session_id":"abc"}', expect.any(Date));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining('"hookEventName":"Stop"'));
    expect(output.error).toHaveBeenCalledWith("MaruCheck gate: BLOCKED.");
  });

  it("stays quiet and exits zero when the agent gate has nothing to say", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const agentGate = vi
      .fn()
      .mockResolvedValue({ blocked: false, exitCode: 0, payload: {}, reason: "" });

    await expect(
      runCli(["hook", "run"], output, { agentGate, agentHookInput: async () => "", cwd: root }),
    ).resolves.toBe(0);

    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).not.toHaveBeenCalled();
  });

  it("starts the local MCP server for the current project", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const mcpServer = vi.fn().mockResolvedValue(undefined);

    await expect(runCli(["mcp"], output, { cwd: root, mcpServer })).resolves.toBe(0);

    expect(mcpServer).toHaveBeenCalledWith(root);
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).not.toHaveBeenCalled();
  });

  it("adds, lists, searches, and shows local QA memory", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const dependencies = {
      cwd: root,
      now: () => new Date("2026-08-18T08:00:00.000Z"),
    };
    await runCli(["init"], output, dependencies);
    await writeFile(
      join(root, "invoice-idor.json"),
      JSON.stringify({
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
        source: "manual",
        summary: "Users could access another account's invoice by changing invoiceId.",
        tags: ["authorization", "idor", "invoices"],
        title: "Cross-account invoice access",
        type: "security-regression",
      }),
      "utf8",
    );

    await expect(
      runCli(["memory", "add", "--from", "invoice-idor.json"], output, dependencies),
    ).resolves.toBe(0);
    await expect(runCli(["memory", "list"], output, dependencies)).resolves.toBe(0);
    await expect(
      runCli(["memory", "search", "invoice authorization"], output, dependencies),
    ).resolves.toBe(0);
    await expect(runCli(["memory", "show", "MEM-0001"], output, dependencies)).resolves.toBe(0);

    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("QA memory recorded: MEM-0001"),
    );
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("MEM-0001\tcritical"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Memory matches: 1"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining('"rootCause"'));
    expect(output.error).not.toHaveBeenCalled();

    await writeFile(
      join(root, "invoice-rewrite.json"),
      JSON.stringify({
        ...JSON.parse(await readFile(join(root, "invoice-idor.json"), "utf8")),
        supersedes: ["MEM-0001"],
        title: "Invoice ownership rewrite",
      }),
      "utf8",
    );
    await expect(
      runCli(["memory", "add", "--from", "invoice-rewrite.json"], output, dependencies),
    ).resolves.toBe(0);
    await expect(runCli(["memory", "list"], output, dependencies)).resolves.toBe(0);
    expect(output.log).toHaveBeenLastCalledWith(
      expect.stringContaining("Cross-account invoice access\t(superseded by MEM-0002)"),
    );
  });

  it("explains QA memory relevance alongside the risk assessment", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const memory = {
      exactFileMatches: ["src/services/invoices.ts"],
      matchedTerms: ["invoice"],
      memoryId: "MEM-0001",
      reasons: ["Changed 1 file linked to historical memory MEM-0001."],
      regressionTests: [],
      relatedContracts: ["invoice-access"],
      severity: "critical" as const,
      title: "Cross-account invoice access",
      type: "security-regression" as const,
    };
    const riskAssessment = vi.fn().mockResolvedValue({
      analysis: { clean: false, files: [], summary: { additions: 1, changedFiles: 1, deletions: 1 } },
      historicalRisks: [
        {
          ...memory,
          relevance: {
            level: "high",
            score: 100,
            signals: [
              {
                code: "related-contracts-active",
                message: "Related Quality Contract remains active: invoice-access (approved).",
                points: 0,
              },
            ],
            supersededBy: [],
          },
        },
        {
          ...memory,
          memoryId: "MEM-0002",
          relevance: {
            level: "low",
            score: 30,
            signals: [
              {
                code: "superseded",
                message: "Superseded by newer QA memory: MEM-0003.",
                points: -70,
              },
            ],
            supersededBy: ["MEM-0003"],
          },
        },
      ],
      level: "high",
      reasons: [
        { code: "historical-regression", message: "Touches relevant history.", points: 25 },
        { code: "historical-stale", message: "Preserved stale history.", points: 0 },
      ],
      recommendedTestCategories: ["contract-regression", "unit"],
      relatedContracts: [],
      score: 50,
    });

    await expect(runCli(["risk", "--diff"], output, { cwd: root, riskAssessment })).resolves.toBe(
      0,
    );

    const printed = output.log.mock.calls[0]?.[0] as string;
    expect(printed).toContain("Historical risks: MEM-0001 (high), MEM-0002 (low)");
    expect(printed).toContain(
      [
        "QA memory MEM-0001: relevance HIGH (100/100)",
        "  - Related Quality Contract remains active: invoice-access (approved).",
        "  Risk increased.",
        "QA memory MEM-0002: relevance LOW (30/100)",
        "  - Superseded by newer QA memory: MEM-0003.",
        "  Historical record preserved, but no risk increase applied.",
      ].join("\n"),
    );
    expect(printed).toContain("+0 Preserved stale history.");
    expect(output.error).not.toHaveBeenCalled();
  });

  it("prints an inspectable deterministic risk assessment for the current diff", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const riskAssessment = vi.fn().mockResolvedValue({
      analysis: {
        clean: false,
        files: [],
        summary: { additions: 8, changedFiles: 1, deletions: 1 },
      },
      level: "critical",
      historicalRisks: [],
      reasons: [
        { code: "billing", message: "Touches billing and payments.", points: 30 },
        { code: "external-integration", message: "Touches a webhook.", points: 15 },
      ],
      recommendedTestCategories: ["api", "contract-regression", "security", "unit"],
      relatedContracts: [
        {
          contractId: "subscription-management",
          criticality: "critical",
          invariantIds: ["SUB-INV-001"],
          matchedTerms: ["subscription", "webhook"],
          requirementIds: ["SUB-001"],
          status: "approved",
          title: "Subscription Management",
        },
      ],
      score: 92,
    });

    await expect(runCli(["risk", "--diff"], output, { cwd: root, riskAssessment })).resolves.toBe(
      0,
    );

    expect(riskAssessment).toHaveBeenCalledWith(root);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Risk: CRITICAL (92/100)"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("+30 Touches billing"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("subscription-management"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("contract-regression"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("writes and summarizes an inspectable verification plan for the current diff", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const verificationPlan = vi.fn().mockResolvedValue({
      path: ".maru/generated/verification-plan.json",
      plan: {
        affectedTests: [
          {
            framework: "vitest",
            matchedTerms: ["subscription"],
            path: "tests/subscription.test.ts",
            requirementRefs: ["subscription-management#SUB-001"],
          },
        ],
        changeSummary: { additions: 4, changedFiles: 1, deletions: 1 },
        generatedAt: "2026-08-16T12:00:00.000Z",
        project: { name: "cli-fixture", testFrameworks: ["vitest"] },
        risk: { level: "high", score: 72 },
        schemaVersion: 1,
        scope: "working-tree",
        selectedRequirements: [
          {
            blocking: true,
            contractId: "subscription-management",
            contractTitle: "Subscription Management",
            id: "SUB-001",
            kind: "requirement",
            priority: "required",
            reasons: ["Matched diff terms."],
            statement: "Subscription changes require a verified webhook.",
          },
        ],
        steps: [
          {
            adapter: "vitest",
            blocking: true,
            category: "unit",
            execution: "automated",
            id: "step-01-unit",
            reasons: ["High risk.", "Vitest detected."],
            requirementRefs: ["subscription-management#SUB-001"],
            testFiles: ["tests/subscription.test.ts"],
          },
        ],
        summary: {
          affectedTests: 1,
          automatedSteps: 1,
          manualSteps: 0,
          selectedRequirements: 1,
          unavailableSteps: 0,
        },
        uncoveredRequirements: [],
      },
    });

    await expect(runCli(["plan", "--diff"], output, { cwd: root, verificationPlan })).resolves.toBe(
      0,
    );

    expect(verificationPlan).toHaveBeenCalledWith(root, expect.any(Date));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Verification plan written"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Risk: HIGH (72/100)"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Requirements: 1"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Affected tests: 1"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("runs verification for the current diff and blocks failed required evidence", async () => {
    const root = await createProject();
    const now = new Date("2026-08-17T09:30:00.000Z");
    const output = { error: vi.fn(), log: vi.fn() };
    const verificationReport = vi.fn().mockResolvedValue({
      path: ".maru/artifacts/runs/2026-08-17T09-30-00-000Z/report.json",
      report: {
        evidence: [{ id: "evidence-001-vitest" }],
        findings: [
          {
            actual: "Received: active",
            artifactRefs: [".maru/artifacts/runs/run-id/vitest/stderr.txt"],
            blocking: true,
            contractId: "subscription-management",
            evidenceIds: ["evidence-001-vitest"],
            expected: "Cancellation remains active until period_end.",
            id: "finding-001-subscription-management-sub-003",
            reproduction: { command: "maru verify --diff", steps: ["Run verification."] },
            requirementId: "SUB-003",
            severity: "critical",
            title: "SUB-003 verification failed",
          },
        ],
        gate: { reasons: ["1 blocking finding remains open."], status: "blocked" },
        requirementEvidence: [{ status: "failed" }],
        runId: "2026-08-17T09-30-00-000Z",
        runStatus: "failed",
        summary: {
          blockingFindings: 1,
          evidence: 1,
          failedEvidence: 1,
          findings: 1,
          inconclusiveEvidence: 0,
          passedEvidence: 0,
          requirementsFailed: 1,
          requirementsInconclusive: 0,
          requirementsPassed: 0,
          requirementsUnverified: 0,
        },
      },
    });

    await expect(
      runCli(["verify", "--diff"], output, {
        cwd: root,
        now: () => now,
        verificationReport,
      }),
    ).resolves.toBe(1);

    expect(verificationReport).toHaveBeenCalledWith(root, now);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Verification gate: BLOCKED"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("[CRITICAL] BLOCKING"));
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("Contract: subscription-management"),
    );
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Requirement: SUB-003"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Actual: Received: active"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("JSON report:"));
  });

  it("explicitly uploads one report using environment credentials", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const hostedUpload = vi.fn().mockResolvedValue({
      dashboardURL: "https://app.marucheck.dev/projects",
      endpoint: "https://app.marucheck.dev/api/v1/ingest/runs",
      reportPath: ".maru/artifacts/runs/RUN-1048/report.json",
      runId: "RUN-1048",
    });
    const environment = { MARUCHECK_TOKEN: "maru_private" };

    await expect(
      runCli(
        [
          "upload",
          "--report",
          ".maru/artifacts/runs/RUN-1048/report.json",
          "--url",
          "https://app.marucheck.dev",
        ],
        output,
        { cwd: root, environment, hostedUpload },
      ),
    ).resolves.toBe(0);

    expect(hostedUpload).toHaveBeenCalledWith(root, {
      baseURL: "https://app.marucheck.dev",
      environment,
      reportPath: ".maru/artifacts/runs/RUN-1048/report.json",
    });
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Hosted report accepted"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Run: RUN-1048"));
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("Report: .maru/artifacts/runs/RUN-1048/report.json"),
    );
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("no source code"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("uploads the newest report with local connection defaults", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const environment = {};
    const hostedUpload = vi.fn().mockResolvedValue({
      dashboardURL: "https://app.marucheck.dev/projects",
      endpoint: "https://app.marucheck.dev/api/v1/ingest/runs",
      reportPath: ".maru/artifacts/runs/RUN-2048/report.json",
      runId: "RUN-2048",
    });

    await expect(
      runCli(["upload"], output, { cwd: root, environment, hostedUpload }),
    ).resolves.toBe(0);

    expect(hostedUpload).toHaveBeenCalledWith(root, { environment });
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Run: RUN-2048"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("rejects malformed upload commands before any network request", async () => {
    const output = { error: vi.fn(), log: vi.fn() };
    const hostedUpload = vi.fn();

    await expect(
      runCli(["upload", "--url", "https://one.example", "--url", "https://two.example"], output, {
        hostedUpload,
      }),
    ).resolves.toBe(1);

    expect(hostedUpload).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("maru upload [--report"));
  });

  it("runs bounded mutation verification and blocks when verification is weak", async () => {
    const root = await createProject();
    const now = new Date("2026-08-20T12:00:00.000Z");
    const output = { error: vi.fn(), log: vi.fn() };
    const mutationVerification = vi.fn().mockResolvedValue({
      path: ".maru/artifacts/mutations/run/report.json",
      report: {
        baseline: { artifactRefs: [], resultStatuses: ["passed"], status: "passed" },
        completedAt: now.toISOString(),
        generatedAt: now.toISOString(),
        gate: { reasons: ["1 mutation survived selected tests."], status: "blocked" },
        mutations: [
          {
            artifactRefs: [],
            candidate: {
              column: 3,
              description: "Remove ownership guard.",
              file: "src/access.ts",
              id: "MUT-0001",
              kind: "remove-ownership-condition",
              line: 4,
              original: "if (ownerId !== userId) return false;",
              replacement: "",
            },
            durationMs: 9,
            outcome: "survived",
            resultStatuses: ["passed"],
          },
        ],
        project: { name: "cli-fixture" },
        schemaVersion: 1,
        scope: "working-tree",
        summary: { candidates: 1, executed: 1, inconclusive: 0, killed: 0, survived: 1 },
        worktreeCleaned: true,
      },
    });

    await expect(
      runCli(["mutate", "--diff", "--max", "8"], output, {
        cwd: root,
        mutationVerification,
        now: () => now,
      }),
    ).resolves.toBe(1);

    expect(mutationVerification).toHaveBeenCalledWith(root, now, 8);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("WEAK VERIFICATION DETECTED"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Worktree cleaned: yes"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("rejects malformed mutation commands before running a worktree", async () => {
    const output = { error: vi.fn(), log: vi.fn() };
    const mutationVerification = vi.fn();

    await expect(runCli(["mutate", "--max", "4"], output, { mutationVerification })).resolves.toBe(
      1,
    );

    expect(mutationVerification).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("maru mutate --diff"));

    await expect(
      runCli(["mutate", "--diff", "--max", "many"], output, { mutationVerification }),
    ).resolves.toBe(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("integer from 1 to 100"));
  });

  it("prepares an explicit Challenger brief for a fresh QA context", async () => {
    const root = await createProject();
    const now = new Date("2026-08-20T20:10:00.000Z");
    const output = { error: vi.fn(), log: vi.fn() };
    const challengeBrief = vi.fn().mockResolvedValue({
      path: ".maru/artifacts/challenges/challenge-id/brief.json",
      brief: {
        activation: {
          activated: true,
          triggers: ["explicit-request", "release-verification"],
        },
        briefHash: "a".repeat(64),
        briefId: "challenge-id",
        context: { changedFiles: [{}], historicalRisks: [], requirements: [{}], riskReasons: [] },
        createdAt: now.toISOString(),
        instructions: [],
        responseSchema: {},
        risk: { level: "critical", score: 90 },
        schemaVersion: 1,
        scope: "working-tree",
      },
    });

    await expect(
      runCli(["challenge", "prepare", "--diff", "--release"], output, {
        challengeBrief,
        cwd: root,
        now: () => now,
      }),
    ).resolves.toBe(0);

    expect(challengeBrief).toHaveBeenCalledWith(root, now, {
      explicit: true,
      releaseVerification: true,
    });
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("fresh QA thread/subagent"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("a".repeat(64)));
  });

  it("submits a client-produced Challenger response and maps its gate", async () => {
    const root = await createProject();
    const now = new Date("2026-08-20T20:11:00.000Z");
    const output = { error: vi.fn(), log: vi.fn() };
    const challengeSubmission = vi.fn().mockResolvedValue({
      path: ".maru/artifacts/challenges/challenge-id/report.json",
      report: {
        challenges: [{ id: "cross-tenant-read" }],
        gate: { reasons: [], status: "passed" },
        provenance: {
          attested: true,
          client: "Codex",
          isolation: "subagent",
          usage: { source: "not-reported" },
        },
        status: "completed",
      },
    });

    await expect(
      runCli(
        [
          "challenge",
          "submit",
          "--brief",
          ".maru/artifacts/challenges/challenge-id/brief.json",
          "--from",
          "challenge-response.json",
        ],
        output,
        { challengeSubmission, cwd: root, now: () => now },
      ),
    ).resolves.toBe(0);
    expect(challengeSubmission).toHaveBeenCalledWith(
      root,
      ".maru/artifacts/challenges/challenge-id/brief.json",
      "challenge-response.json",
      now,
    );
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Codex"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("review hypotheses"));
  });

  it("rejects malformed Challenger commands before preparing or submitting", async () => {
    const output = { error: vi.fn(), log: vi.fn() };
    const challengeBrief = vi.fn();
    const challengeSubmission = vi.fn();

    await expect(
      runCli(["challenge", "prepare", "--release"], output, { challengeBrief }),
    ).resolves.toBe(1);
    await expect(
      runCli(["challenge", "submit", "--brief", "brief.json"], output, {
        challengeSubmission,
      }),
    ).resolves.toBe(1);
    expect(challengeBrief).not.toHaveBeenCalled();
    expect(challengeSubmission).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("maru challenge prepare"));
  });

  it("installs GitHub pull-request verification from the CLI", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const dependencies = { cwd: root };
    await runCli(["init"], output, dependencies);

    await expect(runCli(["ci", "init"], output, dependencies)).resolves.toBe(0);

    await expect(
      readFile(join(root, ".github", "workflows", "marucheck.yml"), "utf8"),
    ).resolves.toContain("npx --no-install maru ci verify");
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("GitHub workflow installed"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("fails the CI command after publishing a readable blocking summary", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const ciVerification = vi.fn().mockResolvedValue({
      conclusion: "failure",
      publishedToGitHub: true,
      reportPath: ".maru/artifacts/runs/pr-42/report.json",
      summaryPath: ".maru/generated/github-summary.md",
    });

    await expect(
      runCli(["ci", "verify"], output, {
        ciVerification,
        cwd: root,
        now: () => new Date("2026-08-18T10:00:00.000Z"),
      }),
    ).resolves.toBe(1);

    expect(ciVerification).toHaveBeenCalledWith(root, expect.any(Date));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("ProofLayer: FAILURE"));
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("GitHub summary: .maru/generated/github-summary.md"),
    );
  });
});
