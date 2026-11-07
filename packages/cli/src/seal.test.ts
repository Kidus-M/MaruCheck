/**
 * Replays the tampering that worked against 0.6.1: agents rewriting the contract, its
 * tests, or its approvals. A human holds the key, and agents only hold the repository.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approveContract } from "@maru/contracts";
import {
  approveContractAmendment,
  proposeContractAmendment,
  type ObservedBehavior,
} from "@maru/drift";
import { createAndWriteVerificationReport } from "@maru/evidence";
import { createSeal, generateSealKey, SealError, verifySeal } from "@maru/seal";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = new Date("2026-11-07T12:00:00.000Z");
const CONTRACT_PATH = [".maru", "contracts", "usage-quota.yml"];
const TEST_PATH = ["tests", "usage-quota.contract.test.ts"];

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
  git(root, "commit", "--quiet", "--allow-empty", "-m", message);
}

describe("seal", () => {
  let root: string;
  let keyDirectory: string;
  let keyPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "maru-seal-"));
    keyDirectory = await mkdtemp(join(tmpdir(), "maru-seal-key-"));
    keyPath = join(keyDirectory, "seal.pem");
    await mkdir(join(root, ".maru", "contracts"), { recursive: true });
    await mkdir(join(root, "src"));
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        devDependencies: { vitest: "*" },
        name: "seal-fixture",
        scripts: { test: "vitest run" },
        type: "module",
      }),
    );
    await writeFile(
      join(root, ".gitignore"),
      "node_modules/\n.maru/generated/\n.maru/artifacts/\n",
    );
    await writeFile(join(root, ".maru", "maru.yml"), "version: 1\n");
    await writeFile(
      join(root, ...CONTRACT_PATH),
      await readFile(
        join(repositoryRoot, "examples", "quota-app", "contracts", "usage-quota.yml"),
        "utf8",
      ),
    );
    await writeFile(join(root, "src", "quota.ts"), "export const LIMIT = 10;\n");
    await writeFile(join(root, ...TEST_PATH), CONTRACT_TEST);
    await symlink(
      join(repositoryRoot, "node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    git(root, "init", "--quiet", "--initial-branch=main");
    git(root, "config", "user.email", "seal@example.com");
    git(root, "config", "user.name", "Seal Test");
    git(root, "config", "core.autocrlf", "false");
    await approveContract(root, "usage-quota", {
      approvedAt: NOW,
      approvedBy: "product-owner@example.com",
    });
    await generateSealKey(root, keyPath);
    await createSeal(root, { keyPath, now: NOW, signer: "product-owner@example.com" });
    commitAll(root, "sealed baseline");
    git(root, "tag", "base");
  });

  afterEach(async () => {
    await rm(root, { force: true, maxRetries: 5, recursive: true });
    await rm(keyDirectory, { force: true, recursive: true });
  });

  it("accepts an untouched repository", async () => {
    await expect(verifySeal(root, "base")).resolves.toEqual([]);
  });

  it("refuses to store the key inside the project", async () => {
    await expect(generateSealKey(root, join(root, "seal.pem"))).rejects.toBeInstanceOf(SealError);
  });

  it("enforces nothing when the base has not opted in", async () => {
    git(root, "commit", "--quiet", "--allow-empty", "-m", "next");
    git(root, "rm", "--quiet", ".maru/seal.pub");
    commitAll(root, "opted out");
    git(root, "tag", "unsealed");
    await expect(verifySeal(root, "unsealed")).resolves.toEqual([]);
  });

  it("detects an edited approved contract", async () => {
    const path = join(root, ...CONTRACT_PATH);
    await writeFile(path, (await readFile(path, "utf8")).replace("at most 10", "at most 1000"));
    await expect(verifySeal(root, "base")).resolves.toEqual([
      "Sealed file changed: .maru/contracts/usage-quota.yml",
    ]);
  });

  it("blocks an agent that approves its own contract change", async () => {
    const path = join(root, ...CONTRACT_PATH);
    await writeFile(
      path,
      (await readFile(path, "utf8"))
        .replace("status: approved", "status: draft")
        .replace("at most 10", "at most 1000"),
    );
    await approveContract(root, "usage-quota", {
      approvedAt: NOW,
      approvedBy: "product-owner@example.com",
    });
    await writeFile(join(root, "src", "quota.ts"), "export const LIMIT = 1000;\n");
    await writeFile(join(root, ...TEST_PATH), CONTRACT_TEST.replace("toBe(10)", "toBe(1000)"));
    commitAll(root, "agent raises the limit and approves it");

    const result = await createAndWriteVerificationReport(root, NOW, {
      base: "base",
      strict: true,
    });
    expect(result.report.gate.status).toBe("blocked");
    expect(result.report.gate.reasons.join("\n")).toContain("Sealed file changed");
  }, 60_000);

  it("blocks approval laundering between two agents", async () => {
    const { path } = await proposeContractAmendment(root, "usage-quota", await readObservations(), {
      now: NOW,
      proposedBy: "agent-a",
      reason: "matches observed usage",
    });
    await approveContractAmendment(root, path, { approvedBy: "product", now: NOW });
    commitAll(root, "agent b approves as the owner");

    await expect(verifySeal(root, "base")).resolves.toContain(
      "Sealed file changed: .maru/contracts/usage-quota.yml",
    );
  });

  it("detects gutted contract tests and changed test settings", async () => {
    await writeFile(join(root, ...TEST_PATH), 'import { it } from "vitest";\nit("x", () => {});\n');
    await writeFile(join(root, "vitest.config.mjs"), "export default { test: { include: [] } };\n");
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, scripts: { test: "true" } }));

    await expect(verifySeal(root, "base")).resolves.toEqual([
      "Protected file is not sealed: vitest.config.mjs",
      "Sealed file changed: package.json#test-settings",
      "Sealed file changed: tests/usage-quota.contract.test.ts",
    ]);
  });

  it("ignores ordinary source and dependency changes", async () => {
    await writeFile(join(root, "src", "other.ts"), "export const other = 1;\n");
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, dependencies: { zod: "*" } }));
    await expect(verifySeal(root, "base")).resolves.toEqual([]);
  });

  it("rejects an agent that swaps in its own key and seal", async () => {
    const agentKey = join(keyDirectory, "agent.pem");
    await generateSealKey(root, agentKey);
    const path = join(root, ...CONTRACT_PATH);
    await writeFile(path, (await readFile(path, "utf8")).replace("at most 10", "at most 1000"));
    await createSeal(root, { keyPath: agentKey, now: NOW, signer: "product-owner@example.com" });
    commitAll(root, "agent reseals with its own key");

    await expect(verifySeal(root, "base")).resolves.toEqual([
      "The seal signature does not match the public key at the trusted base.",
    ]);
  });

  it("rejects a forged manifest and a deleted one", async () => {
    const manifestPath = join(root, ".maru", "seal.json");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, manifest.replace('"signer": "product', '"signer": "agent'));
    await expect(verifySeal(root, "base")).resolves.toEqual([
      "The seal signature does not match the public key at the trusted base.",
    ]);
    await rm(manifestPath);
    await expect(verifySeal(root, "base")).resolves.toEqual([
      "The seal manifest is missing or unreadable.",
    ]);
  });

  it("rejects an older valid seal restored to undo a stronger contract", async () => {
    const oldSeal = await readFile(join(root, ".maru", "seal.json"), "utf8");
    const oldContract = await readFile(join(root, ...CONTRACT_PATH), "utf8");
    const path = join(root, ...CONTRACT_PATH);
    await writeFile(path, oldContract.replace("at most 10 generations", "at most 5 generations"));
    await createSeal(root, { keyPath, now: NOW, signer: "product-owner@example.com" });
    commitAll(root, "human tightens the contract");
    git(root, "tag", "tightened");

    await writeFile(path, oldContract);
    await writeFile(join(root, ".maru", "seal.json"), oldSeal);
    commitAll(root, "agent restores the older seal");

    const issues = await verifySeal(root, "tightened");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("older than the base");
  });

  it("accepts a contract change a human re-sealed", async () => {
    const path = join(root, ...CONTRACT_PATH);
    await writeFile(path, (await readFile(path, "utf8")).replace("at most 10", "at most 5"));
    await createSeal(root, { keyPath, now: NOW, signer: "product-owner@example.com" });
    commitAll(root, "human changes the contract");

    await expect(verifySeal(root, "base")).resolves.toEqual([]);
  });

  async function readObservations(): Promise<readonly ObservedBehavior[]> {
    const parsed = JSON.parse(
      await readFile(join(repositoryRoot, "examples", "quota-app", "observations.json"), "utf8"),
    ) as { readonly observations?: readonly ObservedBehavior[] } | readonly ObservedBehavior[];
    return Array.isArray(parsed)
      ? parsed
      : (parsed as { observations: readonly ObservedBehavior[] }).observations;
  }
});
