#!/usr/bin/env node
/**
 * Run the Jest example end to end.
 *
 *   node run.mjs                # full run (installs jest on first use)
 *   node run.mjs --dir <path>   # put the workspace somewhere else
 *   node run.mjs --clean        # delete the workspace and exit
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runExample } from "../shared/run-example.mjs";

process.exitCode = runExample({
  contractId: "usage-quota",
  example: dirname(fileURLToPath(import.meta.url)),
  fixtureEntries: ["src", "tests", "contracts", "package.json", "observations.json"],
  runnerPackage: "jest",
});
