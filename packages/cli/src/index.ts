#!/usr/bin/env node

import { runCli } from "./cli.js";

void runCli(process.argv.slice(2), console).then((exitCode) => {
  process.exitCode = exitCode;
});
