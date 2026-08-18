import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { runCli } from "../packages/cli/dist/cli.js";
import { createVerificationPlan } from "../packages/planner/dist/index.js";
import { assessProjectRisk } from "../packages/risk/dist/index.js";

const run = promisify(execFile);

async function write(root, path, content) {
  const target = join(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function git(root, args) {
  await run("git", args, { cwd: root, windowsHide: true });
}

const root = await mkdtemp(join(tmpdir(), "maru-invoice-memory-"));
try {
  await write(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "invoice-memory-fixture",
        devDependencies: { typescript: "7.0.0", vitest: "4.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  await write(root, "package-lock.json", "{}\n");
  await write(
    root,
    "src/services/invoices/authorization.ts",
    "export function authorizeInvoiceRead(ownerId, userId) { return ownerId === userId; }\n",
  );
  await write(
    root,
    "tests/regressions/cross-account.test.ts",
    "import { test, expect } from 'vitest'; test('blocks cross-account invoices', () => expect(true).toBe(true));\n",
  );
  const output = { error: (message) => { throw new Error(message); }, log: () => {} };
  const now = () => new Date("2026-08-18T08:00:00.000Z");
  if ((await runCli(["init"], output, { cwd: root, now })) !== 0) {
    throw new Error("Unable to initialize the invoice memory fixture.");
  }
  await write(
    root,
    ".maru/contracts/invoice-access.yml",
    `version: 1
id: invoice-access
title: Invoice Access
status: approved
criticality: critical
intent: Users may read only invoices owned by their account.
owners:
  - product
  - security
requirements:
  - id: INV-001
    statement: A user may read an invoice only when it belongs to their account.
    priority: required
invariants:
  - id: INV-INV-001
    statement: Invoice authorization is always enforced on the server.
edge_cases:
  - a user changes invoiceId to another account's invoice
security:
  - prevent insecure direct object references
data_integrity:
  - preserve invoice ownership
evidence_policy:
  blocking_requirements:
    - INV-001
    - INV-INV-001
approval:
  approved_by: security
  approved_at: "2026-08-18T07:00:00.000Z"
  version_hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`,
  );
  await write(
    root,
    "invoice-idor.json",
    `${JSON.stringify(
      {
        regressionTests: [
          {
            adapter: "vitest",
            id: "invoice-cross-account-access",
            path: "tests/regressions/cross-account.test.ts",
            requirementRefs: ["invoice-access#INV-001"],
          },
        ],
        relatedContracts: ["invoice-access"],
        relatedFiles: ["src/services/invoices/authorization.ts"],
        rootCause: "Missing server-side invoice ownership check.",
        severity: "critical",
        source: "manual",
        summary: "Users could access another account's invoice by changing invoiceId.",
        tags: ["authorization", "idor", "invoices"],
        title: "Cross-account invoice access",
        type: "security-regression",
      },
      null,
      2,
    )}\n`,
  );
  if (
    (await runCli(["memory", "add", "--from", "invoice-idor.json"], output, {
      cwd: root,
      now,
    })) !== 0
  ) {
    throw new Error("Unable to record the invoice IDOR memory.");
  }

  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.email", "acceptance@marucheck.local"]);
  await git(root, ["config", "user.name", "MaruCheck Acceptance"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "baseline invoice authorization and QA memory"]);

  await write(
    root,
    "src/services/invoices/authorization.ts",
    "export function authorizeInvoiceRead(ownerId, userId) { return Boolean(ownerId && userId); }\n",
  );

  const assessment = await assessProjectRisk(root);
  const plan = await createVerificationPlan(root, new Date("2026-08-18T10:00:00.000Z"));
  const memory = assessment.historicalRisks.find((item) => item.memoryId === "MEM-0001");
  const regression = plan.affectedTests.find(
    (test) => test.path === "tests/regressions/cross-account.test.ts",
  );
  if (
    memory === undefined ||
    !assessment.reasons.some((reason) => reason.code === "historical-regression") ||
    !plan.historicalRegressions.some((item) => item.memoryId === "MEM-0001") ||
    regression === undefined ||
    !regression.historicalMemoryIds.includes("MEM-0001") ||
    !plan.steps.some((step) => step.testFiles.includes(regression.path))
  ) {
    throw new Error(
      `Invoice memory acceptance failed.\nRisk: ${JSON.stringify(assessment, null, 2)}\nPlan: ${JSON.stringify(plan, null, 2)}`,
    );
  }
  process.stdout.write(
    "QA memory acceptance passed: the invoice IDOR history raised risk and automatically included its regression test.\n",
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
