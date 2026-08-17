import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approveContractAmendment,
  checkSemanticDrift,
  proposeContractAmendment,
  type ObservedBehavior,
} from "./index.js";
import { getContract, parseQualityContract } from "@maru/contracts";

const APPROVED_CONTRACT = `version: 1
id: subscription-management
title: Subscription Management
status: approved
criticality: critical
intent: Preserve subscription limits and billing behavior.
owners:
  - product
  - engineering
requirements:
  - id: SUB-001
    statement: Free users may upload 5 files.
    priority: required
  - id: SUB-002
    statement: Paid users may upload unlimited files.
    priority: required
invariants:
  - id: SUB-INV-001
    statement: Billing changes require a verified webhook.
edge_cases:
  - a free user reaches the quota
security:
  - reject unverified billing events
data_integrity:
  - preserve the active plan
evidence_policy:
  blocking_requirements:
    - SUB-001
    - SUB-INV-001
approval:
  approved_by: product
  approved_at: "2026-08-16T10:00:00.000Z"
  version_hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`;

describe("semantic drift guard", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function project(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maru-drift-"));
    roots.push(root);
    await mkdir(join(root, ".maru", "contracts"), { recursive: true });
    await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n", "utf8");
    await writeFile(
      join(root, ".maru", "contracts", "subscription-management.yml"),
      APPROVED_CONTRACT,
      "utf8",
    );
    return root;
  }

  it("blocks an approved free quota changing from 5 to 10 without rewriting the contract", () => {
    const contract = parseQualityContract(APPROVED_CONTRACT, "fixture.yml");
    const observations: ObservedBehavior[] = [
      {
        observed: "Free users may upload 10 files.",
        requirementRef: "subscription-management#SUB-001",
        source: { path: "src/plans.ts" },
      },
    ];

    const report = checkSemanticDrift([contract], observations, new Date("2026-08-17T12:00:00Z"));

    expect(report).toMatchObject({
      classification: "semantic",
      gate: { status: "blocked" },
      summary: { blockingConflicts: 1, semanticConflicts: 1 },
    });
    expect(report.conflicts).toEqual([
      expect.objectContaining({
        actions: ["mark-implementation-bug", "propose-contract-amendment", "investigate"],
        approvalRequired: true,
        blocking: true,
        contractId: "subscription-management",
        expected: "Free users may upload 5 files.",
        observed: "Free users may upload 10 files.",
        requirementId: "SUB-001",
      }),
    ]);
    expect(contract.requirements[0]?.statement).toBe("Free users may upload 5 files.");
  });

  it("allows selector maintenance when the protected expectation is unchanged", () => {
    const contract = parseQualityContract(APPROVED_CONTRACT, "fixture.yml");

    const report = checkSemanticDrift(
      [contract],
      [
        {
          maintenanceKind: "selector",
          observed: "  Free users may upload 5 files. ",
          requirementRef: "subscription-management#SUB-001",
          source: { path: "tests/upload.spec.ts" },
        },
      ],
      new Date("2026-08-17T12:00:00Z"),
    );

    expect(report).toMatchObject({
      classification: "mechanical",
      conflicts: [],
      gate: { status: "passed" },
      summary: { allowedMechanicalChanges: 1, semanticConflicts: 0 },
    });
  });

  it("records an immutable proposal and requires a separate explicit approval", async () => {
    const root = await project();
    const observations: ObservedBehavior[] = [
      {
        observed: "Free users may upload 10 files.",
        requirementRef: "subscription-management#SUB-001",
      },
    ];

    const proposal = await proposeContractAmendment(root, "subscription-management", observations, {
      now: new Date("2026-08-17T12:30:00Z"),
      proposedBy: "codex",
      reason: "The implementation currently exposes a larger free quota.",
    });

    expect(proposal.proposal).toMatchObject({
      approval: { required: true, status: "pending" },
      contractId: "subscription-management",
      proposedBy: "codex",
      status: "proposed",
    });
    expect(proposal.proposal.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          after: "Free users may upload 10 files.",
          before: "Free users may upload 5 files.",
          path: "requirements[SUB-001].statement",
          semantic: true,
        }),
      ]),
    );
    expect(await readFile(join(root, proposal.path), "utf8")).toContain('"status": "proposed"');
    expect((await getContract(root, "subscription-management")).requirements[0]?.statement).toBe(
      "Free users may upload 5 files.",
    );

    await expect(
      approveContractAmendment(root, proposal.path, {
        approvedBy: "",
        now: new Date("2026-08-17T13:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "DRIFT_APPROVAL_REQUIRED" });

    const approved = await approveContractAmendment(root, proposal.path, {
      approvedBy: "product",
      now: new Date("2026-08-17T13:00:00Z"),
    });
    expect(approved.contract).toMatchObject({
      approval: { approvedBy: "product" },
      status: "approved",
    });
    expect(approved.contract.requirements[0]?.statement).toBe("Free users may upload 10 files.");
    expect(await readFile(join(root, approved.auditPath), "utf8")).toContain(
      '"status": "approved"',
    );
  });

  it("refuses to apply a stale proposal over newer contract content", async () => {
    const root = await project();
    const proposal = await proposeContractAmendment(
      root,
      "subscription-management",
      [
        {
          observed: "Free users may upload 10 files.",
          requirementRef: "subscription-management#SUB-001",
        },
      ],
      {
        now: new Date("2026-08-17T12:30:00Z"),
        proposedBy: "codex",
        reason: "Observed behavior differs.",
      },
    );
    await writeFile(
      join(root, ".maru", "contracts", "subscription-management.yml"),
      APPROVED_CONTRACT.replace("Subscription Management", "Subscription Limits"),
      "utf8",
    );

    await expect(
      approveContractAmendment(root, proposal.path, {
        approvedBy: "product",
        now: new Date("2026-08-17T13:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "DRIFT_PROPOSAL_STALE" });
  });
});
