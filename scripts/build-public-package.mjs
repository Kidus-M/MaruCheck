import { chmod, readFile } from "node:fs/promises";
import { build } from "esbuild";

const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));

await build({
  banner: {
    js: `// MaruCheck ${packageMetadata.version} — https://github.com/Kidus-M/MaruCheck`,
  },
  bundle: true,
  entryPoints: ["packages/cli/src/index.ts"],
  format: "esm",
  legalComments: "eof",
  logLevel: "info",
  outfile: "dist/maru.js",
  packages: "bundle",
  platform: "node",
  sourcemap: false,
  target: "node24",
});

await chmod("dist/maru.js", 0o755);
