import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GitDiffAnalysis } from "@maru/git";
import {
  MemoryError,
  createMemoryRecord,
  getMemoryRecord,
  listMemoryRecords,
  matchHistoricalRisks,
  searchMemoryRecords,
  type CreateMemoryRecordInput,
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
  relatedFiles: [
    "src/app/api/invoices/[invoiceId]/route.ts",
    "src/services/invoices.ts",
  ],
  rootCause: "Missing server-side invoice ownership check.",
  severity: "critical",
  source: "manual",
  summary: "Users could access another account's invoice by changing invoiceId.",
  tags: ["authorization", "idor", "invoices"],
  title: "Cross-account invoice access",
  type: "security-regression",
};

function invoiceAuthorizationDiff(): GitDiffAnalysis {
  return {
    clean: false,
    files: [
      {
        additions: 5,
        binary: false,
        classifications: [
          "authorization",
          "billing",
          "business-logic",
          "security-sensitive",
        ],
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
    const record = {
      ...IDOR_MEMORY,
      createdAt: "2026-08-18T08:00:00.000Z",
      id: "MEM-0143",
      schemaVersion: 1 as const,
      status: "active" as const,
    };

    const matches = matchHistoricalRisks(invoiceAuthorizationDiff(), [record]);

    expect(matches).toEqual([
      expect.objectContaining({
        matchedTerms: expect.arrayContaining(["authorization", "invoice"]),
        memoryId: "MEM-0143",
        regressionTests: [
          expect.objectContaining({ path: "tests/regressions/cross-account.test.ts" }),
        ],
        severity: "critical",
      }),
    ]);
    expect(matches[0]?.reasons.join(" ")).toContain("historical");
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
});
