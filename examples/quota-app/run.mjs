#!/usr/bin/env node
/**
 * Build the example workspace and run it end to end.
 *
 * The fixture lives in this directory, but MaruCheck reads a Git working tree, so
 * the runner copies the fixture into a throwaway workspace, commits the approved
 * baseline there, applies the agent's change on top, and then verifies it.
 *
 *   node run.mjs                 # full run, installs vitest in the workspace
 *   node run.mjs --skip-install  # reuse an existing workspace install
 *   node run.mjs --dir <path>    # choose the workspace location
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const example = dirname(fileURLToPath(import.meta.url));
const cliRepository = resolve(example, "..", "..");
const bundledCli = join(cliRepository, "dist", "maru.cjs");

const argv = process.argv.slice(2);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1];
};

const workspace = resolve(example, value("--dir", ".workspace"));
const skipInstall = flag("--skip-install");
const keep = flag("--keep");

const maru = existsSync(bundledCli)
  ? { command: process.execPath, args: [bundledCli] }
  : {
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["--yes", "marucheck@0.3.0"],
    };

let step = 0;
function heading(text) {
  step += 1;
  process.stdout.write(`\n\u001B[1m${step}. ${text}\u001B[0m\n`);
}

function run(command, args, { allowFailure = false, quiet = false, shell = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: "utf8",
    shell,
    stdio: quiet ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    if (quiet) process.stdout.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}.`);
  }
  return result;
}

const windows = process.platform === "win32";
const runNpm = (args, options) => run(npm, args, { ...options, shell: windows });
const runMaru = (args, options) =>
  run(maru.command, [...maru.args, ...args], {
    ...options,
    shell: windows && maru.command !== process.execPath,
  });

heading("Create a throwaway workspace");
if (!skipInstall || !existsSync(workspace)) rmSync(workspace, { force: true, recursive: true });
mkdirSync(workspace, { recursive: true });
for (const entry of ["src", "tests", "contracts", "package.json", "observations.json"]) {
  cpSync(join(example, entry), join(workspace, entry), { force: true, recursive: true });
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

if (!skipInstall) {
  heading("Install the example's test runner");
  runNpm(["install", "--no-audit", "--no-fund", "--loglevel=error"]);
}

heading("Initialize MaruCheck and approve the Quality Contract");
runMaru(["init"]);
cpSync(join(example, "contracts", "usage-quota.yml"), join(workspace, ".maru", "contracts", "usage-quota.yml"));
runMaru(["contract", "validate"]);
runMaru(["contract", "approve", "usage-quota", "--by", "product-owner@example.com"]);
run("git", ["add", "--all"]);
run("git", ["commit", "--quiet", "--message", "Approve the usage-quota contract"], {
  allowFailure: true,
});

heading("Apply the change an AI agent proposed");
cpSync(join(example, "agent-change", "src"), join(workspace, "src"), {
  force: true,
  recursive: true,
});
run("git", ["--no-pager", "diff", "--stat"]);

heading("Run the suite the agent maintains");
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

heading("Check observed behavior against protected contract meaning");
const drift = runMaru(["drift", "check", "--from", "observations.json"], { allowFailure: true });

const blocked = verification.status !== 0 && drift.status !== 0;
process.stdout.write(
  blocked
    ? "\n\u001B[31mBLOCKED\u001B[0m by the approved contract while the agent's suite is green.\n"
    : `\n\u001B[33mUnexpected result:\u001B[0m verify exited ${verification.status}, drift exited ${drift.status}.\n`,
);
console.log(`Evidence: ${join(workspace, ".maru")}`);
if (!keep) console.log("Delete the workspace with: node run.mjs --clean");
if (flag("--clean")) rmSync(workspace, { force: true, recursive: true });
process.exitCode = blocked ? 0 : 1;
