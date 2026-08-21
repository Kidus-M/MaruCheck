import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnoseProject } from "./doctor.js";
import { initializeProject } from "./initialize.js";
import { scanProject, writeProjectScan } from "./scanner.js";
import { detectStack } from "./stack-detector.js";

async function writeFixtureFile(root: string, path: string, content = ""): Promise<void> {
  const fullPath = join(root, ...path.split("/"));
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}

async function createNextFixture(root: string): Promise<void> {
  await writeFixtureFile(
    root,
    "package.json",
    JSON.stringify({
      name: "fixture-app",
      dependencies: {
        "@prisma/client": "1.0.0",
        next: "16.2.11",
        pg: "8.0.0",
        react: "19.2.8",
      },
      devDependencies: {
        "@playwright/test": "1.0.0",
        typescript: "7.0.0",
        vitest: "4.0.0",
      },
    }),
  );
  await writeFixtureFile(root, "package-lock.json", "{}");
  await writeFixtureFile(root, "tsconfig.json", "{}");
  await writeFixtureFile(root, ".github/workflows/ci.yml", "name: CI");
  await writeFixtureFile(
    root,
    "src/app/page.tsx",
    "export default function Page() { return null; }",
  );
  await writeFixtureFile(
    root,
    "src/app/projects/[id]/page.tsx",
    "export default function ProjectPage() { return null; }",
  );
  await writeFixtureFile(
    root,
    "src/app/api/health/route.ts",
    "export function GET() { return Response.json({ status: 'ok' }); }",
  );
  await writeFixtureFile(root, "src/lib/math.test.ts", "export {}; ");
  await writeFixtureFile(root, "e2e/home.spec.ts", "export {}; ");
  await writeFixtureFile(
    root,
    "node_modules/ignored/page.tsx",
    "throw new Error('must not scan');",
  );
}

describe("Phase 1 project workflow", () => {
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "maru-project-"));
    await createNextFixture(fixtureRoot);
  });

  afterEach(async () => {
    await rm(fixtureRoot, { force: true, recursive: true });
  });

  it("detects the supported Next.js stack and local tooling", async () => {
    const stack = await detectStack(fixtureRoot);

    expect(stack).toEqual({
      ci: { githubActions: true, workflowFiles: [".github/workflows/ci.yml"] },
      databaseLibraries: ["postgresql", "prisma"],
      frameworks: ["nextjs", "react"],
      languages: ["typescript"],
      packageManager: "npm",
      sourceDirectories: ["src"],
      testDirectories: ["e2e"],
      testFrameworks: ["playwright", "vitest"],
    });
  });

  it("initializes an idempotent local configuration without cloud access", async () => {
    const first = await initializeProject(fixtureRoot);

    expect(first.created).toBe(true);
    expect(first.configPath).toBe(".maru/maru.yml");
    await expect(readFile(join(fixtureRoot, ".maru/maru.yml"), "utf8")).resolves.toContain(
      'name: "fixture-app"',
    );
    await expect(readFile(join(fixtureRoot, ".maru/maru.yml"), "utf8")).resolves.toContain(
      "framework: vitest",
    );
    await expect(readFile(join(fixtureRoot, ".maru/.gitignore"), "utf8")).resolves.toBe(
      "artifacts/\ngenerated/\nconnection.env\n",
    );

    const customized = `${await readFile(join(fixtureRoot, ".maru/maru.yml"), "utf8")}\ncustom: true\n`;
    await writeFile(join(fixtureRoot, ".maru/maru.yml"), customized, "utf8");
    await writeFile(
      join(fixtureRoot, ".maru/.gitignore"),
      "artifacts/\nconnection.env\nproject-local-cache/\n",
      "utf8",
    );

    const second = await initializeProject(fixtureRoot);

    expect(second.created).toBe(false);
    await expect(readFile(join(fixtureRoot, ".maru/maru.yml"), "utf8")).resolves.toBe(customized);
    await expect(readFile(join(fixtureRoot, ".maru/.gitignore"), "utf8")).resolves.toBe(
      "artifacts/\nconnection.env\nproject-local-cache/\ngenerated/\n",
    );

    await initializeProject(fixtureRoot);
    await expect(readFile(join(fixtureRoot, ".maru/.gitignore"), "utf8")).resolves.toBe(
      "artifacts/\nconnection.env\nproject-local-cache/\ngenerated/\n",
    );
  });

  it("scans routes, tests, dependencies, CI, and source files deterministically", async () => {
    await initializeProject(fixtureRoot);
    const scan = await scanProject(fixtureRoot, new Date("2026-08-15T18:00:00.000Z"));

    expect(scan.schemaVersion).toBe(1);
    expect(scan.project.name).toBe("fixture-app");
    expect(scan.routes).toEqual([
      { kind: "api", methods: ["GET"], path: "/api/health", source: "src/app/api/health/route.ts" },
      { kind: "page", path: "/", source: "src/app/page.tsx" },
      { kind: "page", path: "/projects/[id]", source: "src/app/projects/[id]/page.tsx" },
    ]);
    expect(scan.tests.files).toEqual([
      { framework: "playwright", path: "e2e/home.spec.ts" },
      { framework: "vitest", path: "src/lib/math.test.ts" },
    ]);
    expect(scan.dependencies.production).toContain("next");
    expect(scan.dependencies.development).toContain("vitest");
    expect(scan.source.filesByExtension[".tsx"]).toBe(2);
    expect(scan.source.files).not.toContain("node_modules/ignored/page.tsx");

    const outputPath = await writeProjectScan(fixtureRoot, scan);
    expect(outputPath).toBe(".maru/generated/project-scan.json");
    await expect(readFile(join(fixtureRoot, outputPath), "utf8")).resolves.toContain(
      '"generatedAt": "2026-08-15T18:00:00.000Z"',
    );
  });

  it("reports actionable doctor failures and passes a configured project", async () => {
    const missingConfig = await diagnoseProject(fixtureRoot, {
      executableAvailable: async () => true,
      runtimeVersion: "v24.1.0",
    });

    expect(missingConfig.ok).toBe(false);
    expect(missingConfig.checks).toContainEqual(
      expect.objectContaining({
        code: "configuration",
        remediation: "Run maru init in the project root.",
        status: "fail",
      }),
    );

    await initializeProject(fixtureRoot);
    const configured = await diagnoseProject(fixtureRoot, {
      executableAvailable: async () => true,
      runtimeVersion: "v24.1.0",
    });

    expect(configured.ok).toBe(true);
    expect(configured.checks).toContainEqual(
      expect.objectContaining({ code: "git", status: "pass" }),
    );
    expect(configured.checks).toContainEqual(
      expect.objectContaining({ code: "runtime", status: "pass" }),
    );
  });
});
