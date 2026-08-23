import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const errors = [];

if (packageMetadata.license !== "MIT") {
  errors.push('package.json license must be "MIT".');
}
if (!license.startsWith("MIT License\n")) {
  errors.push("LICENSE must contain the standard MIT License.");
}
if (!license.includes("Copyright (c) 2026 Kidus Mesfin Teferi")) {
  errors.push("LICENSE must identify Kidus Mesfin Teferi as the copyright holder.");
}
if (packageMetadata.repository?.url !== "git+https://github.com/Kidus-M/MaruCheck.git") {
  errors.push("package.json repository.url must match the trusted GitHub publisher repository.");
}
if (packageMetadata.private !== false) {
  errors.push("The public marucheck package must set private to false.");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`Release metadata error: ${error}`);
  process.exit(1);
}

console.log(`Release metadata is ready under license ${packageMetadata.license}.`);
