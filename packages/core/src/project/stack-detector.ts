import { dependencyMap, ProjectWorkspace, readPackageManifest } from "./workspace.js";
import type {
  DetectedStack,
  Framework,
  PackageManager,
  ProjectLanguage,
  TestFramework,
} from "./types.js";

const DATABASE_PACKAGES: Readonly<Record<string, string>> = {
  "@neondatabase/serverless": "neon-postgres",
  "@prisma/client": "prisma",
  "better-sqlite3": "sqlite",
  "drizzle-orm": "drizzle",
  mongoose: "mongodb",
  mysql2: "mysql",
  pg: "postgresql",
  prisma: "prisma",
  sequelize: "sequelize",
  typeorm: "typeorm",
};

const SOURCE_DIRECTORY_CANDIDATES = ["src", "app", "pages", "server", "lib"];
const TEST_DIRECTORY_CANDIDATES = ["__tests__", "e2e", "test", "tests"];

async function detectPackageManager(
  workspace: ProjectWorkspace,
  manifest: Record<string, unknown>,
): Promise<PackageManager> {
  const lockfiles: readonly [string, PackageManager][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];

  for (const [lockfile, packageManager] of lockfiles) {
    if (await workspace.exists(lockfile)) {
      return packageManager;
    }
  }

  if (typeof manifest.packageManager === "string") {
    const declared = manifest.packageManager.split("@", 1)[0];
    if (declared === "bun" || declared === "npm" || declared === "pnpm" || declared === "yarn") {
      return declared;
    }
  }

  return (await workspace.exists("package.json")) ? "npm" : "unknown";
}

async function existingDirectories(
  workspace: ProjectWorkspace,
  candidates: readonly string[],
): Promise<string[]> {
  const matches: string[] = [];
  for (const candidate of candidates) {
    if (await workspace.exists(candidate)) {
      matches.push(candidate);
    }
  }
  return matches.sort((left, right) => left.localeCompare(right));
}

/** Detect supported stack markers using project files and declared dependencies only. */
export async function detectStack(root: string): Promise<DetectedStack> {
  const workspace = new ProjectWorkspace(root);
  const manifest = await readPackageManifest(workspace);
  const dependencies = dependencyMap(manifest);
  const files = await workspace.listFiles();
  const frameworks: Framework[] = [];
  const languages: ProjectLanguage[] = [];
  const testFrameworks: TestFramework[] = [];

  if ("next" in dependencies) {
    frameworks.push("nextjs");
  }
  if ("react" in dependencies) {
    frameworks.push("react");
  }

  const hasTypeScript =
    "typescript" in dependencies ||
    (await workspace.exists("tsconfig.json")) ||
    files.some((file) => /\.(?:ts|tsx)$/.test(file));
  const hasJavaScript = files.some((file) => /\.(?:js|jsx|mjs|cjs)$/.test(file));
  if (hasJavaScript) {
    languages.push("javascript");
  }
  if (hasTypeScript) {
    languages.push("typescript");
  }

  if ("@playwright/test" in dependencies || "playwright" in dependencies) {
    testFrameworks.push("playwright");
  }
  if ("jest" in dependencies || "@jest/core" in dependencies) {
    testFrameworks.push("jest");
  }
  if ("vitest" in dependencies) {
    testFrameworks.push("vitest");
  }

  const databaseLibraries = [
    ...new Set(
      Object.keys(dependencies)
        .map((name) => DATABASE_PACKAGES[name])
        .filter((name): name is string => name !== undefined),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const workflowFiles = files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));

  return {
    ci: {
      githubActions: workflowFiles.length > 0,
      workflowFiles,
    },
    databaseLibraries,
    frameworks,
    languages,
    packageManager: await detectPackageManager(workspace, manifest),
    sourceDirectories: await existingDirectories(workspace, SOURCE_DIRECTORY_CANDIDATES),
    testDirectories: await existingDirectories(workspace, TEST_DIRECTORY_CANDIDATES),
    testFrameworks,
  };
}
