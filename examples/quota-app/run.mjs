#!/usr/bin/env node
/**
 * Build the example workspace and run it end to end.
 *
 * The fixture lives in this directory, but MaruCheck reads a Git working tree, so
 * the runner copies the fixture into a throwaway workspace, commits the approved
 * baseline there, applies the agent's change on top, and verifies the result.
 *
 *   node run.mjs                # full run (installs vitest on first use)
 *   node run.mjs --dir <path>   # put the workspace somewhere else
 *   node run.mjs --clean        # delete the workspace and exit
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ENTRIES = [
  "src",
  "tests",
  "contracts",
  "package.json",
  "observations.json",
  "vitest.config.mjs",
];

const example = dirname(fileURLToPath(import.meta.url));
const cliRepository = resolve(example, "..", "..");
const bundledCli = join(cliRepository, "dist", "maru.cjs");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1];
};

const workspace = resolve(example, option("--dir", ".workspace"));
const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";
const maru = existsSync(bundledCli)
  ? { args: [bundledCli], command: process.execPath }
  : { args: ["--yes", "marucheck@0.3.0"], command: windows ? "npx.cmd" : "npx" };

if (flag("--clean")) {
  rmSync(workspace, { force: true, maxRetries: 10, recursive: true, retryDelay: 200 });
  console.log(`Removed ${workspace}`);
  process.exit(0);
}

let step = 0;
function heading(text) {
  step += 1;
  process.stdout.write(`\n\u001B[1m${step}. ${text}\u001B[0m\n`);
}

function run(command, args, { allowFailure = false, shell = false } = {}) {
  const result = spawnSync(command, args, { cwd: workspace, encoding: "utf8", shell });
  if (result.error) throw result.error;
  process.stdout.write(`${result.stdout ?? ""}`);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${String(result.status)}.`);
  }
  return result;
}

const runNpm = (args, options) => run(npm, args, { ...options, shell: windows });
const runMaru = (args, options) =>
  run(maru.command, [...maru.args, ...args], {
    ...options,
    shell: windows && maru.command !== process.execPath,
  });

heading("Create the example workspace");
mkdirSync(workspace, { recursive: true });
for (const entry of FIXTURE_ENTRIES) {
  rmSync(join(workspace, entry), { force: true, recursive: true });
  cpSync(join(example, entry), join(workspace, entry), { recursive: true });
}
writeFileSync(join(workspace, ".gitignore"), "node_modules/\n", "utf8");
console.log(workspace);

heading("Commit the approved baseline");
if (!existsSync(join(workspace, ".git"))) {
  run("git", ["init", "--quiet", "--initial-branch=main"]);
  run("git", ["config", "user.email", "example@marucheck.dev"]);
  run("git", ["config", "user.name", "MaruCheck Example"]);
  run("git", ["config", "core.autocrlf", "false"]);
}
run("git", ["add", "--all"]);
run("git", ["commit", "--quiet", "--message", "Add the metered generation endpoint"], {
  allowFailure: true,
});
console.log("Committed the behavior the contract describes.");

if (!existsSync(join(workspace, "node_modules", "vitest"))) {
  heading("Install the example's test runner");
  runNpm(["install", "--no-audit", "--no-fund", "--loglevel=error"]);
}

heading("Initialize MaruCheck and approve the Quality Contract");
runMaru(["init"]);
const contractPath = join(workspace, ".maru", "contracts", "usage-quota.yml");
if (!existsSync(contractPath)) {
  cpSync(join(example, "contracts", "usage-quota.yml"), contractPath);
}
runMaru(["contract", "validate"]);
if (readFileSync(contractPath, "utf8").includes("status: approved")) {
  console.log("Contract usage-quota is already approved in this workspace.");
} else {
  runMaru(["contract", "approve", "usage-quota", "--by", "product-owner@example.com"]);
}
run("git", ["add", "--all"]);
run("git", ["commit", "--quiet", "--message", "Approve the usage-quota contract"], {
  allowFailure: true,
});

heading("Apply the change an AI agent proposed");
cpSync(join(example, "agent-change", "src"), join(workspace, "src"), { recursive: true });
run("git", ["--no-pager", "diff", "--stat"]);

heading("Run the test suite the agent maintains");
const agentSuite = runNpm(["test", "--silent"], { allowFailure: true });
console.log(
  agentSuite.status === 0
    ? "\u001B[32mGreen. Every test the agent owns passes.\u001B[0m"
    : "\u001B[33mThe agent's own suite failed, which is not what this example demonstrates.\u001B[0m",
);

heading("Score the change");
runMaru(["risk", "--diff"], { allowFailure: true });

heading("Verify the change against the approved contract");
const verification = runMaru(["verify", "--diff"], { allowFailure: true });

heading("Compare observed behavior with protected contract meaning");
const drift = runMaru(["drift", "check", "--from", "observations.json"], { allowFailure: true });

const blocked = agentSuite.status === 0 && verification.status !== 0 && drift.status !== 0;
process.stdout.write(
  blocked
    ? "\n\u001B[31mBLOCKED\u001B[0m by the approved contract while the agent's own suite stayed green.\n"
    : `\n\u001B[33mUnexpected result:\u001B[0m tests exited ${String(agentSuite.status)}, verify exited ${String(verification.status)}, drift exited ${String(drift.status)}.\n`,
);
console.log(`Evidence: ${join(workspace, ".maru")}`);
console.log("Remove the workspace with: node run.mjs --clean");
process.exitCode = blocked ? 0 : 1;
