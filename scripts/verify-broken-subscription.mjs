import { access, mkdir, writeFile } from "node:fs/promises";
import { startVitest } from "vitest/node";
import { createAndWriteVerificationReport } from "../packages/evidence/dist/index.js";

const temporaryPath = "packages/execution/src/.maru-subscription-cancellation.test.ts";
const planPath = ".maru/artifacts/acceptance-subscription-plan.json";
const requirementRef = "subscription-management#SUB-004";
const plan = {
  affectedTests: [],
  changeSummary: { additions: 1, changedFiles: 1, deletions: 1 },
  generatedAt: "2026-08-17T09:30:00.000Z",
  project: { name: "marucheck-cli-workspace", testFrameworks: ["vitest"] },
  risk: { level: "critical", score: 95 },
  schemaVersion: 1,
  scope: "working-tree",
  selectedRequirements: [
    {
      blocking: true,
      contractId: "subscription-management",
      contractTitle: "Subscription Management",
      id: "SUB-004",
      kind: "requirement",
      priority: "required",
      reasons: ["Selected by the contract evidence policy."],
      statement: "Cancellation keeps Pro access active until period_end.",
    },
  ],
  steps: [
    {
      adapter: "vitest",
      blocking: true,
      category: "contract-regression",
      execution: "automated",
      id: "step-01-subscription-cancellation",
      reasons: ["Acceptance fixture must reject incorrect cancellation state."],
      requirementRefs: [requirementRef],
      testFiles: [],
    },
  ],
  summary: {
    affectedTests: 0,
    automatedSteps: 1,
    manualSteps: 0,
    selectedRequirements: 1,
    unavailableSteps: 0,
  },
  uncoveredRequirements: [],
};

await mkdir(".maru/artifacts", { recursive: true });
await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

const result = await createAndWriteVerificationReport(process.cwd(), new Date(), {
  commandRunner: {
    async run(request) {
      if (!request.args.includes(temporaryPath)) {
        throw new Error("Vitest adapter did not select the generated cancellation test.");
      }
      const previousExitCode = process.exitCode;
      const startedAt = Date.now();
      const vitest = await startVitest(
        "test",
        [temporaryPath],
        {
          configLoader: "native",
          pool: "threads",
          reporters: ["dot"],
          run: true,
          watch: false,
        },
        undefined,
        { suppressUnhandledError: false },
      );
      const modules = vitest.state.getTestModules();
      const failed = modules.length === 0 || modules.some((module) => !module.ok());
      const errors = modules.flatMap((module) =>
        [...module.children.allTests()].flatMap((test) =>
          (test.result().errors ?? []).map((error) => error.message),
        ),
      );
      process.exitCode = previousExitCode;
      return {
        durationMs: Date.now() - startedAt,
        exitCode: failed ? 1 : 0,
        stderr: errors.join("\n"),
        stdout: `${modules.length} acceptance module executed.`,
      };
    },
  },
  createPlan: async () => ({ path: planPath, plan }),
  temporaryTests: [
    {
      adapter: "vitest",
      id: "broken-subscription-cancellation",
      requirementRefs: [requirementRef],
      source: `import { expect, it } from "vitest";
import { cancelSubscription } from "../fixtures/broken-subscription.ts";

it("marks a cancelled subscription as cancelled", () => {
  const result = cancelSubscription(
    { id: "sub-123", status: "active" },
    "2026-08-17T09:30:00.000Z",
  );
  expect(result.status).toBe("cancelled");
});
`,
      targetPath: temporaryPath,
    },
  ],
});

if (result.run.status !== "failed" || result.report.gate.status !== "blocked") {
  throw new Error(`Broken cancellation was not blocked: ${JSON.stringify(result.run.summary)}`);
}

const blockingFindings = result.report.findings.filter((finding) => finding.blocking);
if (blockingFindings.length !== 1) {
  throw new Error(`Expected one blocking finding: ${JSON.stringify(result.report.findings)}`);
}
for (const finding of blockingFindings) {
  const complete =
    finding.contractId === "subscription-management" &&
    finding.requirementId === "SUB-004" &&
    finding.expected.length > 0 &&
    finding.actual.length > 0 &&
    finding.reproduction.command.length > 0 &&
    finding.reproduction.steps.length > 0 &&
    finding.evidenceIds.length > 0;
  if (!complete) throw new Error(`Blocking finding is incomplete: ${JSON.stringify(finding)}`);
}

try {
  await access(temporaryPath);
  throw new Error(`Temporary acceptance test was not removed: ${temporaryPath}`);
} catch (error) {
  if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
}

console.log(`Broken subscription cancellation detected. Report: ${result.path}`);
