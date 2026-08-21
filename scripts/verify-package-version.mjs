import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const versionSource = await readFile(
  new URL("../packages/cli/src/version.ts", import.meta.url),
  "utf8",
);
const sourceVersion = versionSource.match(/CLI_VERSION\s*=\s*"([^"]+)"/u)?.[1];

if (sourceVersion !== packageMetadata.version) {
  console.error(
    `CLI version ${sourceVersion ?? "missing"} does not match package version ${packageMetadata.version}.`,
  );
  process.exit(1);
}

console.log(`CLI and package versions match: ${sourceVersion}.`);
