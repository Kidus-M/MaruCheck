import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const errors = [];

if (!packageMetadata.license || packageMetadata.license === "UNLICENSED") {
  errors.push("Choose an explicit repository license before publishing MaruCheck.");
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
