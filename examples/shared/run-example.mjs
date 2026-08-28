/**
 * Shared driver for the runnable MaruCheck examples.
 *
 * Every example tells the same story with a different test runner: an approved
 * Quality Contract, an AI change that keeps the agent's own suite green, and a
 * verification run that blocks it anyway. MaruCheck reads a Git working tree, so
 * the driver copies the fixture into a throwaway workspace, commits the approved
 * baseline there, applies the agent's change on top, and verifies the result.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const windows = process.platform === "win32";

function cliVersion(cliRepository) {
  try {
    return JSON.parse(readFileSync(join(cliRepository, "package.json"), "utf8")).version;
  } catch {
    return "latest";
  }
}

export function runExample(options) {
  const {
    contractId,
    example,
    fixtureEntries,
    runnerPackage,
    baselineMessage = "Add the metered generation endpoint",
  } = options;

  const cliRepository = resolve(example, "..", "..");
  const bundledCli = join(cliRepository, "dist", "maru.cjs");

  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(name);
  const option = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1];
  };

  const workspace = resolve(example, option("--dir", ".workspace"));
  const npm = windows ? "npm.cmd" : "npm";
  const maru = existsSync(bundledCli)
    ? { args: [bundledCli], command: process.execPath }
    : {
        args: ["--yes", `marucheck@${cliVersion(cliRepository)}`],
        command: windows ? "npx.cmd" : "npx",
      };

  if (flag("--clean")) {
    rmSync(workspace, { force: true, maxRetries: 10, recursive: true, retryDelay: 200 });
    console.log(`Removed ${workspace}`);
    return 0;
  }

  let step = 0;
  function heading(text) {
    step += 1;
    process.stdout.write(`\n\u001B[1m${step}. ${text}\u001B[0m\n`);
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

  const runNpm = (args, opts) => run(npm, args, { ...opts, shell: windows });
  const runMaru = (args, opts) =>
    run(maru.command, [...maru.args, ...args], {
      ...opts,
      shell: windows && maru.command !== process.execPath,
    });

  heading("Create the example workspace");
  mkdirSync(workspace, { recursive: true });
  for (const entry of fixtureEntries) {
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
  run("git", ["commit", "--quiet", "--message", baselineMessage], { allowFailure: true });
  console.log("Committed the behavior the contract describes.");

  if (!existsSync(join(workspace, "node_modules", runnerPackage))) {
    heading(`Install the example test runner (${runnerPackage})`);
    runNpm(["install", "--no-audit", "--no-fund", "--loglevel=error"]);
  }

  heading("Initialize MaruCheck and approve the Quality Contract");
  runMaru(["init"]);
  const contractPath = join(workspace, ".maru", "contracts", `${contractId}.yml`);
  if (!existsSync(contractPath)) {
    cpSync(join(example, "contracts", `${contractId}.yml`), contractPath);
  }
  runMaru(["contract", "validate"]);
  if (readFileSync(contractPath, "utf8").includes("status: approved")) {
    console.log(`Contract ${contractId} is already approved in this workspace.`);
  } else {
    runMaru(["contract", "approve", contractId, "--by", "product-owner@example.com"]);
  }
  run("git", ["add", "--all"]);
  run("git", ["commit", "--quiet", "--message", `Approve the ${contractId} contract`], {
    allowFailure: true,
  });

  heading("Apply the change an AI agent proposed");
  cpSync(join(example, "agent-change", "src"), join(workspace, "src"), { recursive: true });
  run("git", ["--no-pager", "diff", "--stat"]);

  heading("Run the test suite the agent maintains");
  const agentSuite = runNpm(["test", "--silent"], { allowFailure: true });
  console.log(
    agentSuite.status === 0
      ? "\u001B[32mGreen. Every test the agent owns passes.\u001B[0m"
      : "\u001B[33mThe agent's own suite failed, which is not what this example demonstrates.\u001B[0m",
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
      ? "\n\u001B[31mBLOCKED\u001B[0m by the approved contract while the agent's own suite stayed green.\n"
      : `\n\u001B[33mUnexpected result:\u001B[0m tests exited ${String(agentSuite.status)}, verify exited ${String(verification.status)}, drift exited ${String(drift.status)}.\n`,
  );
  console.log(`Evidence: ${join(workspace, ".maru")}`);
  console.log("Remove the workspace with: node run.mjs --clean");
  return blocked ? 0 : 1;
}
