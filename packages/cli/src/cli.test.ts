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

  it("starts the local MCP server for the current project", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const mcpServer = vi.fn().mockResolvedValue(undefined);

    await expect(runCli(["mcp"], output, { cwd: root, mcpServer })).resolves.toBe(0);

    expect(mcpServer).toHaveBeenCalledWith(root);
    expect(output.log).not.toHaveBeenCalled();
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
});
