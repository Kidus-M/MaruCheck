import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { detectStack } from "./stack-detector.js";
import type { DoctorCheck, DoctorEnvironment, DoctorReport } from "./types.js";
import { ProjectWorkspace } from "./workspace.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function executableAvailable(executable: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];

  for (const directory of pathValue.split(delimiter).filter((entry) => entry.length > 0)) {
    for (const extension of extensions) {
      if (await fileExists(join(directory, `${executable}${extension.toLowerCase()}`))) {
        return true;
      }
      if (
        extension !== extension.toUpperCase() &&
        (await fileExists(join(directory, `${executable}${extension.toUpperCase()}`)))
      ) {
        return true;
      }
    }
  }
  return false;
}

export const defaultDoctorEnvironment: DoctorEnvironment = {
  executableAvailable,
  runtimeVersion: process.version,
};

function runtimeCheck(runtimeVersion: string): DoctorCheck {
  const major = Number.parseInt(runtimeVersion.replace(/^v/, "").split(".")[0] ?? "", 10);
  if (!Number.isInteger(major) || major < 24) {
    return {
      code: "runtime",
      details: `Node.js ${runtimeVersion} is unsupported; MaruCheck requires Node.js 24 or newer.`,
      remediation: "Install Node.js 24 LTS or newer.",
      status: "fail",
    };
  }
  return { code: "runtime", details: `Node.js ${runtimeVersion} is supported.`, status: "pass" };
}

/** Validate required and optional local prerequisites without executing project scripts. */
export async function diagnoseProject(
  root: string,
  environment: DoctorEnvironment = defaultDoctorEnvironment,
): Promise<DoctorReport> {
  const workspace = new ProjectWorkspace(root);
  const stack = await detectStack(root);
  const checks: DoctorCheck[] = [runtimeCheck(environment.runtimeVersion)];

  checks.push(
    (await environment.executableAvailable("git"))
      ? { code: "git", details: "Git is available.", status: "pass" }
      : {
          code: "git",
          details: "Git is not available on PATH.",
          remediation: "Install Git and ensure the git executable is on PATH.",
          status: "fail",
        },
  );

  checks.push(
    (await workspace.exists(".maru/maru.yml"))
      ? { code: "configuration", details: ".maru/maru.yml is present.", status: "pass" }
      : {
          code: "configuration",
          details: "MaruCheck configuration is missing.",
          remediation: "Run maru init in the project root.",
          status: "fail",
        },
  );

  if (stack.packageManager === "unknown") {
    checks.push({
      code: "package-manager",
      details: "No supported JavaScript package manager was detected.",
      remediation: "Add a supported lockfile or declare packageManager in package.json.",
      status: "warn",
    });
  } else {
    checks.push(
      (await environment.executableAvailable(stack.packageManager))
        ? {
            code: "package-manager",
            details: `${stack.packageManager} is available.`,
            status: "pass",
          }
        : {
            code: "package-manager",
            details: `${stack.packageManager} is detected but unavailable on PATH.`,
            remediation: `Install ${stack.packageManager} before running project tests.`,
            status: "fail",
          },
    );
  }

  checks.push(
    stack.testFrameworks.length > 0
      ? {
          code: "test-frameworks",
          details: `Detected: ${stack.testFrameworks.join(", ")}.`,
          status: "pass",
        }
      : {
          code: "test-frameworks",
          details: "No supported test framework was detected.",
          remediation: "Add Vitest, Jest, or Playwright when verification coverage is introduced.",
          status: "warn",
        },
  );

  checks.push(
    stack.ci.githubActions
      ? { code: "github-actions", details: "GitHub Actions workflows are present.", status: "pass" }
      : {
          code: "github-actions",
          details: "No GitHub Actions workflow was detected.",
          remediation: "Run maru ci init in a later phase if PR verification is required.",
          status: "warn",
        },
  );

  return {
    checks,
    ok: checks.every((check) => check.status !== "fail"),
  };
}
