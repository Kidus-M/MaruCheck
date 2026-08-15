import { basename, extname } from "node:path";
import { ProjectError } from "./errors.js";
import { detectStack } from "./stack-detector.js";
import type { ProjectRoute, ProjectScan, ProjectTestFile, TestFramework } from "./types.js";
import { dependencyNames, ProjectWorkspace, readPackageManifest } from "./workspace.js";

const SOURCE_FILE_PATTERN = /\.(?:cjs|css|js|jsx|json|mjs|scss|ts|tsx)$/;
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__|e2e|test|tests)(?:\/|$)|\.(?:spec|test)\.[^.]+$/;
const ROUTE_METHOD_PATTERN =
  /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

function routePath(segments: readonly string[]): string {
  const visibleSegments = segments.filter(
    (segment) =>
      segment.length > 0 &&
      !segment.startsWith("@") &&
      !(segment.startsWith("(") && segment.endsWith(")")),
  );
  return visibleSegments.length === 0 ? "/" : `/${visibleSegments.join("/")}`;
}

function appRouteFromFile(file: string): Omit<ProjectRoute, "methods"> | undefined {
  const match = /(?:^|\/)app\/(.*)\/(page|route)\.(?:js|jsx|ts|tsx)$/.exec(file);
  if (match === null) {
    const rootMatch = /(?:^|\/)app\/(page|route)\.(?:js|jsx|ts|tsx)$/.exec(file);
    if (rootMatch === null) {
      return undefined;
    }
    return { kind: rootMatch[1] === "route" ? "api" : "page", path: "/", source: file };
  }

  return {
    kind: match[2] === "route" ? "api" : "page",
    path: routePath(match[1]?.split("/") ?? []),
    source: file,
  };
}

function pagesRouteFromFile(file: string): Omit<ProjectRoute, "methods"> | undefined {
  const match = /(?:^|\/)pages\/(.*)\.(?:js|jsx|ts|tsx)$/.exec(file);
  if (match === null) {
    return undefined;
  }

  const segments = match[1]?.split("/") ?? [];
  const filename = segments.at(-1);
  if (filename === undefined || filename.startsWith("_")) {
    return undefined;
  }
  if (filename === "index") {
    segments.pop();
  }

  return {
    kind: segments[0] === "api" ? "api" : "page",
    path: routePath(segments),
    source: file,
  };
}

async function detectRoutes(
  workspace: ProjectWorkspace,
  files: readonly string[],
): Promise<ProjectRoute[]> {
  const routes: ProjectRoute[] = [];

  for (const file of files) {
    const detected = appRouteFromFile(file) ?? pagesRouteFromFile(file);
    if (detected === undefined) {
      continue;
    }

    if (detected.kind === "api") {
      const source = await workspace.readText(file);
      const methods = [...source.matchAll(ROUTE_METHOD_PATTERN)]
        .map((match) => match[1])
        .filter((method): method is string => method !== undefined)
        .sort((left, right) => left.localeCompare(right));
      routes.push(methods.length > 0 ? { ...detected, methods } : detected);
    } else {
      routes.push(detected);
    }
  }

  return routes;
}

function testFrameworkForFile(
  file: string,
  detectedFrameworks: readonly TestFramework[],
): ProjectTestFile["framework"] {
  if (/(?:^|\/)e2e\//.test(file) && detectedFrameworks.includes("playwright")) {
    return "playwright";
  }
  if (detectedFrameworks.includes("vitest")) {
    return "vitest";
  }
  if (detectedFrameworks.includes("jest")) {
    return "jest";
  }
  if (detectedFrameworks.includes("playwright")) {
    return "playwright";
  }
  return "unknown";
}

function countExtensions(files: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    counts[extension] = (counts[extension] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Build an in-memory inventory of a previously initialized JavaScript/TypeScript project. */
export async function scanProject(root: string, now = new Date()): Promise<ProjectScan> {
  const workspace = new ProjectWorkspace(root);
  if (!(await workspace.exists(".maru/maru.yml"))) {
    throw new ProjectError(
      "MARU_NOT_INITIALIZED",
      "scan project",
      "MaruCheck is not initialized in this project.",
      "Run maru init in the project root, then run maru scan again.",
    );
  }

  const manifest = await readPackageManifest(workspace);
  const stack = await detectStack(root);
  const files = await workspace.listFiles();
  const sourceFiles = files.filter(
    (file) =>
      stack.sourceDirectories.some(
        (directory) => file === directory || file.startsWith(`${directory}/`),
      ) && SOURCE_FILE_PATTERN.test(file),
  );
  const testFiles = files
    .filter((file) => TEST_FILE_PATTERN.test(file))
    .map((file) => ({ framework: testFrameworkForFile(file, stack.testFrameworks), path: file }));
  const projectName = typeof manifest.name === "string" ? manifest.name : basename(workspace.root);

  return {
    ci: stack.ci,
    dependencies: {
      development: dependencyNames(manifest, "devDependencies"),
      production: dependencyNames(manifest, "dependencies"),
    },
    generatedAt: now.toISOString(),
    project: {
      databaseLibraries: stack.databaseLibraries,
      frameworks: stack.frameworks,
      languages: stack.languages,
      name: projectName,
      packageManager: stack.packageManager,
      root: ".",
    },
    routes: await detectRoutes(workspace, files),
    schemaVersion: 1,
    source: {
      directories: stack.sourceDirectories,
      fileCount: sourceFiles.length,
      files: sourceFiles,
      filesByExtension: countExtensions(sourceFiles),
    },
    tests: {
      directories: stack.testDirectories,
      files: testFiles,
      frameworks: stack.testFrameworks,
    },
  };
}

/** Persist a project inventory at the stable Phase 1 generated path. */
export async function writeProjectScan(root: string, scan: ProjectScan): Promise<string> {
  const workspace = new ProjectWorkspace(root);
  const outputPath = ".maru/generated/project-scan.json";
  await workspace.writeText(outputPath, `${JSON.stringify(scan, null, 2)}\n`);
  return outputPath;
}
