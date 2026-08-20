import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QualityContract } from "@maru/contracts";
import type { ProjectScan } from "@maru/core";
import type { RiskAssessment } from "@maru/risk";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildVerificationPlan,
  serializeVerificationPlan,
  writeVerificationPlan,
} from "./index.js";

const CONTRACT: QualityContract = {
  version: 1,
  id: "subscription-management",
  title: "Subscription Management",
  status: "approved",
  criticality: "critical",
  intent: "A verified payment webhook changes subscription state exactly once.",
  owners: ["billing"],
  requirements: [
    {
      id: "SUB-001",
      statement: "A verified payment webhook updates the subscription exactly once.",
      priority: "required",
    },
    {
      id: "SUB-002",
      statement: "A customer can cancel at the end of the billing period.",
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

const ASSESSMENT: RiskAssessment = {
  analysis: {
    clean: false,
    files: [
      {
        additions: 8,
        binary: false,
        classifications: [
          "api-contract",
          "billing",
          "business-logic",
          "external-integration",
          "security-sensitive",
        ],
        deletions: 2,
        hunks: [],
        path: "src/billing/subscription-webhook.ts",
        status: "modified",
        symbols: ["handleSubscriptionWebhook"],
      },
    ],
    summary: { additions: 8, changedFiles: 1, deletions: 2 },
  },
  level: "critical",
  historicalRisks: [],
  reasons: [{ code: "billing", message: "Touches billing.", points: 30 }],
  recommendedTestCategories: [
    "api",
    "contract-regression",
    "e2e",
    "integration",
    "security",
    "unit",
  ],
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
  score: 100,
};

function scan(options: { readonly includeTests?: boolean } = {}): ProjectScan {
  const includeTests = options.includeTests ?? true;
  return {
    ci: { githubActions: true, workflowFiles: [".github/workflows/ci.yml"] },
    dependencies: {
      development: ["@axe-core/playwright", "@playwright/test", "vitest"],
      production: ["next"],
    },
    generatedAt: "2026-08-16T10:00:00.000Z",
    project: {
      databaseLibraries: [],
      frameworks: ["nextjs", "react"],
      languages: ["typescript"],
      name: "subscription-fixture",
      packageManager: "npm",
      root: ".",
    },
    routes: [
      {
        kind: "api",
        methods: ["POST"],
        path: "/api/webhooks",
        source: "src/app/api/webhooks/route.ts",
      },
    ],
    schemaVersion: 1,
    source: {
      directories: ["src"],
      fileCount: 2,
      files: ["src/app/api/webhooks/route.ts", "src/billing/subscription-webhook.ts"],
      filesByExtension: { ".ts": 2 },
    },
    tests: includeTests
      ? {
          directories: ["e2e", "tests"],
          files: [
            { framework: "playwright", path: "e2e/subscription-webhook.spec.ts" },
            { framework: "vitest", path: "tests/profile.test.ts" },
            { framework: "vitest", path: "tests/subscription-webhook.test.ts" },
          ],
          frameworks: ["playwright", "vitest"],
        }
      : { directories: [], files: [], frameworks: [] },
  };
}

describe("verification planner", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  it("connects subscription requirements to affected Vitest and Playwright tests", () => {
    const plan = buildVerificationPlan({
      assessment: ASSESSMENT,
      contracts: [CONTRACT],
      generatedAt: "2026-08-16T10:30:00.000Z",
      project: scan(),
    });

    expect(plan).toMatchObject({
      generatedAt: "2026-08-16T10:30:00.000Z",
      risk: { level: "critical", score: 100 },
      schemaVersion: 1,
      scope: "working-tree",
      selectedRequirements: [
        { contractId: "subscription-management", id: "SUB-001", kind: "requirement" },
        { contractId: "subscription-management", id: "SUB-INV-001", kind: "invariant" },
      ],
      summary: { affectedTests: 2, selectedRequirements: 2 },
      uncoveredRequirements: [],
    });
    expect(plan.selectedRequirements.map((item) => item.id)).not.toContain("SUB-002");
    expect(plan.affectedTests.map((test) => test.path)).toEqual([
      "e2e/subscription-webhook.spec.ts",
      "tests/subscription-webhook.test.ts",
    ]);
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ adapter: "vitest", category: "unit" }),
        expect.objectContaining({ adapter: "playwright", category: "e2e" }),
        expect.objectContaining({ adapter: "gitleaks", category: "security" }),
        expect.objectContaining({ adapter: "semgrep", category: "security" }),
      ]),
    );
    for (const step of plan.steps) {
      expect(step.reasons.length).toBeGreaterThanOrEqual(2);
      expect(step.requirementRefs).toEqual([
        "subscription-management#SUB-001",
        "subscription-management#SUB-INV-001",
      ]);
    }
  });

  it("marks automation unavailable and requirements uncovered when no tests are configured", () => {
    const plan = buildVerificationPlan({
      assessment: { ...ASSESSMENT, recommendedTestCategories: ["unit"] },
      contracts: [CONTRACT],
      generatedAt: "2026-08-16T10:30:00.000Z",
      project: scan({ includeTests: false }),
    });

    expect(plan.steps).toEqual([
      expect.objectContaining({
        adapter: "unavailable",
        category: "unit",
        execution: "unavailable",
      }),
    ]);
    expect(plan.uncoveredRequirements).toEqual([
      "subscription-management#SUB-001",
      "subscription-management#SUB-INV-001",
    ]);
    expect(plan.summary).toMatchObject({ unavailableSteps: 1 });
  });

  it("selects axe only for accessibility changes with an axe-backed Playwright setup", () => {
    const project = scan();
    const withAxe = buildVerificationPlan({
      assessment: { ...ASSESSMENT, recommendedTestCategories: ["accessibility"] },
      contracts: [],
      generatedAt: "2026-08-16T10:30:00.000Z",
      project,
    });
    const withoutAxe = buildVerificationPlan({
      assessment: { ...ASSESSMENT, recommendedTestCategories: ["accessibility"] },
      contracts: [],
      generatedAt: "2026-08-16T10:30:00.000Z",
      project: {
        ...project,
        dependencies: { ...project.dependencies, development: ["@playwright/test", "vitest"] },
      },
    });

    expect(withAxe.steps).toEqual([
      expect.objectContaining({
        adapter: "axe",
        category: "accessibility",
        execution: "automated",
      }),
    ]);
    expect(withoutAxe.steps).toEqual([
      expect.objectContaining({
        adapter: "unavailable",
        category: "accessibility",
        execution: "unavailable",
      }),
    ]);
  });

  it("produces an empty executable scope for a clean tree", () => {
    const plan = buildVerificationPlan({
      assessment: {
        ...ASSESSMENT,
        analysis: {
          clean: true,
          files: [],
          summary: { additions: 0, changedFiles: 0, deletions: 0 },
        },
        level: "low",
        reasons: [{ code: "clean", message: "No changes.", points: 0 }],
        recommendedTestCategories: [],
        relatedContracts: [],
        score: 0,
      },
      contracts: [CONTRACT],
      generatedAt: "2026-08-16T10:30:00.000Z",
      project: scan(),
    });

    expect(plan).toMatchObject({
      affectedTests: [],
      selectedRequirements: [],
      steps: [],
      uncoveredRequirements: [],
    });
  });

  it("serializes deterministically and persists the generated plan artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "maru-plan-"));
    temporaryDirectories.push(root);
    const plan = buildVerificationPlan({
      assessment: ASSESSMENT,
      contracts: [CONTRACT],
      generatedAt: "2026-08-16T10:30:00.000Z",
      project: scan(),
    });

    const serialized = serializeVerificationPlan(plan);
    expect(serialized).toBe(`${JSON.stringify(plan, null, 2)}\n`);
    await expect(writeVerificationPlan(root, plan)).resolves.toBe(
      ".maru/generated/verification-plan.json",
    );
    await expect(
      readFile(join(root, ".maru/generated/verification-plan.json"), "utf8"),
    ).resolves.toBe(serialized);
  });

  it("returns an actionable planner error when the artifact cannot be written", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maru-plan-error-"));
    temporaryDirectories.push(directory);
    const rootFile = join(directory, "not-a-directory");
    await writeFile(rootFile, "blocked", "utf8");
    const plan = buildVerificationPlan({
      assessment: ASSESSMENT,
      contracts: [CONTRACT],
      generatedAt: "2026-08-16T10:30:00.000Z",
      project: scan(),
    });

    await expect(writeVerificationPlan(rootFile, plan)).rejects.toMatchObject({
      code: "PLAN_WRITE_FAILED",
      remediation: expect.stringContaining("permissions"),
    });
  });

  it("automatically includes a regression test from matched invoice IDOR memory", () => {
    const project = scan();
    const plan = buildVerificationPlan({
      assessment: {
        ...ASSESSMENT,
        analysis: {
          clean: false,
          files: [
            {
              additions: 4,
              binary: false,
              classifications: ["authorization", "billing", "security-sensitive"],
              deletions: 1,
              hunks: [],
              path: "src/services/invoices/authorization.ts",
              status: "modified",
              symbols: ["authorizeInvoiceRead"],
            },
          ],
          summary: { additions: 4, changedFiles: 1, deletions: 1 },
        },
        historicalRisks: [
          {
            exactFileMatches: [],
            matchedTerms: ["authorization", "invoices"],
            memoryId: "MEM-0143",
            reasons: ["Matches historical authorization and invoice terms."],
            regressionTests: [
              {
                adapter: "vitest",
                id: "invoice-cross-account-access",
                path: "tests/regressions/cross-account.test.ts",
                requirementRefs: ["invoice-access#INV-001"],
              },
              {
                adapter: "playwright",
                id: "invoice-browser-boundary",
                path: "tests/profile.test.ts",
                requirementRefs: ["invoice-access#INV-001"],
              },
            ],
            relatedContracts: ["invoice-access"],
            severity: "critical",
            title: "Cross-account invoice access",
            type: "security-regression",
          },
        ],
        recommendedTestCategories: ["contract-regression", "security", "unit"],
      },
      contracts: [],
      generatedAt: "2026-08-18T10:00:00.000Z",
      project: {
        ...project,
        tests: {
          ...project.tests,
          files: [
            ...project.tests.files,
            { framework: "vitest", path: "tests/regressions/cross-account.test.ts" },
          ],
        },
      },
    });

    expect(plan.historicalRegressions).toEqual([
      expect.objectContaining({
        availableTestFiles: ["tests/regressions/cross-account.test.ts"],
        memoryId: "MEM-0143",
        missingTestFiles: ["tests/profile.test.ts"],
      }),
    ]);
    expect(plan.affectedTests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          historicalMemoryIds: ["MEM-0143"],
          path: "tests/regressions/cross-account.test.ts",
          requirementRefs: ["invoice-access#INV-001"],
        }),
      ]),
    );
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "vitest",
          testFiles: expect.arrayContaining(["tests/regressions/cross-account.test.ts"]),
        }),
      ]),
    );
    expect(plan.summary.historicalRegressions).toBe(1);
  });
});
