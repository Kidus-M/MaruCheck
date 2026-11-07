/**
 * Swarm mode regressions. Each test replays a bypass that worked against 0.6.1 through
 * the real verification path, on a real Git repository, with a real test run.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgentGate } from "@maru/agent";
import { approveContract } from "@maru/contracts";
import { createAndWriteVerificationReport } from "@maru/evidence";
import { analyzeGitDiff, GitBaseError } from "@maru/git";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = new Date("2026-11-07T12:00:00.000Z");

const CONTRACT_TEST = `import { expect, it } from "vitest";
import { LIMIT } from "../src/quota.js";
it("usage-quota#QUOTA-001 caps the free plan", () => {
  expect(LIMIT).toBe(10);
});
`;

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function commitAll(root: string, message: string): void {
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", message);
}

describe("swarm mode", () => {
  let root: string;
  let draftContract: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "maru-swarm-"));
    await mkdir(join(root, ".maru", "contracts"), { recursive: true });
    await mkdir(join(root, "src"));
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        devDependencies: { vitest: "*" },
        name: "swarm-fixture",
        scripts: { test: "vitest run" },
        type: "module",
      }),
    );
    await writeFile(join(root, ".gitignore"), "node_modules/\n.maru/generated/\n.maru/artifacts/\n");
    await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n");
    draftContract = await readFile(
      join(repositoryRoot, "examples", "quota-app", "contracts", "usage-quota.yml"),
      "utf8",
    );
    await writeFile(join(root, ".maru", "contracts", "usage-quota.yml"), draftContract);
    await writeFile(join(root, "src", "quota.ts"), "export const LIMIT = 10;\n");
    await writeFile(join(root, "tests", "usage-quota.contract.test.ts"), CONTRACT_TEST);
    await symlink(
      join(repositoryRoot, "node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    git(root, "init", "--quiet", "--initial-branch=main");
    git(root, "config", "user.email", "swarm@example.com");
    git(root, "config", "user.name", "Swarm Test");
    git(root, "config", "core.autocrlf", "false");
    await approveContract(root, "usage-quota", {
      approvedAt: NOW,
      approvedBy: "product-owner@example.com",
    });
    commitAll(root, "baseline");
  });

  afterEach(async () => {
    await rm(root, { force: true, maxRetries: 5, recursive: true });
  });

  it("keeps committed work in scope when a base is given", async () => {
    await writeFile(join(root, "src", "quota.ts"), "export const LIMIT = 1000;\n");
    commitAll(root, "raise limit");

    expect((await analyzeGitDiff(root)).clean).toBe(true);
    const ranged = await analyzeGitDiff(root, undefined, { base: "HEAD~1" });
    expect(ranged.files.map((file) => file.path)).toEqual(["src/quota.ts"]);
  });

  it("rejects a base that could be read as an option", async () => {
    await expect(analyzeGitDiff(root, undefined, { base: "--output=x" })).rejects.toBeInstanceOf(
      GitBaseError,
    );
  });

  it("blocks a committed violation that the working-tree gate passes", async () => {
    await writeFile(join(root, "src", "quota.ts"), "export const LIMIT = 1000;\n");
    commitAll(root, "raise limit");

    const shipped = await createAndWriteVerificationReport(root, NOW);
    expect(shipped.report.gate.status).toBe("passed");

    const swarm = await createAndWriteVerificationReport(root, NOW, {
      base: "HEAD~1",
      strict: true,
    });
    expect(swarm.report.gate.status).toBe("blocked");
  }, 60_000);

  it("blocks a violation split across agents into a neutrally named file", async () => {
    await writeFile(join(root, "src", "tuning.ts"), "export const T = { a: 10 };\n");
    await writeFile(
      join(root, "src", "quota.ts"),
      'import { T } from "./tuning.js";\nexport const LIMIT = T.a;\n',
    );
    commitAll(root, "agent a: extract constants");
    const agentB = "export const T = { a: 1000 };\n";
    await writeFile(join(root, "src", "tuning.ts"), agentB);

    const shipped = await createAndWriteVerificationReport(root, NOW);
    expect(shipped.report.summary.requirementsFailed).toBe(0);

    const swarm = await createAndWriteVerificationReport(root, NOW, {
      base: "HEAD~1",
      strict: true,
    });
    expect(swarm.report.gate.status).toBe("blocked");
    expect(swarm.report.summary.requirementsFailed).toBeGreaterThan(0);
  }, 60_000);

  it("passes an honest refactor in a project with no e2e runner", async () => {
    await writeFile(join(root, "src", "tuning.ts"), "export const T = { a: 10 };\n");
    await writeFile(
      join(root, "src", "quota.ts"),
      'import { T } from "./tuning.js";\nexport const LIMIT = T.a;\n',
    );
    commitAll(root, "extract constants");

    const swarm = await createAndWriteVerificationReport(root, NOW, {
      base: "HEAD~1",
      strict: true,
    });
    expect(swarm.report.gate.status).toBe("passed");
    expect(swarm.report.summary.requirementsPassed).toBe(5);
  }, 60_000);

  it("blocks when strict verification has nothing approved to verify", async () => {
    await writeFile(join(root, ".maru", "contracts", "usage-quota.yml"), draftContract);
    const swarm = await createAndWriteVerificationReport(root, NOW, { strict: true });
    expect(swarm.report.gate.status).toBe("blocked");
  }, 60_000);

  it("fails closed when the configuration is deleted", async () => {
    await rm(join(root, ".maru", "maru.yml"));
    const shipped = await runAgentGate(root, { now: NOW });
    expect(shipped.exitCode).toBe(0);

    const swarm = await runAgentGate(root, { now: NOW, strict: true });
    expect(swarm).toMatchObject({ blocked: true, exitCode: 2 });
  });

  it("fails closed when a contract is corrupted", async () => {
    await writeFile(join(root, ".maru", "contracts", "usage-quota.yml"), "version: [broken\n");
    const shipped = await runAgentGate(root, { now: NOW });
    expect(shipped).toMatchObject({ blocked: false, skipped: "verification-unavailable" });

    const swarm = await runAgentGate(root, { now: NOW, strict: true });
    expect(swarm).toMatchObject({ blocked: true, exitCode: 2 });
  });

  it("does not release a strict gate because of stop_hook_active", async () => {
    await writeFile(join(root, "src", "quota.ts"), "export const LIMIT = 1000;\n");
    const input = { session_id: "s", stop_hook_active: true };

    const shipped = await runAgentGate(root, { input, now: NOW });
    expect(shipped.blocked).toBe(false);

    const swarm = await runAgentGate(root, { input, now: NOW, strict: true });
    expect(swarm.blocked).toBe(true);
  }, 60_000);

  it("reports unverified work plainly once the strict loop guard trips", async () => {
    await writeFile(join(root, "src", "quota.ts"), "export const LIMIT = 1000;\n");
    const input = { session_id: "s", stop_hook_active: true };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await runAgentGate(root, { input, now: NOW, strict: true })).blocked).toBe(true);
    }

    const released = await runAgentGate(root, { input, now: NOW, strict: true });
    expect(released).toMatchObject({ blocked: false, skipped: "loop-guard" });
    expect(released.reason).toContain("UNVERIFIED");
    const state = await readFile(join(root, ".maru", "generated", "agent-gate.json"), "utf8");
    expect(JSON.parse(state)).toMatchObject({ consecutiveBlocks: 3 });
  }, 120_000);
});
