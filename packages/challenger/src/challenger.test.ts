import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RiskAssessment } from "@maru/risk";
import {
  ChallengeError,
  buildChallengeActivation,
  formatChallengeBrief,
  formatChallengeReport,
  prepareAndWriteChallengeBrief,
  submitChallengeFromFile,
  submitChallengeResponse,
  type ChallengeBriefResult,
} from "./index.js";

const roots: string[] = [];

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "maru-challenger-test-"));
  roots.push(root);
  return root;
}

function risk(level: RiskAssessment["level"]): RiskAssessment {
  const score = { critical: 90, high: 65, low: 10, moderate: 35 }[level];
  return {
    analysis: {
      clean: false,
      files: [
        {
          additions: 12,
          binary: false,
          classifications: ["authorization", "business-logic", "security-sensitive"],
          deletions: 3,
          hunks: [
            { context: "readInvoice", newLines: 12, newStart: 20, oldLines: 3, oldStart: 20 },
          ],
          path: "src/invoices/read-invoice.ts",
          status: "modified",
          symbols: ["readInvoice"],
        },
      ],
      summary: { additions: 12, changedFiles: 1, deletions: 3 },
    },
    historicalRisks: [
      {
        exactFileMatches: ["src/invoices/read-invoice.ts"],
        matchedTerms: ["invoice"],
        memoryId: "MEM-20260820-001",
        reasons: ["Touches a prior tenant-isolation regression."],
        regressionTests: [],
        relatedContracts: ["invoice-access"],
        severity: "critical",
        title: "Cross-tenant invoice exposure",
        type: "security-regression",
      },
    ],
    level,
    reasons: [{ code: "authorization", message: "Touches authorization.", points: 25 }],
    recommendedTestCategories: ["security", "unit"],
    relatedContracts: [
      {
        contractId: "invoice-access",
        criticality: "critical",
        invariantIds: ["INV-INV-001"],
        matchedTerms: ["invoice"],
        requirementIds: ["INV-001"],
        status: "approved",
        title: "Invoice access",
      },
    ],
    score,
  };
}

const requirements = [
  {
    contractId: "invoice-access",
    id: "INV-001",
    kind: "requirement" as const,
    statement: "Users may only read invoices owned by their organization.",
  },
  {
    contractId: "invoice-access",
    id: "INV-INV-001",
    kind: "invariant" as const,
    statement: "Cross-organization invoice access is forbidden.",
  },
];

const challenge = {
  category: "permission-abuse" as const,
  counterexample: "A signed-in user requests an invoice owned by a different organization.",
  id: "cross-tenant-invoice-read",
  priority: "critical" as const,
  requirementRefs: ["invoice-access#INV-001", "invoice-access#INV-INV-001"],
  targetFiles: ["src/invoices/read-invoice.ts"],
  title: "Cross-tenant invoice read",
  verification: {
    category: "security" as const,
    objective: "Prove ownership is enforced after authentication.",
    steps: ["Create invoices for two organizations.", "Request organization B's invoice as A."],
  },
  whyLikelyMissed: "A happy-path authentication test does not exercise tenant isolation.",
};

function submission(
  prepared: ChallengeBriefResult,
  provenance: Record<string, unknown> = {
    attested: true,
    client: "Codex",
    isolation: "subagent",
    model: "gpt-5",
    usage: { estimatedCostUsd: 0.04, inputTokens: 300, outputTokens: 120, totalTokens: 420 },
  },
): unknown {
  return {
    briefHash: prepared.brief.briefHash,
    briefId: prepared.brief.briefId,
    provenance,
    result: {
      challenges: [challenge],
      summary: "Challenge the authorization boundary independently of authentication.",
    },
    schemaVersion: 1,
  };
}

async function prepare(root: string, level: RiskAssessment["level"] = "critical") {
  return prepareAndWriteChallengeBrief(root, new Date("2026-08-20T20:01:00Z"), {
    assessRisk: vi.fn().mockResolvedValue(risk(level)),
    contractRequirements: vi.fn().mockResolvedValue(requirements),
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Challenger activation", () => {
  it("activates only for high/critical risk, explicit requests, or release verification", () => {
    expect(buildChallengeActivation("low", {})).toEqual({ activated: false, triggers: [] });
    expect(buildChallengeActivation("high", {})).toEqual({ activated: true, triggers: ["high-risk"] });
    expect(
      buildChallengeActivation("critical", { explicit: true, releaseVerification: true }),
    ).toEqual({
      activated: true,
      triggers: ["critical-risk", "explicit-request", "release-verification"],
    });
    expect(buildChallengeActivation("moderate", { explicit: true })).toEqual({
      activated: true,
      triggers: ["explicit-request"],
    });
  });
});

describe("client-mediated Challenger protocol", () => {
  it("writes a bounded, hashed brief without changed source contents", async () => {
    const root = await projectRoot();
    const prepared = await prepare(root);
    const persisted = JSON.parse(
      await readFile(join(root, ...prepared.path.split("/")), "utf8"),
    ) as Record<string, unknown>;

    expect(prepared.brief.activation.triggers).toEqual(["critical-risk"]);
    expect(prepared.brief.context.requirements).toEqual(requirements);
    expect(prepared.brief.context.historicalRisks[0]?.memoryId).toBe("MEM-20260820-001");
    expect(prepared.brief.briefHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(persisted).toEqual(prepared.brief);
    expect(prepared.brief.context.changedFiles[0]).not.toHaveProperty("source");
    expect(JSON.stringify(prepared.brief)).not.toContain("secret-value");
    expect(formatChallengeBrief(prepared)).toContain("fresh QA thread/subagent");
  });

  it("refuses submission for a non-activated internal brief", async () => {
    const root = await projectRoot();
    const prepared = await prepare(root, "low");
    await expect(submitChallengeResponse(root, prepared.path, submission(prepared))).rejects.toMatchObject({
      code: "CHALLENGE_INACTIVE",
    });
  });

  it("records an attested isolated review and client-reported usage", async () => {
    const root = await projectRoot();
    const prepared = await prepare(root);
    const result = await submitChallengeResponse(
      root,
      prepared.path,
      submission(prepared),
      new Date("2026-08-20T20:02:00Z"),
    );

    expect(result.report.status).toBe("completed");
    expect(result.report.gate).toEqual({ reasons: [], status: "passed" });
    expect(result.report.challenges).toEqual([challenge]);
    expect(result.report.provenance).toMatchObject({
      attested: true,
      client: "Codex",
      isolation: "subagent",
      usage: { source: "client-reported", totalTokens: 420 },
    });
    expect(JSON.parse(await readFile(join(root, ...result.path.split("/")), "utf8"))).toEqual(
      result.report,
    );
    expect(formatChallengeReport(result)).toContain("review hypotheses");
  });

  it("preserves missing usage as not reported", async () => {
    const root = await projectRoot();
    const prepared = await prepare(root);
    const result = await submitChallengeResponse(
      root,
      prepared.path,
      submission(prepared, { attested: true, client: "Claude Code", isolation: "fresh-thread" }),
    );
    expect(result.report.provenance.usage).toEqual({
      estimatedCostUsd: null,
      inputTokens: null,
      outputTokens: null,
      source: "not-reported",
      totalTokens: null,
    });
  });

  it.each([
    { attested: false, client: "Cursor", isolation: "fresh-thread" },
    { attested: true, client: "unknown-client", isolation: "unknown" },
  ])("blocks review provenance that does not attest isolation", async (provenance) => {
    const root = await projectRoot();
    const prepared = await prepare(root);
    const result = await submitChallengeResponse(root, prepared.path, submission(prepared, provenance));
    expect(result.report.status).toBe("unattested");
    expect(result.report.gate.status).toBe("blocked");
  });

  it("rejects hallucinated requirement references and changed files", async () => {
    const root = await projectRoot();
    const prepared = await prepare(root);
    const invalid = submission(prepared) as {
      result: { challenges: Array<Record<string, unknown>> };
    };
    invalid.result.challenges[0] = {
      ...invalid.result.challenges[0],
      requirementRefs: ["unknown#REQ-1"],
      targetFiles: ["src/not-in-diff.ts"],
    };
    await expect(submitChallengeResponse(root, prepared.path, invalid)).rejects.toMatchObject({
      code: "CHALLENGE_INVALID_SUBMISSION",
    });
  });

  it("rejects a tampered brief and a mismatched response", async () => {
    const root = await projectRoot();
    const prepared = await prepare(root);
    await expect(
      submitChallengeResponse(root, prepared.path, {
        ...(submission(prepared) as Record<string, unknown>),
        briefHash: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID_SUBMISSION" });

    const briefFile = join(root, ...prepared.path.split("/"));
    const brief = JSON.parse(await readFile(briefFile, "utf8")) as Record<string, unknown>;
    brief.risk = { level: "low", score: 1 };
    await writeFile(briefFile, JSON.stringify(brief), "utf8");
    await expect(submitChallengeResponse(root, prepared.path, submission(prepared))).rejects.toMatchObject({
      code: "CHALLENGE_INVALID_BRIEF",
    });
  });

  it("accepts a project-local response file only once", async () => {
    const root = await projectRoot();
    const prepared = await prepare(root);
    await writeFile(join(root, "challenge-response.json"), JSON.stringify(submission(prepared)), "utf8");
    await expect(
      submitChallengeFromFile(root, prepared.path, "challenge-response.json"),
    ).resolves.toMatchObject({ report: { status: "completed" } });
    await expect(
      submitChallengeFromFile(root, prepared.path, "challenge-response.json"),
    ).rejects.toMatchObject({ code: "CHALLENGE_ALREADY_SUBMITTED" });
    await expect(
      submitChallengeFromFile(root, prepared.path, "../outside.json"),
    ).rejects.toBeInstanceOf(ChallengeError);
  });
});
