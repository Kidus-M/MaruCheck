import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";

describe("maru CLI", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  async function createProject(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "maru-cli-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src/app"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "cli-fixture",
        dependencies: { next: "16.2.11", react: "19.2.8" },
        devDependencies: { typescript: "7.0.0", vitest: "4.0.0" },
      }),
    );
    await writeFile(join(root, "package-lock.json"), "{}");
    await writeFile(
      join(root, "src/app/page.tsx"),
      "export default function Page() { return null; }",
    );
    return root;
  }

  it("prints help without requiring cloud access", async () => {
    const output = { error: vi.fn(), log: vi.fn() };

    await expect(runCli(["--help"], output)).resolves.toBe(0);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Usage: maru <command>"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("rejects unknown commands", async () => {
    const output = { error: vi.fn(), log: vi.fn() };

    await expect(runCli(["unknown"], output)).resolves.toBe(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
  });

  it("runs init, scan, and doctor end to end", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };
    const dependencies = {
      cwd: root,
      doctorEnvironment: {
        executableAvailable: async () => true,
        runtimeVersion: "v24.1.0",
      },
      now: () => new Date("2026-08-15T18:00:00.000Z"),
    };

    await expect(runCli(["init"], output, dependencies)).resolves.toBe(0);
    await expect(runCli(["scan"], output, dependencies)).resolves.toBe(0);
    await expect(runCli(["doctor"], output, dependencies)).resolves.toBe(0);

    await expect(readFile(join(root, ".maru/maru.yml"), "utf8")).resolves.toContain(
      'name: "cli-fixture"',
    );
    await expect(
      readFile(join(root, ".maru/generated/project-scan.json"), "utf8"),
    ).resolves.toContain('"schemaVersion": 1');
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("MaruCheck initialized"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Project scan written"));
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("Doctor: all required checks passed"),
    );
    expect(output.error).not.toHaveBeenCalled();
  });

  it("explains how to recover when scan runs before initialization", async () => {
    const root = await createProject();
    const output = { error: vi.fn(), log: vi.fn() };

    await expect(runCli(["scan"], output, { cwd: root })).resolves.toBe(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("MARU_NOT_INITIALIZED"));
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("Run maru init"));
  });

  it("runs the local Quality Contract lifecycle", async () => {
    const root = await createProject();
    const requirementsPath = join(root, "requirements.md");
    await writeFile(
      requirementsPath,
      "Free users receive 10 generations each month. Pro users have unlimited generations. Upgrades require a verified payment webhook.",
      "utf8",
    );
    const output = { error: vi.fn(), log: vi.fn() };
    const dependencies = {
      cwd: root,
      now: () => new Date("2026-08-16T09:00:00.000Z"),
    };

    await expect(runCli(["init"], output, dependencies)).resolves.toBe(0);
    await expect(
      runCli(["contract", "create", "--from", "requirements.md"], output, dependencies),
    ).resolves.toBe(0);
    await expect(runCli(["contract", "list"], output, dependencies)).resolves.toBe(0);
    await expect(
      runCli(["contract", "show", "subscription-management"], output, dependencies),
    ).resolves.toBe(0);
    await expect(runCli(["contract", "validate"], output, dependencies)).resolves.toBe(0);
    await expect(
      runCli(
        ["contract", "approve", "subscription-management", "--by", "product-owner"],
        output,
        dependencies,
      ),
    ).resolves.toBe(0);

    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Draft contract created"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("subscription-management"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Contracts valid: 1"));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Contract approved"));
    expect(output.error).not.toHaveBeenCalled();
  });
});
