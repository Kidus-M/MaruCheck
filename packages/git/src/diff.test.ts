import { describe, expect, it, vi } from "vitest";
import {
  analyzeGitDiff,
  classifyChangedPath,
  parseUnifiedDiff,
  type GitRunner,
} from "./index.js";

const BILLING_PATCH = `diff --git a/src/billing/webhook.ts b/src/billing/webhook.ts
index 1111111..2222222 100644
--- a/src/billing/webhook.ts
+++ b/src/billing/webhook.ts
@@ -4,2 +4,4 @@ export async function handleWebhook(event: Event) {
-  return settle(event);
+  const payment = await settle(event);
+  await publishInvoice(payment);
+  return payment;
 }
`;

describe("Git diff analysis", () => {
  it("parses changed ranges and detects functions without retaining source lines", () => {
    expect(parseUnifiedDiff(BILLING_PATCH)).toEqual([
      {
        additions: 3,
        binary: false,
        deletions: 1,
        hunks: [
          {
            context: "export async function handleWebhook(event: Event) {",
            newLines: 4,
            newStart: 4,
            oldLines: 2,
            oldStart: 4,
          },
        ],
        originalPath: "src/billing/webhook.ts",
        path: "src/billing/webhook.ts",
        status: "modified",
        symbols: ["handleWebhook"],
      },
    ]);
    expect(JSON.stringify(parseUnifiedDiff(BILLING_PATCH))).not.toContain("publishInvoice");
  });

  it("classifies sensitive paths deterministically", () => {
    expect(classifyChangedPath("src/billing/webhook.ts")).toEqual([
      "api-contract",
      "billing",
      "business-logic",
      "external-integration",
      "security-sensitive",
    ]);
    expect(classifyChangedPath("src/app/theme.css")).toEqual(["ui-only"]);
    expect(classifyChangedPath("package-lock.json")).toEqual([
      "configuration",
      "dependency-upgrade",
    ]);
  });

  it("combines staged, unstaged, and untracked changes without invoking a shell", async () => {
    const run = vi
      .fn<GitRunner["run"]>()
      .mockResolvedValueOnce("M  src/billing/webhook.ts\0?? src/new.css\0")
      .mockResolvedValueOnce(BILLING_PATCH)
      .mockResolvedValueOnce("");

    await expect(analyzeGitDiff("C:/project", { run })).resolves.toMatchObject({
      clean: false,
      files: [
        {
          additions: 3,
          classifications: expect.arrayContaining(["billing", "external-integration"]),
          path: "src/billing/webhook.ts",
        },
        {
          additions: 0,
          classifications: ["ui-only"],
          path: "src/new.css",
          status: "untracked",
        },
      ],
      summary: {
        additions: 3,
        changedFiles: 2,
        deletions: 1,
      },
    });
    expect(run).toHaveBeenNthCalledWith(
      1,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      "C:/project",
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      ["diff", "--cached", "--no-ext-diff", "--no-color", "--unified=0", "--find-renames", "--"],
      "C:/project",
    );
    expect(run).toHaveBeenNthCalledWith(
      3,
      ["diff", "--no-ext-diff", "--no-color", "--unified=0", "--find-renames", "--"],
      "C:/project",
    );
  });
});
