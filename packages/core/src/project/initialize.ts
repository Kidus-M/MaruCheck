import { basename } from "node:path";
import { detectStack } from "./stack-detector.js";
import type { DetectedStack, InitializationResult, TestFramework } from "./types.js";
import { ProjectWorkspace, readPackageManifest } from "./workspace.js";

const CONFIG_PATH = ".maru/maru.yml" as const;
const MARU_DIRECTORIES = [
  ".maru/artifacts",
  ".maru/contracts",
  ".maru/generated",
  ".maru/memory",
] as const;

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function selectedFramework(
  frameworks: readonly TestFramework[],
  choices: readonly TestFramework[],
): TestFramework | undefined {
  return choices.find((choice) => frameworks.includes(choice));
}

function createConfiguration(name: string, stack: DetectedStack): string {
  const unitFramework = selectedFramework(stack.testFrameworks, ["vitest", "jest"]);
  const e2eFramework = selectedFramework(stack.testFrameworks, ["playwright"]);
  const testLines = ["test:"];

  if (unitFramework === undefined && e2eFramework === undefined) {
    testLines.push("  detected: false");
  } else {
    if (unitFramework !== undefined) {
      testLines.push("  unit:", `    framework: ${unitFramework}`);
    }
    if (e2eFramework !== undefined) {
      testLines.push("  e2e:", `    framework: ${e2eFramework}`);
    }
  }

  return [
    "version: 1",
    "",
    "project:",
    `  name: ${yamlString(name)}`,
    "",
    "mode: shadow",
    "",
    ...testLines,
    "",
    "risk:",
    "  historical_memory: true",
    "",
    "llm:",
    "  provider: auto",
    "",
    "security:",
    "  redact_secrets: true",
    "",
    "contracts:",
    "  directory: .maru/contracts",
    "",
    "artifacts:",
    "  directory: .maru/artifacts",
    "",
  ].join("\n");
}

/** Create the local MaruCheck directory structure without overwriting existing configuration. */
export async function initializeProject(root: string): Promise<InitializationResult> {
  const workspace = new ProjectWorkspace(root);
  const manifest = await readPackageManifest(workspace);
  const stack = await detectStack(root);

  for (const directory of MARU_DIRECTORIES) {
    await workspace.createDirectory(directory);
  }

  if (!(await workspace.exists(".maru/.gitignore"))) {
    await workspace.writeText(".maru/.gitignore", "artifacts/\n");
  }

  const configExists = await workspace.exists(CONFIG_PATH);
  if (!configExists) {
    const projectName =
      typeof manifest.name === "string" ? manifest.name : basename(workspace.root);
    await workspace.writeText(CONFIG_PATH, createConfiguration(projectName, stack));
  }

  return {
    configPath: CONFIG_PATH,
    created: !configExists,
    directories: MARU_DIRECTORIES,
    stack,
  };
}
