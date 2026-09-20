import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitDiffAnalysis } from "@maru/git";
import {
  MemoryError,
  assessMemoryRelevance,
  buildMemoryRelevanceContext,
  createMemoryRecord,
  getMemoryRecord,
  listMemoryRecords,
  matchHistoricalRisks,
  searchMemoryRecords,
  supersededBy,
  type CreateMemoryRecordInput,
  type QAMemoryRecord,
} from "./index.js";

const IDOR_MEMORY: CreateMemoryRecordInput = {
  regressionTests: [
    {
      adapter: "vitest",
      id: "invoice-cross-account-access",
      path: "tests/regressions/cross-account.test.ts",
      requirementRefs: ["invoice-access#INV-001"],
    },
  ],
  relatedContracts: ["invoice-access"],
  relatedFiles: ["src/app/api/invoices/[invoiceId]/route.ts", "src/services/invoices.ts"],
  rootCause: "Missing server-side invoice ownership check.",
  severity: "critical",
  source: "manual",
  summary: "Users could access another account's invoice by changing invoiceId.",
  tags: ["authorization", "idor", "invoices"],
  title: "Cross-account invoice access",
  type: "security-regression",
};

function storedRecord(overrides: Partial<QAMemoryRecord> = {}): QAMemoryRecord {
  return {
    ...IDOR_MEMORY,
    createdAt: "2026-08-18T08:00:00.000Z",
    id: "MEM-0143",
    schemaVersion: 1,
    source: "manual",
    status: "active",
    supersedes: [],
    ...overrides,
  };
}

const EXISTING_PATHS = new Set([
  "src/app/api/invoices/[invoiceId]/route.ts",
  "src/services/invoices.ts",
  "tests/regressions/cross-account.test.ts",
]);

function invoiceAuthorizationDiff(): GitDiffAnalysis {
  return {
    clean: false,
    files: [
      {
        additions: 5,
        binary: false,
        classifications: ["authorization", "billing", "business-logic", "security-sensitive"],
        deletions: 2,
        hunks: [],
        path: "src/services/invoices/authorization.ts",
        status: "modified",
        symbols: ["authorizeInvoiceRead"],
      },
    ],
    summary: { additions: 5, changedFiles: 1, deletions: 2 },
  };
}

describe("QA memory", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function project(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maru-memory-"));
    roots.push(root);
    await mkdir(join(root, ".maru", "memory"), { recursive: true });
    await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n", "utf8");
    return root;
  }

  it("creates immutable sequential records and lists them newest first", async () => {
    const root = await project();
    const first = await createMemoryRecord(root, IDOR_MEMORY, {
      now: new Date("2026-08-18T08:00:00.000Z"),
    });
    const second = await createMemoryRecord(
      root,
      { ...IDOR_MEMORY, title: "Invoice policy regression" },
      { now: new Date("2026-08-18T09:00:00.000Z") },
    );

    expect(first).toMatchObject({ path: ".maru/memory/MEM-0001.json", record: { id: "MEM-0001" } });
    expect(second.record.id).toBe("MEM-0002");
    expect(JSON.parse(await readFile(join(root, first.path), "utf8"))).toMatchObject({
      createdAt: "2026-08-18T08:00:00.000Z",
      schemaVersion: 1,
      status: "active",
      title: "Cross-account invoice access",
    });
    await expect(listMemoryRecords(root)).resolves.toEqual([
      expect.objectContaining({ id: "MEM-0002" }),
      expect.objectContaining({ id: "MEM-0001" }),
    ]);
    await expect(getMemoryRecord(root, "MEM-0001")).resolves.toMatchObject({
      rootCause: "Missing server-side invoice ownership check.",
    });
  });

  it("searches across IDs, tags, files, contracts, and root causes with explainable matches", async () => {
    const root = await project();
    await createMemoryRecord(root, IDOR_MEMORY, { now: new Date("2026-08-18T08:00:00Z") });

    const results = await searchMemoryRecords(root, "invoice authorization");

    expect(results).toEqual([
      expect.objectContaining({
        matchedFields: expect.arrayContaining(["relatedFiles", "tags"]),
        matchedTerms: ["authorization", "invoice"],
        record: expect.objectContaining({ id: "MEM-0001" }),
        score: expect.any(Number),
      }),
    ]);
    await expect(searchMemoryRecords(root, "unrelated-cache-key")).resolves.toEqual([]);
  });

  it("matches a later invoice authorization diff and returns its historical regression", () => {
    const matches = matchHistoricalRisks(invoiceAuthorizationDiff(), [storedRecord()]);

    expect(matches).toEqual([
      expect.objectContaining({
        matchedTerms: expect.arrayContaining(["authorization", "invoice"]),
        memoryId: "MEM-0143",
        regressionTests: [
          expect.objectContaining({ path: "tests/regressions/cross-account.test.ts" }),
        ],
        relevance: expect.objectContaining({ level: "high", score: 100, supersededBy: [] }),
        severity: "critical",
      }),
    ]);
    expect(matches[0]?.reasons.join(" ")).toContain("historical");
    expect(matches[0]?.relevance.signals.map((signal) => signal.code)).toEqual([
      "current-change",
    ]);
  });

  it("keeps a record fully relevant while its files, contract, and regression test still exist", () => {
    const relevance = assessMemoryRelevance(storedRecord(), [storedRecord()], {
      contracts: [{ id: "invoice-access", status: "approved" }],
      existingPaths: EXISTING_PATHS,
      history: [
        {
          committedAt: "2026-08-17T08:00:00.000Z",
          paths: ["tests/regressions/cross-account.test.ts"],
        },
      ],
      now: "2026-09-01T00:00:00.000Z",
    });

    expect(relevance).toEqual({
      level: "high",
      score: 100,
      signals: [
        expect.objectContaining({ code: "related-files-present", points: 0 }),
        expect.objectContaining({
          code: "related-contracts-active",
          message: "Related Quality Contract remains active: invoice-access (approved).",
          points: 0,
        }),
        expect.objectContaining({
          code: "regression-tests-present",
          message: "Recorded regression test still exists: tests/regressions/cross-account.test.ts.",
          points: 0,
        }),
        expect.objectContaining({ code: "regression-tests-changed", points: 0 }),
      ],
      supersededBy: [],
    });
  });

  it("explains why history whose files, contract, and test disappeared is low relevance", () => {
    const relevance = assessMemoryRelevance(storedRecord(), [storedRecord()], {
      contracts: [],
      existingPaths: new Set(),
      history: [],
      now: "2027-09-01T00:00:00.000Z",
    });

    expect(relevance.level).toBe("low");
    expect(relevance.score).toBe(0);
    expect(relevance.signals).toEqual([
      {
        code: "related-files-present",
        message:
          "None of the 2 originally affected files still exist: src/app/api/invoices/[invoiceId]/route.ts, src/services/invoices.ts.",
        paths: ["src/app/api/invoices/[invoiceId]/route.ts", "src/services/invoices.ts"],
        points: -35,
      },
      {
        code: "related-contracts-active",
        message: "Related Quality Contract no longer exists: invoice-access.",
        points: -25,
      },
      {
        code: "regression-tests-present",
        message:
          "Recorded regression test no longer exists: tests/regressions/cross-account.test.ts.",
        paths: ["tests/regressions/cross-account.test.ts"],
        points: -30,
      },
      { code: "age", message: "Record is 378 days old.", points: -10 },
    ]);
  });

  it("scores partial evidence proportionally and downgrades superseded or rewritten history", () => {
    const partial = assessMemoryRelevance(storedRecord(), [storedRecord()], {
      contracts: [{ id: "invoice-access", status: "deprecated" }],
      existingPaths: new Set([
        "src/services/invoices.ts",
        "tests/regressions/cross-account.test.ts",
      ]),
      history: ["2026-08-19", "2026-08-20", "2026-08-21"].map((day) => ({
        committedAt: `${day}T08:00:00.000Z`,
        paths: ["tests/regressions/cross-account.test.ts"],
      })),
    });
    expect(partial.signals.map((signal) => [signal.code, signal.points])).toEqual([
      ["related-files-present", -18],
      ["related-contracts-active", -25],
      ["regression-tests-present", 0],
      ["regression-tests-changed", -20],
    ]);
    expect(partial.signals[1]?.message).toBe(
      "Related Quality Contract is deprecated: invoice-access.",
    );
    expect(partial.signals[3]?.message).toContain("changed significantly");
    expect(partial).toMatchObject({ level: "low", score: 37 });

    const older = storedRecord({ id: "MEM-0001" });
    const newer = storedRecord({
      createdAt: "2026-09-01T08:00:00.000Z",
      id: "MEM-0002",
      supersedes: ["MEM-0001"],
    });
    const superseded = assessMemoryRelevance(older, [newer, older], {
      contracts: [{ id: "invoice-access", status: "approved" }],
      existingPaths: EXISTING_PATHS,
    });
    expect(superseded).toMatchObject({ level: "low", score: 30, supersededBy: ["MEM-0002"] });
    expect(superseded.signals[0]).toEqual({
      code: "superseded",
      message: "Superseded by newer QA memory: MEM-0002.",
      points: -70,
    });
    expect(assessMemoryRelevance(newer, [newer, older]).level).toBe("high");
    expect(supersededBy([newer, older])).toEqual(new Map([["MEM-0001", ["MEM-0002"]]]));
  });

  it("skips every signal without evidence so a bare match stays relevant", () => {
    expect(assessMemoryRelevance(storedRecord(), [storedRecord()])).toEqual({
      level: "high",
      score: 100,
      signals: [],
      supersededBy: [],
    });
  });

  it("stores and validates supersedes references against existing records", async () => {
    const root = await project();
    await expect(
      createMemoryRecord(root, { ...IDOR_MEMORY, supersedes: ["MEM-0009"] }),
    ).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
    await expect(
      createMemoryRecord(root, { ...IDOR_MEMORY, supersedes: ["mem-1"] }),
    ).rejects.toMatchObject({ code: "MEMORY_INVALID" });

    const first = await createMemoryRecord(root, IDOR_MEMORY, {
      now: new Date("2026-08-18T08:00:00.000Z"),
    });
    const second = await createMemoryRecord(
      root,
      { ...IDOR_MEMORY, supersedes: ["MEM-0001"], title: "Invoice policy rewrite" },
      { now: new Date("2026-08-19T08:00:00.000Z") },
    );

    expect(first.record.supersedes).toEqual([]);
    expect(second.record.supersedes).toEqual(["MEM-0001"]);
    expect(JSON.parse(await readFile(join(root, second.path), "utf8")).supersedes).toEqual([
      "MEM-0001",
    ]);
    const records = await listMemoryRecords(root);
    expect(supersededBy(records)).toEqual(new Map([["MEM-0001", ["MEM-0002"]]]));
    expect(matchHistoricalRisks(invoiceAuthorizationDiff(), records)).toEqual([
      expect.objectContaining({
        memoryId: "MEM-0001",
        relevance: expect.objectContaining({ level: "low" }),
      }),
      expect.objectContaining({
        memoryId: "MEM-0002",
        relevance: expect.objectContaining({ level: "high" }),
      }),
    ]);
  });

  it("builds relevance context from the working tree and Git history", async () => {
    const root = await project();
    await mkdir(join(root, "src", "services"), { recursive: true });
    await writeFile(join(root, "src", "services", "invoices.ts"), "export {};\n", "utf8");
    const run = vi.fn().mockResolvedValue(
      "\u001e2026-08-20T08:00:00+00:00\n\ntests/regressions/cross-account.test.ts\n",
    );

    const context = await buildMemoryRelevanceContext(root, [storedRecord()], {
      now: new Date("2026-09-01T00:00:00.000Z"),
      runner: { run },
    });

    expect(context).toEqual({
      existingPaths: new Set(["src/services/invoices.ts"]),
      history: [
        {
          committedAt: "2026-08-20T08:00:00.000Z",
          paths: ["tests/regressions/cross-account.test.ts"],
        },
      ],
      now: "2026-09-01T00:00:00.000Z",
    });
    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--since=2026-08-18T08:00:00.000Z",
        "tests/regressions/cross-account.test.ts",
      ]),
      root,
    );
    await expect(
      buildMemoryRelevanceContext(root, [], { runner: { run } }),
    ).resolves.toMatchObject({ existingPaths: new Set(), history: [] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe linked paths and use before initialization", async () => {
    const root = await project();
    await expect(
      createMemoryRecord(root, { ...IDOR_MEMORY, relatedFiles: ["../outside.ts"] }),
    ).rejects.toBeInstanceOf(MemoryError);

    const uninitialized = await mkdtemp(join(tmpdir(), "maru-memory-uninitialized-"));
    roots.push(uninitialized);
    await expect(listMemoryRecords(uninitialized)).rejects.toMatchObject({
      code: "MEMORY_NOT_INITIALIZED",
    });
  });

  it("reports corrupt stored records as read failures", async () => {
    const root = await project();
    await writeFile(
      join(root, ".maru", "memory", "MEM-0001.json"),
      JSON.stringify({
        ...IDOR_MEMORY,
        createdAt: "2026-08-18T08:00:00.000Z",
        id: "MEM-0001",
        relatedFiles: ["../outside.ts"],
        schemaVersion: 1,
        status: "active",
      }),
      "utf8",
    );

    await expect(listMemoryRecords(root)).rejects.toMatchObject({ code: "MEMORY_READ_FAILED" });
  });
});
