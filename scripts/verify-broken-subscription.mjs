import { access } from "node:fs/promises";
import { startVitest } from "vitest/node";
import { runVerificationPlan } from "../packages/execution/dist/index.js";

const temporaryPath = "packages/execution/src/.maru-subscription-cancellation.test.ts";
const requirementRef = "subscription-management#SUB-003";
const plan = {
  affectedTests: [],
  changeSummary: { additions: 1, changedFiles: 1, deletions: 1 },
  generatedAt: "2026-08-17T09:30:00.000Z",
  project: { name: "marucheck-cli-workspace", testFrameworks: ["vitest"] },
  risk: { level: "critical", score: 95 },
  schemaVersion: 1,
  scope: "working-tree",
  selectedRequirements: [],
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
    selectedRequirements: 0,
    unavailableSteps: 0,
  },
  uncoveredRequirements: [],
};

const result = await runVerificationPlan(process.cwd(), plan, {
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
      process.exitCode = previousExitCode;
      return {
        durationMs: Date.now() - startedAt,
        exitCode: failed ? 1 : 0,
        stderr: failed ? "Broken cancellation assertion failed as required." : "",
        stdout: `${modules.length} acceptance module executed.`,
      };
    },
  },
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

if (result.run.status !== "failed" || result.run.summary.blockingFailures !== 1) {
  throw new Error(`Broken cancellation was not blocked: ${JSON.stringify(result.run.summary)}`);
}

try {
  await access(temporaryPath);
  throw new Error(`Temporary acceptance test was not removed: ${temporaryPath}`);
} catch (error) {
  if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
}

console.log(`Broken subscription cancellation detected. Artifact: ${result.path}`);
