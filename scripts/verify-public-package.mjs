import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const packageMetadata = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "marucheck-package-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed.\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout.trim();
}

try {
  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", temporaryRoot]),
  );
  if (!Array.isArray(packed) || packed.length !== 1) {
    throw new Error("npm pack did not produce exactly one MaruCheck archive.");
  }

  const manifest = packed[0];
  const packedPaths = new Set(manifest.files.map((file) => file.path));
  for (const requiredPath of ["dist/maru.js", "package.json", "README.md"]) {
    if (!packedPaths.has(requiredPath)) {
      throw new Error(`Published package is missing ${requiredPath}.`);
    }
  }

  const installRoot = join(temporaryRoot, "consumer");
  await mkdir(installRoot);
  const archivePath = join(temporaryRoot, manifest.filename);
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archivePath],
    { cwd: installRoot },
  );

  const installedExecutable = join(installRoot, "node_modules", "marucheck", "dist", "maru.js");
  const installedVersion = run(process.execPath, [installedExecutable, "--version"], {
    cwd: installRoot,
    shell: false,
  });
  if (installedVersion !== packageMetadata.version) {
    throw new Error(
      `Installed CLI reported ${installedVersion}; expected ${packageMetadata.version}.`,
    );
  }

  console.log(
    `Verified ${manifest.filename}: ${manifest.size} bytes packed, ${manifest.unpackedSize} bytes unpacked.`,
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
