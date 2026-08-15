import { MARU_PRODUCT } from "@maru/core";

export interface CliOutput {
  error(message: string): void;
  log(message: string): void;
}

const HELP = `${MARU_PRODUCT.name} — ${MARU_PRODUCT.positioning}

Usage: maru <command>

Commands:
  init       Initialize MaruCheck in a repository (Phase 1)
  scan       Scan repository architecture and tests (Phase 1)
  doctor     Diagnose local prerequisites (Phase 1)

Options:
  -h, --help       Show help
  -v, --version    Show version`;

export function runCli(args: readonly string[], output: CliOutput): number {
  const [command] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    output.log(HELP);
    return 0;
  }

  if (command === "--version" || command === "-v") {
    output.log("0.1.0");
    return 0;
  }

  output.error(`Unknown command: ${command}\nRun maru --help for usage.`);
  return 1;
}
