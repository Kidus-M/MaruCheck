import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ContractError,
  approveContract,
  contractVersionHash,
  createContractFromRequirements,
  diffQualityContracts,
  getContract,
  listContracts,
  parseQualityContract,
  validateContracts,
} from "./index.js";

const VALID_CONTRACT = `version: 1
id: subscription-management
title: Subscription Management
status: draft
criticality: high
intent: Free users have a monthly quota and Pro users have unlimited usage.
owners:
  - product
  - engineering
requirements:
  - id: SUB-001
    statement: Free users may perform at most 10 generations per billing month.
    priority: required
invariants:
  - id: SUB-INV-001
    statement: Failed payments must never activate Pro access.
edge_cases:
  - a payment webhook is delivered twice
security:
  - verify billing webhook signatures
data_integrity:
  - one active subscription record per user
evidence_policy:
  blocking_requirements:
    - SUB-001
    - SUB-INV-001
`;

describe("Quality Contracts", () => {
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "maru-contracts-"));
    await mkdir(join(fixtureRoot, ".maru"), { recursive: true });
    await writeFile(join(fixtureRoot, ".maru/maru.yml"), "version: 1\n", "utf8");
  });

  afterEach(async () => {
    await rm(fixtureRoot, { force: true, recursive: true });
  });

  it("parses and validates the documented YAML contract shape", () => {
    const contract = parseQualityContract(VALID_CONTRACT, "subscription-management.yml");

    expect(contract.id).toBe("subscription-management");
    expect(contract.requirements).toEqual([
      {
        id: "SUB-001",
        priority: "required",
        statement: "Free users may perform at most 10 generations per billing month.",
      },
    ]);
    expect(contract.evidencePolicy.blockingRequirements).toEqual(["SUB-001", "SUB-INV-001"]);
    expect(contractVersionHash(contract)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("returns field-specific validation issues for unsafe or incomplete contracts", () => {
    expect(() =>
      parseQualityContract(
        "version: 1\nid: ../escape\ntitle: Unsafe\nstatus: approved\ncriticality: high\n",
        "unsafe.yml",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "CONTRACT_INVALID",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "id" }),
          expect.objectContaining({ path: "requirements" }),
          expect.objectContaining({ path: "approval" }),
        ]),
      }),
    );
  });

  it("classifies intent changes as semantic and presentation changes as mechanical", () => {
    const baseline = parseQualityContract(VALID_CONTRACT);
    const renamed = { ...baseline, title: "Subscriptions" };
    const changed = {
      ...baseline,
      requirements: [
        {
          ...baseline.requirements[0]!,
          statement: "Free users may perform at most 20 generations per billing month.",
        },
      ],
    };

    expect(diffQualityContracts(baseline, renamed)).toMatchObject({
      classification: "mechanical",
      changes: [{ kind: "changed", path: "title", semantic: false }],
    });
    expect(diffQualityContracts(baseline, changed)).toMatchObject({
      classification: "semantic",
      changes: [
        expect.objectContaining({ path: "requirements[SUB-001].statement", semantic: true }),
      ],
    });
  });

  it("creates a reviewable subscription draft with every required quality category", async () => {
    const created = await createContractFromRequirements(
      fixtureRoot,
      "Free users receive 10 generations each month. Pro users receive unlimited generations. Upgrades require a verified payment webhook.",
      { now: new Date("2026-08-16T08:00:00.000Z") },
    );

    expect(created.contract).toMatchObject({
      id: "subscription-management",
      status: "draft",
    });
    expect(created.contract.requirements.length).toBeGreaterThan(0);
    expect(created.contract.invariants.length).toBeGreaterThan(0);
    expect(created.contract.edgeCases.length).toBeGreaterThan(0);
    expect(created.contract.security.length).toBeGreaterThan(0);
    expect(created.contract.dataIntegrity.length).toBeGreaterThan(0);
    expect(created.path).toBe(".maru/contracts/subscription-management.yml");

    const stored = await readFile(join(fixtureRoot, created.path), "utf8");
    expect(stored).toContain("status: draft");
  });

  it("does not turn Markdown headings into requirements", async () => {
    const created = await createContractFromRequirements(
      fixtureRoot,
      "# Subscription requirements\n\nFree users receive 10 generations each month.",
    );

    expect(created.contract.requirements).toHaveLength(1);
    expect(created.contract.requirements[0]?.statement).toBe(
      "Free users receive 10 generations each month.",
    );
  });

  it("lists, validates, shows, approves, and snapshots contract versions", async () => {
    await mkdir(join(fixtureRoot, ".maru/contracts"), { recursive: true });
    await writeFile(
      join(fixtureRoot, ".maru/contracts/subscription-management.yml"),
      VALID_CONTRACT,
      "utf8",
    );

    await expect(listContracts(fixtureRoot)).resolves.toEqual([
      expect.objectContaining({ id: "subscription-management", status: "draft" }),
    ]);
    await expect(validateContracts(fixtureRoot)).resolves.toEqual({
      invalid: [],
      valid: [expect.objectContaining({ id: "subscription-management" })],
    });
    await expect(getContract(fixtureRoot, "subscription-management")).resolves.toEqual(
      expect.objectContaining({ id: "subscription-management" }),
    );

    const approved = await approveContract(fixtureRoot, "subscription-management", {
      approvedAt: new Date("2026-08-16T09:00:00.000Z"),
      approvedBy: "product-owner",
    });

    expect(approved.contract.status).toBe("approved");
    expect(approved.contract.approval).toEqual({
      approvedAt: "2026-08-16T09:00:00.000Z",
      approvedBy: "product-owner",
      versionHash: approved.versionHash,
    });
    await expect(
      readFile(
        join(
          fixtureRoot,
          ".maru/contracts/.history/subscription-management",
          `${approved.versionHash}.yml`,
        ),
        "utf8",
      ),
    ).resolves.toContain("status: approved");

    await expect(
      approveContract(fixtureRoot, "subscription-management", {
        approvedAt: new Date("2026-08-16T10:00:00.000Z"),
        approvedBy: "different-owner",
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "CONTRACT_ALREADY_APPROVED" }));
    await expect(
      readFile(
        join(
          fixtureRoot,
          ".maru/contracts/.history/subscription-management",
          `${approved.versionHash}.yml`,
        ),
        "utf8",
      ),
    ).resolves.toContain("approved_by: product-owner");
  });

  it("refuses missing contracts and unsafe identifiers with stable errors", async () => {
    await expect(getContract(fixtureRoot, "missing")).rejects.toEqual(
      expect.objectContaining({ code: "CONTRACT_NOT_FOUND" }),
    );
    await expect(getContract(fixtureRoot, "../outside")).rejects.toBeInstanceOf(ContractError);
    await expect(getContract(fixtureRoot, "../outside")).rejects.toEqual(
      expect.objectContaining({ code: "CONTRACT_ID_INVALID" }),
    );
  });
});
