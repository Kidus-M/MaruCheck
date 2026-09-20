import type { QualityContract } from "@maru/contracts";
import type { GitDiffAnalysis, GitFileChange } from "@maru/git";
import type { QAMemoryRecord } from "@maru/memory";
import { describe, expect, it } from "vitest";
import { assessRisk, riskLevelForScore } from "./index.js";

const SUBSCRIPTION_CONTRACT: QualityContract = {
  version: 1,
  id: "subscription-management",
  title: "Subscription Management",
  status: "approved",
  criticality: "critical",
  intent: "Payments and subscription state change only after a verified billing webhook.",
  owners: ["billing"],
  requirements: [
    {
      id: "SUB-001",
      statement: "A verified payment webhook updates the subscription exactly once.",
      priority: "required",
    },
  ],
  invariants: [
    { id: "SUB-INV-001", statement: "Webhook replay never duplicates an invoice payment." },
  ],
  edgeCases: ["duplicate webhook delivery"],
  security: ["verify the payment provider signature"],
  dataIntegrity: ["subscription and invoice state remain consistent"],
  evidencePolicy: { blockingRequirements: ["SUB-001", "SUB-INV-001"] },
};

function file(overrides: Partial<GitFileChange> & Pick<GitFileChange, "path">): GitFileChange {
  return {
    additions: 1,
    binary: false,
    classifications: [],
    deletions: 1,
    hunks: [],
    status: "modified",
    symbols: [],
    ...overrides,
  };
}

function analysis(files: readonly GitFileChange[]): GitDiffAnalysis {
  return {
    clean: files.length === 0,
    files,
    summary: {
      additions: files.reduce((total, item) => total + item.additions, 0),
      changedFiles: files.length,
      deletions: files.reduce((total, item) => total + item.deletions, 0),
    },
  };
}

describe("deterministic risk engine", () => {
  it("scores a billing webhook substantially higher than a CSS change and explains why", () => {
    const billing = assessRisk(
      analysis([
        file({
          additions: 8,
          classifications: [
            "api-contract",
            "billing",
            "business-logic",
            "external-integration",
            "security-sensitive",
          ],
          path: "src/billing/subscription-webhook.ts",
          symbols: ["handleSubscriptionWebhook"],
        }),
      ]),
      [SUBSCRIPTION_CONTRACT],
    );
    const css = assessRisk(
      analysis([file({ classifications: ["ui-only"], path: "src/app/theme.css", deletions: 0 })]),
      [SUBSCRIPTION_CONTRACT],
    );

    expect(billing.score).toBeGreaterThanOrEqual(75);
    expect(billing.score - css.score).toBeGreaterThanOrEqual(50);
    expect(billing.level).toBe("critical");
    expect(css.level).toBe("low");
    expect(billing.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["billing", "external-integration", "contract-criticality"]),
    );
    expect(billing.relatedContracts).toEqual([
      expect.objectContaining({
        contractId: "subscription-management",
        invariantIds: ["SUB-INV-001"],
        requirementIds: ["SUB-001"],
      }),
    ]);
    expect(billing.recommendedTestCategories).toEqual(
      expect.arrayContaining(["api", "contract-regression", "security", "unit"]),
    );
  });

  it("uses stable inclusive level boundaries", () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(riskLevelForScore)).toEqual([
      "low",
      "low",
      "moderate",
      "moderate",
      "high",
      "high",
      "critical",
      "critical",
    ]);
  });

  it("returns a zero score and a useful explanation for a clean tree", () => {
    expect(assessRisk(analysis([]), [])).toMatchObject({
      level: "low",
      reasons: [{ code: "clean", points: 0 }],
      relatedContracts: [],
      score: 0,
    });
  });

  it("flags business changes with no related contract or changed tests", () => {
    const result = assessRisk(
      analysis([
        file({ classifications: ["business-logic"], path: "src/orders/calculate-total.ts" }),
      ]),
      [SUBSCRIPTION_CONTRACT],
    );

    expect(result.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["missing-contract", "tests-unchanged"]),
    );
    expect(result.relatedContracts).toEqual([]);
  });

  it.each(["authentication", "authorization", "billing"] as const)(
    "recommends security verification for a %s change even without a duplicate security tag",
    (classification) => {
      const result = assessRisk(
        analysis([file({ classifications: [classification], path: `src/${classification}.ts` })]),
        [],
      );

      expect(result.recommendedTestCategories).toContain("security");
    },
  );

  const INVOICE_MEMORY: QAMemoryRecord = {
    createdAt: "2026-08-18T08:00:00.000Z",
    id: "MEM-0143",
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
    schemaVersion: 1,
    severity: "critical",
    source: "manual",
    status: "active",
    summary: "A user could read another account's invoice.",
    supersedes: [],
    tags: ["authorization", "idor", "invoices"],
    title: "Cross-account invoice access",
    type: "security-regression",
  };
  const INVOICE_CONTRACT: QualityContract = {
    ...SUBSCRIPTION_CONTRACT,
    id: "invoice-access",
    intent: "Users may read only invoices owned by their account.",
    title: "Invoice Access",
  };
  const invoiceAuthorizationChange = analysis([
    file({
      classifications: ["authorization", "billing", "business-logic", "security-sensitive"],
      path: "src/services/invoices/authorization.ts",
      symbols: ["authorizeInvoiceRead"],
    }),
  ]);

  it("raises risk when an invoice authorization change matches a critical historical bug", () => {
    const result = assessRisk(invoiceAuthorizationChange, [], [INVOICE_MEMORY]);

    expect(result.historicalRisks).toEqual([
      expect.objectContaining({
        memoryId: "MEM-0143",
        relevance: expect.objectContaining({ level: "high" }),
        severity: "critical",
      }),
    ]);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "historical-regression", points: 25 }),
      ]),
    );
    expect(result.recommendedTestCategories).toEqual(
      expect.arrayContaining(["contract-regression", "security"]),
    );
  });

  it("preserves stale history without a risk increase and explains the relevance decision", () => {
    const fresh = assessRisk(invoiceAuthorizationChange, [INVOICE_CONTRACT], [INVOICE_MEMORY], {
      existingPaths: new Set([
        "src/services/invoices.ts",
        "tests/regressions/cross-account.test.ts",
      ]),
      history: [],
      now: "2026-09-01T00:00:00.000Z",
    });
    const stale = assessRisk(invoiceAuthorizationChange, [], [INVOICE_MEMORY], {
      existingPaths: new Set(),
      history: [],
      now: "2026-09-01T00:00:00.000Z",
    });

    expect(fresh.historicalRisks[0]?.relevance).toMatchObject({ level: "high", score: 100 });
    expect(fresh.reasons).toContainEqual(
      expect.objectContaining({ code: "historical-regression", points: 25 }),
    );
    expect(stale.historicalRisks).toEqual([
      expect.objectContaining({
        memoryId: "MEM-0143",
        relevance: expect.objectContaining({
          level: "low",
          score: 10,
          signals: expect.arrayContaining([
            expect.objectContaining({ code: "related-files-present", points: -35 }),
            expect.objectContaining({ code: "related-contracts-active", points: -25 }),
            expect.objectContaining({ code: "regression-tests-present", points: -30 }),
          ]),
        }),
      }),
    ]);
    expect(stale.reasons.map((reason) => reason.code)).not.toContain("historical-regression");
    expect(stale.reasons).toContainEqual({
      code: "historical-stale",
      message: "Preserved 1 low-relevance historical QA memory without a risk increase: MEM-0143.",
      points: 0,
    });
    expect(stale.recommendedTestCategories).not.toContain("contract-regression");
  });

  it("halves historical points for medium relevance and picks the highest effective memory", () => {
    const stale: QAMemoryRecord = {
      ...INVOICE_MEMORY,
      id: "MEM-0001",
      relatedFiles: ["src/legacy/invoice-service.ts"],
      severity: "critical",
    };
    const partial: QAMemoryRecord = { ...INVOICE_MEMORY, id: "MEM-0002", severity: "high" };
    const result = assessRisk(
      invoiceAuthorizationChange,
      [{ ...INVOICE_CONTRACT, status: "deprecated" }],
      [stale, partial],
      { existingPaths: new Set(["src/services/invoices.ts"]) },
    );

    expect(
      result.historicalRisks.map((memory) => [memory.memoryId, memory.relevance.level]),
    ).toEqual([
      ["MEM-0001", "low"],
      ["MEM-0002", "medium"],
    ]);
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "historical-regression",
        message: expect.stringContaining("MEM-0002 (high, medium relevance)"),
        points: 9,
      }),
    );
    expect(result.recommendedTestCategories).toContain("contract-regression");
  });
});
