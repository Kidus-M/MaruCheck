import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../packages/cli/dist/cli.js";

const contract = `version: 1
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
`;

const root = await mkdtemp(join(tmpdir(), "maru-semantic-drift-"));
try {
  await mkdir(join(root, ".maru", "contracts"), { recursive: true });
  await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n", "utf8");
  const contractPath = join(root, ".maru", "contracts", "subscription-management.yml");
  await writeFile(contractPath, contract, "utf8");
  await writeFile(
    join(root, "observations.json"),
    `${JSON.stringify(
      {
        observations: [
          {
            observed: "Free users may upload 10 files.",
            requirementRef: "subscription-management#SUB-001",
            source: { path: "src/subscriptions/limits.ts" },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const messages = [];
  const errors = [];
  const exitCode = await runCli(
    ["drift", "check", "--from", "observations.json"],
    { error: (message) => errors.push(message), log: (message) => messages.push(message) },
    { cwd: root, now: () => new Date("2026-08-17T15:00:00.000Z") },
  );
  const output = messages.join("\n");
  if (
    exitCode !== 1 ||
    errors.length !== 0 ||
    !output.includes("Semantic drift: BLOCKED") ||
    !output.includes("Contract: Free users may upload 5 files.") ||
    !output.includes("Observed: Free users may upload 10 files.")
  ) {
    throw new Error(`Semantic drift acceptance failed.\n${output}\n${errors.join("\n")}`);
  }
  if ((await readFile(contractPath, "utf8")) !== contract) {
    throw new Error("The semantic drift check rewrote the approved contract.");
  }
  process.stdout.write(
    "Semantic drift acceptance passed: quota 5 -> 10 blocked without rewriting the contract.\n",
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
