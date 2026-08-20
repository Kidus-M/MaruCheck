import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReasoningError, type ReasoningProvider } from "@maru/reasoning";
import type { RiskAssessment } from "@maru/risk";
import {
  buildChallengeActivation,
  createAndWriteChallengeReport,
  formatChallengeReport,
} from "./index.js";

const roots: string[] = [];

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "maru-challenger-test-"));
  roots.push(root);
  return root;
}

function risk(level: RiskAssessment["level"]): RiskAssessment {
  const score = { critical: 90, high: 65, low: 10, moderate: 35 }[level];
  return {
    analysis: {
      clean: false,
      files: [
        {
          additions: 12,
          binary: false,
          classifications: ["authorization", "business-logic", "security-sensitive"],
          deletions: 3,
          hunks: [{ context: "readInvoice", newLines: 12, newStart: 20, oldLines: 3, oldStart: 20 }],
          path: "src/invoices/read-invoice.ts",
          status: "modified",
          symbols: ["readInvoice"],
        },
      ],
      summary: { additions: 12, binaryFiles: 0, changedFiles: 1, deletions: 3 },
    },
    historicalRisks: [],
    level,
    reasons: [{ code: "authorization", message: "Touches authorization.", points: 25 }],
    recommendedTestCategories: ["security", "unit"],
    relatedContracts: [
      {
        contractId: "invoice-access",
        criticality: "critical",
        invariantIds: ["INV-INV-001"],
        matchedTerms: ["invoice"],
        requirementIds: ["INV-001"],
        status: "approved",
        title: "Invoice access",
      },
    ],
    score,
  };
}

const output = {
  challenges: [
    {
      category: "permission-abuse",
      counterexample: "A signed-in user requests an invoice owned by a different organization.",
      id: "cross-tenant-invoice-read",
      priority: "critical",
      requirementRefs: ["invoice-access#INV-001", "invoice-access#INV-INV-001"],
      targetFiles: ["src/invoices/read-invoice.ts"],
      title: "Cross-tenant invoice read",
      verification: {
        category: "security",
        objective: "Prove ownership is enforced after authentication.",
        steps: ["Create invoices for two organizations.", "Request organization B's invoice as A."],
      },
      whyLikelyMissed: "A happy-path authentication test does not exercise tenant isolation.",
    },
  ],
  summary: "Challenge the authorization boundary independently of authentication.",
};

function provider(overrides: Partial<ReasoningProvider> = {}): ReasoningProvider {
  return {
    id: "test-provider",
    model: "test-model",
    reason: vi.fn().mockResolvedValue({
      output,
      provider: { id: "test-provider", model: "test-model" },
      requestId: "ignored-by-fixture",
      usage: {
        durationMs: 25,
        estimatedCostUsd: 0.04,
        inputTokens: 300,
        outputTokens: 120,
        totalTokens: 420,
      },
    }),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Challenger activation", () => {
  it("activates only for high/critical risk, explicit requests, or release verification", () => {
    expect(buildChallengeActivation("low", {})).toEqual({ activated: false, triggers: [] });
    expect(buildChallengeActivation("high", {})).toEqual({
      activated: true,
      triggers: ["high-risk"],
    });
    expect(buildChallengeActivation("critical", { explicit: true, releaseVerification: true }))
      .toEqual({
        activated: true,
        triggers: ["critical-risk", "explicit-request", "release-verification"],
      });
    expect(buildChallengeActivation("moderate", { explicit: true })).toEqual({
      activated: true,
      triggers: ["explicit-request"],
    });
  });
});

describe("Challenger report", () => {
  it("skips low-risk work without contacting a provider", async () => {
    const root = await projectRoot();
    const reasoning = provider();
    const result = await createAndWriteChallengeReport(root, new Date("2026-08-20T20:00:00Z"), {
      assessRisk: vi.fn().mockResolvedValue(risk("low")),
      provider: reasoning,
    });

    expect(result.report.status).toBe("skipped");
    expect(result.report.gate.status).toBe("passed");
    expect(reasoning.reason).not.toHaveBeenCalled();
  });

  it("records validated adversarial cases, provenance, and exact cost in one call", async () => {
    const root = await projectRoot();
    const reasoning = provider();
    const result = await createAndWriteChallengeReport(root, new Date("2026-08-20T20:01:00Z"), {
      assessRisk: vi.fn().mockResolvedValue(risk("critical")),
      contractRequirements: vi.fn().mockResolvedValue([
        { contractId: "invoice-access", id: "INV-001", kind: "requirement", statement: "Users may only read invoices owned by their organization." },
        { contractId: "invoice-access", id: "INV-INV-001", kind: "invariant", statement: "Cross-organization invoice access is forbidden." },
      ]),
      provider: reasoning,
    });

    expect(result.report.status).toBe("completed");
    expect(result.report.gate).toEqual({ reasons: [], status: "passed" });
    expect(result.report.challenges).toEqual(output.challenges);
    expect(result.report.provider).toEqual({ id: "test-provider", model: "test-model" });
    expect(result.report.usage).toEqual({
      calls: 1,
      durationMs: 25,
      estimatedCostUsd: 0.04,
      inputTokens: 300,
      outputTokens: 120,
      totalTokens: 420,
    });
    expect(reasoning.reason).toHaveBeenCalledOnce();
    const sent = vi.mocked(reasoning.reason).mock.calls[0]![0];
    expect(sent.input).not.toHaveProperty("source");
    expect(JSON.stringify(sent.input)).not.toContain("secret-value");
    expect(JSON.parse(await readFile(join(root, ...result.path.split("/")), "utf8"))).toEqual(
      result.report,
    );
    expect(formatChallengeReport(result)).toContain("Cross-tenant invoice read");
  });

  it("loads protected requirement and invariant text from the real contract repository", async () => {
    const root = await projectRoot();
    await mkdir(join(root, ".maru", "contracts"), { recursive: true });
    await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n", "utf8");
    await writeFile(
      join(root, ".maru", "contracts", "invoice-access.yml"),
      `version: 1
id: invoice-access
title: Invoice access
status: approved
criticality: critical
intent: Enforce organization ownership for invoice reads.
owners:
  - security
requirements:
  - id: INV-001
    statement: Users may only read invoices owned by their organization.
    priority: required
invariants:
  - id: INV-INV-001
    statement: Cross-organization invoice access is forbidden.
edge_cases:
  - an authenticated user guesses another organization invoice id
security:
  - enforce ownership after authentication
data_integrity:
  - every invoice belongs to one organization
evidence_policy:
  blocking_requirements:
    - INV-001
    - INV-INV-001
`,
      "utf8",
    );
    const reasoning = provider();

    const result = await createAndWriteChallengeReport(root, new Date("2026-08-20T20:01:30Z"), {
      assessRisk: vi.fn().mockResolvedValue(risk("critical")),
      provider: reasoning,
    });

    expect(result.report.status).toBe("completed");
    const input = vi.mocked(reasoning.reason).mock.calls[0]![0].input as {
      requirements: { statement: string }[];
    };
    expect(input.requirements.map((item) => item.statement)).toEqual([
      "Users may only read invoices owned by their organization.",
      "Cross-organization invoice access is forbidden.",
    ]);
  });

  it.each([
    { explicit: true, level: "low" as const, releaseVerification: false },
    { explicit: false, level: "moderate" as const, releaseVerification: true },
  ])("runs for an authorized non-risk trigger: $level", async (trigger) => {
    const root = await projectRoot();
    const result = await createAndWriteChallengeReport(root, new Date("2026-08-20T20:02:00Z"), {
      assessRisk: vi.fn().mockResolvedValue(risk(trigger.level)),
      contractRequirements: vi.fn().mockResolvedValue([
        { contractId: "invoice-access", id: "INV-001", kind: "requirement", statement: "Only owners read invoices." },
        { contractId: "invoice-access", id: "INV-INV-001", kind: "invariant", statement: "No cross-tenant reads." },
      ]),
      explicit: trigger.explicit,
      provider: provider(),
      releaseVerification: trigger.releaseVerification,
    });
    expect(result.report.status).toBe("completed");
  });

  it("fails closed and preserves a report when required reasoning is unavailable", async () => {
    const root = await projectRoot();
    const result = await createAndWriteChallengeReport(root, new Date("2026-08-20T20:03:00Z"), {
      assessRisk: vi.fn().mockResolvedValue(risk("high")),
    });
    expect(result.report.status).toBe("unavailable");
    expect(result.report.gate.status).toBe("blocked");
    expect(result.report.gate.reasons[0]).toContain("provider is not configured");
  });

  it("rejects hallucinated references and files as invalid provider output", async () => {
    const root = await projectRoot();
    const invalidProvider = provider({
      reason: vi.fn().mockResolvedValue({
        output: {
          ...output,
          challenges: [
            {
              ...output.challenges[0],
              requirementRefs: ["unknown#REQ-1"],
              targetFiles: ["src/not-in-diff.ts"],
            },
          ],
        },
        provider: { id: "test-provider", model: "test-model" },
        requestId: "invalid",
        usage: { durationMs: 1, estimatedCostUsd: 0.01, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
    });
    const result = await createAndWriteChallengeReport(root, new Date("2026-08-20T20:04:00Z"), {
      assessRisk: vi.fn().mockResolvedValue(risk("critical")),
      contractRequirements: vi.fn().mockResolvedValue([
        { contractId: "invoice-access", id: "INV-001", kind: "requirement", statement: "Only owners read invoices." },
      ]),
      provider: invalidProvider,
    });
    expect(result.report.status).toBe("invalid-output");
    expect(result.report.challenges).toEqual([]);
    expect(result.report.gate.status).toBe("blocked");
  });

  it("blocks reports that exceed the configured cost budget", async () => {
    const root = await projectRoot();
    const expensiveProvider = provider({
      reason: vi.fn().mockResolvedValue({
        output,
        provider: { id: "test-provider", model: "test-model" },
        requestId: "expensive",
        usage: { durationMs: 5, estimatedCostUsd: 1.01, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
    });
    const result = await createAndWriteChallengeReport(root, new Date("2026-08-20T20:05:00Z"), {
      assessRisk: vi.fn().mockResolvedValue(risk("critical")),
      contractRequirements: vi.fn().mockResolvedValue([
        { contractId: "invoice-access", id: "INV-001", kind: "requirement", statement: "Only owners read invoices." },
        { contractId: "invoice-access", id: "INV-INV-001", kind: "invariant", statement: "No cross-tenant reads." },
      ]),
      maxCostUsd: 1,
      provider: expensiveProvider,
    });
    expect(result.report.status).toBe("budget-exceeded");
    expect(result.report.gate.status).toBe("blocked");
    expect(result.report.gate.reasons[0]).toContain("$1.0000 budget");
  });

  it("converts provider failures into a durable blocked report without leaking details", async () => {
    const root = await projectRoot();
    const failed = provider({
      reason: vi.fn().mockRejectedValue(
        new ReasoningError(
          "REASONING_PROVIDER_FAILED",
          "Provider failed with secret-value.",
          "Check provider.",
        ),
      ),
    });
    const result = await createAndWriteChallengeReport(root, new Date("2026-08-20T20:06:00Z"), {
      assessRisk: vi.fn().mockResolvedValue(risk("critical")),
      contractRequirements: vi.fn().mockResolvedValue([]),
      provider: failed,
    });
    expect(result.report.status).toBe("provider-error");
    expect(JSON.stringify(result.report)).not.toContain("secret-value");
    expect(result.report.gate.status).toBe("blocked");
  });
});
