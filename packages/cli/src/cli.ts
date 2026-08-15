import {
  defaultDoctorEnvironment,
  diagnoseProject,
  initializeProject,
  MARU_PRODUCT,
  ProjectError,
  scanProject,
  writeProjectScan,
  type DoctorEnvironment,
} from "@maru/core";

export interface CliOutput {
  error(message: string): void;
  log(message: string): void;
}

export interface CliDependencies {
  readonly cwd?: string;
  readonly doctorEnvironment?: DoctorEnvironment;
  readonly now?: () => Date;
}

const HELP = `${MARU_PRODUCT.name} — ${MARU_PRODUCT.positioning}

Usage: maru <command>

Commands:
  init       Initialize MaruCheck in the current repository
  scan       Inventory project architecture, routes, tests, and dependencies
  doctor     Diagnose local prerequisites and configuration

Options:
  -h, --help       Show help
  -v, --version    Show version`;

function stackSummary(result: Awaited<ReturnType<typeof initializeProject>>): string {
  const detected = [
    result.stack.packageManager,
    ...result.stack.frameworks,
    ...result.stack.languages,
    ...result.stack.testFrameworks,
  ].filter((value) => value !== "unknown");
  return detected.length > 0 ? detected.join(", ") : "no supported stack markers";
}

function reportProjectError(error: ProjectError, output: CliOutput): void {
  output.error(
    `${error.code}\nOperation: ${error.operation}\n${error.message}\nFix: ${error.remediation}`,
  );
}

/**
 * Execute a MaruCheck CLI command against a project directory.
 *
 * Returns a process-compatible exit code and reports only safe, actionable error details.
 */
export async function runCli(
  args: readonly string[],
  output: CliOutput,
  dependencies: CliDependencies = {},
): Promise<number> {
  const [command] = args;
  const root = dependencies.cwd ?? process.cwd();

  if (command === undefined || command === "--help" || command === "-h") {
    output.log(HELP);
    return Promise.resolve(0);
  }

  if (command === "--version" || command === "-v") {
    output.log("0.1.0");
    return Promise.resolve(0);
  }

  try {
    if (command === "init") {
      const result = await initializeProject(root);
      output.log(
        result.created
          ? `MaruCheck initialized.\nConfig: ${result.configPath}\nDetected: ${stackSummary(result)}\nNext: maru scan`
          : `MaruCheck is already initialized.\nConfig preserved: ${result.configPath}\nDetected: ${stackSummary(result)}`,
      );
      return 0;
    }

    if (command === "scan") {
      const scan = await scanProject(root, dependencies.now?.() ?? new Date());
      const outputPath = await writeProjectScan(root, scan);
      output.log(
        `Project scan written: ${outputPath}\nRoutes: ${scan.routes.length}\nTests: ${scan.tests.files.length}\nSource files: ${scan.source.fileCount}`,
      );
      return 0;
    }

    if (command === "doctor") {
      const report = await diagnoseProject(
        root,
        dependencies.doctorEnvironment ?? defaultDoctorEnvironment,
      );
      for (const check of report.checks) {
        const remediation = check.remediation === undefined ? "" : ` Fix: ${check.remediation}`;
        output.log(`${check.status.toUpperCase()} ${check.code}: ${check.details}${remediation}`);
      }
      output.log(
        report.ok
          ? "Doctor: all required checks passed."
          : "Doctor: one or more required checks failed.",
      );
      return report.ok ? 0 : 1;
    }
  } catch (error) {
    if (error instanceof ProjectError) {
      reportProjectError(error, output);
      return 1;
    }

    output.error(
      "UNEXPECTED_ERROR\nOperation: run CLI command\nThe command failed unexpectedly.\nFix: Run maru doctor, then retry with a readable project directory.",
    );
    return 1;
  }

  output.error(`Unknown command: ${command}\nRun maru --help for usage.`);
  return 1;
}
