import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const errors = [];

if (packageMetadata.license !== "SEE LICENSE IN LICENSE") {
  errors.push('package.json license must be "SEE LICENSE IN LICENSE".');
}
if (!license.includes("MaruCheck Proprietary License")) {
  errors.push("LICENSE must contain the MaruCheck Proprietary License.");
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
