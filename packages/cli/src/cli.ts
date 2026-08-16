import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  ContractError,
  approveContract,
  createContractFromRequirements,
  diffContracts,
  getContract,
  listContracts,
  serializeQualityContract,
  validateContracts,
} from "@maru/contracts";
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
  contract   Create, validate, inspect, diff, and approve Quality Contracts

Contract commands:
  maru contract create [--from requirements.md] [--id contract-id] [--title "Title"]
  maru contract validate [path]
  maru contract list
  maru contract show <id>
  maru contract diff <id-or-path> <id-or-path>
  maru contract approve <id> --by <owner>

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

function reportContractError(error: ContractError, output: CliOutput): void {
  const issueLines = error.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
  output.error(
    `${error.code}\n${error.message}${issueLines.length === 0 ? "" : `\n${issueLines}`}\nFix: ${error.remediation}`,
  );
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ContractError(
      "CONTRACT_INVALID",
      `Missing value for ${name}.`,
      `Pass a value after ${name}.`,
    );
  }
  return value;
}

function resolveInsideRoot(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new ContractError(
      "CONTRACT_ID_INVALID",
      `Path escapes the project root: ${path}`,
      "Use a requirements file inside the project root.",
    );
  }
  return target;
}

async function runContractCommand(
  args: readonly string[],
  root: string,
  output: CliOutput,
  now: Date,
): Promise<number> {
  const [action, ...actionArgs] = args;
  if (action === "create") {
    const sourcePath = option(actionArgs, "--from");
    const requirements =
      sourcePath === undefined
        ? "The feature must satisfy its approved requirements and preserve expected behavior."
        : await readFile(resolveInsideRoot(root, sourcePath), "utf8");
    const result = await createContractFromRequirements(root, requirements, {
      id: option(actionArgs, "--id"),
      now,
      title: option(actionArgs, "--title"),
    });
    output.log(
      `Draft contract created: ${result.path}\nVersion: ${result.versionHash}\nReview the draft before approval.`,
    );
    return 0;
  }

  if (action === "list") {
    const contracts = await listContracts(root);
    output.log(
      contracts.length === 0
        ? "No Quality Contracts found."
        : contracts
            .map(
              (contract) =>
                `${contract.id}\t${contract.status}\t${contract.criticality}\t${contract.versionHash.slice(0, 12)}`,
            )
            .join("\n"),
    );
    return 0;
  }

  if (action === "show") {
    const id = actionArgs[0];
    if (id === undefined) {
      throw new ContractError(
        "CONTRACT_INVALID",
        "A contract identifier is required.",
        "Run maru contract show <id>.",
      );
    }
    output.log(serializeQualityContract(await getContract(root, id)).trimEnd());
    return 0;
  }

  if (action === "validate") {
    const report = await validateContracts(root, actionArgs[0]);
    for (const invalid of report.invalid) {
      output.error(
        `${invalid.path}\n${invalid.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`,
      );
    }
    output.log(
      `Contracts valid: ${report.valid.length}\nContracts invalid: ${report.invalid.length}`,
    );
    return report.invalid.length === 0 ? 0 : 1;
  }

  if (action === "diff") {
    const [left, right] = actionArgs;
    if (left === undefined || right === undefined) {
      throw new ContractError(
        "CONTRACT_INVALID",
        "Two contract identifiers or paths are required.",
        "Run maru contract diff <id-or-path> <id-or-path>.",
      );
    }
    const result = await diffContracts(root, left, right);
    output.log(
      [
        `Contract diff: ${result.classification}`,
        ...result.changes.map(
          (item) => `${item.semantic ? "SEMANTIC" : "MECHANICAL"} ${item.kind} ${item.path}`,
        ),
      ].join("\n"),
    );
    return 0;
  }

  if (action === "approve") {
    const id = actionArgs[0];
    const approvedBy = option(actionArgs, "--by");
    if (id === undefined || approvedBy === undefined) {
      throw new ContractError(
        "CONTRACT_INVALID",
        "A contract identifier and approver are required.",
        "Run maru contract approve <id> --by <owner>.",
      );
    }
    const result = await approveContract(root, id, { approvedAt: now, approvedBy });
    output.log(
      `Contract approved: ${result.contract.id}\nVersion: ${result.versionHash}\nSnapshot: .maru/contracts/.history/${result.contract.id}/${result.versionHash}.yml`,
    );
    return 0;
  }

  throw new ContractError(
    "CONTRACT_INVALID",
    `Unknown contract command: ${action ?? "(missing)"}`,
    "Run maru --help for contract command usage.",
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

    if (command === "contract") {
      return await runContractCommand(
        args.slice(1),
        root,
        output,
        dependencies.now?.() ?? new Date(),
      );
    }
  } catch (error) {
    if (error instanceof ContractError) {
      reportContractError(error, output);
      return 1;
    }
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
