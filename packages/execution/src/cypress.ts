import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AdapterExecutionResult, TestCaseResult } from "./types.js";

// Run the project's own Cypress in the existing command runner. Keeping this
// bootstrap inline also supports the single-file MaruCheck CLI bundle.
export const CYPRESS_RUNNER_SOURCE = String.raw`
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const input = JSON.parse(process.argv[1]);
async function main() {
  try {
    // Electron-based hosts can leak this flag; Cypress needs its browser process.
    delete process.env.ELECTRON_RUN_AS_NODE;
    const cypress = createRequire(resolve(input.project, 'package.json'))('cypress');
    const result = await cypress.run({
      project: input.project,
      spec: input.spec,
      testingType: 'e2e',
      record: false,
      quiet: true,
      config: {
        screenshotsFolder: resolve(input.outputDirectory, 'screenshots'),
        videosFolder: resolve(input.outputDirectory, 'videos'),
        downloadsFolder: resolve(input.outputDirectory, 'downloads'),
      },
    });
    writeFileSync(input.reportPath, JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.failures || result.totalFailed ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(input.reportPath, JSON.stringify({ failures: 1, message }, null, 2) + '\n');
    console.error(message);
    process.exitCode = 1;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
`;

type CypressOutcome = Pick<AdapterExecutionResult, "status" | "error" | "testResults">;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a Cypress result object.");
  }
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid Cypress result count or duration.");
  }
  return value;
}

function executionError(message: string): CypressOutcome {
  const unavailable =
    /no version of cypress is installed|cypress (?:executable|binary).*(?:missing|not found|does not exist)|could not find.*cypress executable/iu.test(
      message,
    );
  const configuration =
    /(?:config(?:uration|file| file)?|cypress\.config\.[a-z]+).*(?:invalid|error|threw|not found|could not|cannot|missing)|(?:could not|cannot|unable to).*(?:config(?:uration|file| file)?)/iu.test(
      message,
    );
  return {
    status: unavailable ? "unavailable" : "error",
    error: {
      code: unavailable
        ? "CYPRESS_BINARY_NOT_INSTALLED"
        : configuration
          ? "CYPRESS_CONFIG_INVALID"
          : "ADAPTER_EXECUTION_FAILED",
      message,
      remediation: unavailable
        ? "Install the project's Cypress binary and required browser dependencies, then retry."
        : configuration
          ? "Fix the project's Cypress configuration and confirm Cypress runs locally, then retry."
          : "Inspect the Cypress report and captured output, then fix the local execution error.",
    },
  };
}

/** Normalize the documented Cypress Module API result, never treating exit 1 alone as a test failure. */
export async function readCypressOutcome(
  root: string,
  reportPath: string,
  testFiles: readonly string[],
  diagnostics = "",
): Promise<CypressOutcome> {
  try {
    const report = record(JSON.parse(await readFile(reportPath, "utf8")));
    if (report.failures) {
      return executionError(
        [
          diagnostics.trim(),
          typeof report.message === "string" ? report.message : "Cypress could not execute tests.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    if (!Array.isArray(report.runs)) throw new Error("Missing Cypress spec results.");
    const totalTests = count(report.totalTests);
    const totalFailed = count(report.totalFailed);
    const totalPassed = count(report.totalPassed);
    const totalSkipped = count(report.totalSkipped) + count(report.totalPending);
    const testResults: TestCaseResult[] = [];
    const selectedFiles = new Set(testFiles.map((file) => resolve(root, file)));
    const executedFiles = new Set<string>();
    const specErrors: string[] = [];
    for (const value of report.runs) {
      const run = record(value);
      const spec = record(run.spec);
      if (typeof spec.relative !== "string") throw new Error("Missing Cypress spec path.");
      const absoluteFile = resolve(root, spec.relative);
      if (!selectedFiles.has(absoluteFile)) throw new Error("Cypress ran an unselected spec.");
      executedFiles.add(absoluteFile);
      const file = relative(resolve(root), absoluteFile).split(sep).join("/");
      if (run.error) {
        specErrors.push(String(run.error));
        continue;
      }
      if (!Array.isArray(run.tests)) throw new Error("Missing Cypress test results.");
      for (const value of run.tests) {
        const test = record(value);
        if (!Array.isArray(test.title) || !test.title.every((part) => typeof part === "string")) {
          throw new Error("Missing Cypress test title.");
        }
        if (!["passed", "failed", "pending", "skipped"].includes(String(test.state))) {
          throw new Error("Unknown Cypress test state.");
        }
        testResults.push({
          file,
          name: test.title.join(" > "),
          status: test.state === "pending" ? "skipped" : (test.state as TestCaseResult["status"]),
          durationMs: test.duration == null ? 0 : count(test.duration),
          ...(typeof test.displayError === "string" && test.displayError.length > 0
            ? { error: test.displayError }
            : {}),
        });
      }
    }
    if (specErrors.length > 0) return { ...executionError(specErrors.join("\n")), testResults };
    if (executedFiles.size !== selectedFiles.size)
      throw new Error("Cypress omitted selected specs.");
    if (
      testResults.length !== totalTests ||
      testResults.filter((test) => test.status === "failed").length !== totalFailed ||
      testResults.filter((test) => test.status === "passed").length !== totalPassed ||
      testResults.filter((test) => test.status === "skipped").length !== totalSkipped
    ) {
      throw new Error("Cypress test results disagree with the run totals.");
    }
    testResults.sort(
      (left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name),
    );
    if (totalFailed > 0) return { status: "failed", testResults };
    if (totalTests === 0 || totalSkipped > 0) {
      return {
        status: "skipped",
        testResults,
        error: {
          code: totalTests === 0 ? "NO_TESTS_EXECUTED" : "CYPRESS_TESTS_SKIPPED",
          message:
            totalTests === 0
              ? "Cypress executed no tests."
              : "Selected Cypress tests were skipped or pending.",
          remediation: "Add or enable the selected Cypress tests so verification can complete.",
        },
      };
    }
    return { status: "passed", testResults };
  } catch (error) {
    return {
      status: "error",
      error: {
        code: "CYPRESS_REPORT_INVALID",
        message: `Cypress did not produce a complete valid report: ${error instanceof Error ? error.message : String(error)}`,
        remediation: "Inspect the captured Cypress output and raw report, then retry.",
      },
    };
  }
}

/** Only accept literal project-relative specs; Cypress's spec option otherwise expands globs. */
export function validCypressSpecs(root: string, files: readonly string[]): boolean {
  return files.every((file) => {
    const path = relative(resolve(root), resolve(root, file));
    return (
      !isAbsolute(file) &&
      path !== "" &&
      path !== ".." &&
      !path.startsWith(`..${sep}`) &&
      !/[,*?{}[\]!()]/u.test(file)
    );
  });
}
