/**
 * The trust anchor for verification.
 *
 * A contract only protects a project if the agents under verification cannot rewrite
 * it. A contract, its tests, and the settings that run them all live in the repository
 * those agents can write to, so a human signs a manifest of their hashes with a key
 * the agents cannot reach. Verification takes the public key from the trusted base
 * commit, never from the change being verified, so replacing the key and the manifest
 * together achieves nothing.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { defaultGitRunner, resolveMergeBase, type GitRunner } from "@maru/git";

export const SEAL_MANIFEST_PATH = ".maru/seal.json";
export const SEAL_PUBLIC_KEY_PATH = ".maru/seal.pub";
const SEAL_VERSION = 1;

/** Root-level files that decide which tests run and how. */
const RUNNER_CONFIG = /^(?:vitest|vite|jest)\.(?:config|workspace|setup)\.[cm]?[jt]s$/u;
const CONTRACT_TEST = /\.contract\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const SKIPPED_DIRECTORIES = new Set([".git", ".maru", "coverage", "dist", "node_modules"]);
/** The parts of package.json that can change what a test run means. */
const RUNNER_PACKAGE_FIELDS = ["jest", "scripts", "vitest"] as const;
const PACKAGE_ENTRY = "package.json#test-settings";

export interface SealManifest {
  readonly createdAt: string;
  readonly files: Readonly<Record<string, string>>;
  /** Grows with every seal, so an older valid seal cannot be replayed. */
  readonly sequence: number;
  readonly signature: string;
  readonly signer: string;
  readonly version: typeof SEAL_VERSION;
}

export type SealErrorCode =
  "SEAL_KEY_INSIDE_PROJECT" | "SEAL_KEY_UNREADABLE" | "SEAL_SIGNER_REQUIRED";

export class SealError extends Error {
  public constructor(
    public readonly code: SealErrorCode,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SealError";
  }
}

/** Verification refused to run because the protected files do not match the seal. */
export class SealBrokenError extends Error {
  public readonly code = "SEAL_BROKEN";
  public readonly remediation =
    "Restore the protected files, or have the key holder review the change and run maru seal create.";

  public constructor(public readonly issues: readonly string[]) {
    super(`Verification did not run. The seal is broken:\n${issues.join("\n")}`);
    this.name = "SealBrokenError";
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Line endings differ across checkouts without changing what a file means. */
function normalized(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function findContractTests(root: string, directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name))
        found.push(...(await findContractTests(root, path)));
    } else if (entry.isFile() && CONTRACT_TEST.test(entry.name)) {
      found.push(relative(root, path).split(sep).join("/"));
    }
  }
  return found;
}

/** Hash every file an agent could change to alter what verification concludes. */
export async function collectProtectedFiles(root: string): Promise<Record<string, string>> {
  const absolute = resolve(root);
  const contractDirectory = join(absolute, ".maru", "contracts");
  const contracts = (await readdir(contractDirectory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => `.maru/contracts/${entry.name}`);
  const runnerConfig = (await readdir(absolute, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && RUNNER_CONFIG.test(entry.name))
    .map((entry) => entry.name);
  const paths = [
    ".maru/maru.yml",
    ...contracts,
    ...runnerConfig,
    ...(await findContractTests(absolute, absolute)),
  ].sort();

  const files: Record<string, string> = {};
  for (const path of paths) {
    const content = await readOptional(join(absolute, ...path.split("/")));
    if (content !== undefined) files[path] = sha256(normalized(content));
  }

  const manifest = await readOptional(join(absolute, "package.json"));
  if (manifest !== undefined) {
    let settings: Record<string, unknown> = { unparsable: sha256(normalized(manifest)) };
    try {
      const parsed = JSON.parse(manifest) as Record<string, unknown>;
      settings = Object.fromEntries(RUNNER_PACKAGE_FIELDS.map((key) => [key, parsed[key] ?? null]));
    } catch {
      // A package.json that cannot be parsed is hashed whole, so any edit still shows.
    }
    files[PACKAGE_ENTRY] = sha256(JSON.stringify(settings));
  }
  return files;
}

function signedPayload(manifest: Omit<SealManifest, "signature">): Buffer {
  const files = Object.fromEntries(
    Object.entries(manifest.files).sort(([left], [right]) => left.localeCompare(right)),
  );
  return Buffer.from(
    JSON.stringify({
      createdAt: manifest.createdAt,
      files,
      sequence: manifest.sequence,
      signer: manifest.signer,
      version: manifest.version,
    }),
    "utf8",
  );
}

function parseManifest(raw: string | undefined): SealManifest | undefined {
  if (raw === undefined) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<SealManifest>;
    return value.version === SEAL_VERSION &&
      typeof value.createdAt === "string" &&
      typeof value.sequence === "number" &&
      typeof value.signature === "string" &&
      typeof value.signer === "string" &&
      typeof value.files === "object" &&
      value.files !== null
      ? (value as SealManifest)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Create a signing key outside the project and publish its public half inside it. */
export async function generateSealKey(root: string, outputPath: string): Promise<string> {
  const absoluteRoot = resolve(root);
  const target = isAbsolute(outputPath) ? outputPath : resolve(absoluteRoot, outputPath);
  const inside = relative(absoluteRoot, target);
  if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) {
    throw new SealError(
      "SEAL_KEY_INSIDE_PROJECT",
      "The seal key must live outside the project.",
      "Any agent that can write to the repository could read a key stored in it. Pick a path outside the project.",
    );
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, privateKey.export({ format: "pem", type: "pkcs8" }), {
    flag: "wx",
    mode: 0o600,
  });
  const publicPath = join(absoluteRoot, ...SEAL_PUBLIC_KEY_PATH.split("/"));
  await mkdir(dirname(publicPath), { recursive: true });
  await writeFile(publicPath, publicKey.export({ format: "pem", type: "spki" }), "utf8");
  return target;
}

/** Sign the current state of every protected file. This is the human approval step. */
export async function createSeal(
  root: string,
  options: { readonly keyPath: string; readonly now?: Date; readonly signer: string },
): Promise<SealManifest> {
  if (options.signer.trim() === "") {
    throw new SealError(
      "SEAL_SIGNER_REQUIRED",
      "A signer is required.",
      "Pass --by with the person accountable for this seal.",
    );
  }
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(await readFile(options.keyPath, "utf8"));
  } catch (error) {
    throw new SealError(
      "SEAL_KEY_UNREADABLE",
      `Unable to read the seal key: ${options.keyPath}`,
      "Check the path, or create a key with maru seal keygen.",
      { cause: error },
    );
  }
  const absolute = resolve(root);
  const manifestPath = join(absolute, ...SEAL_MANIFEST_PATH.split("/"));
  const previous = parseManifest(await readOptional(manifestPath));
  const unsigned = {
    createdAt: (options.now ?? new Date()).toISOString(),
    files: await collectProtectedFiles(absolute),
    sequence: (previous?.sequence ?? 0) + 1,
    signer: options.signer,
    version: SEAL_VERSION,
  } as const;
  const manifest: SealManifest = {
    ...unsigned,
    signature: sign(null, signedPayload(unsigned), key).toString("base64"),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function showAtCommit(
  root: string,
  commit: string,
  path: string,
  runner: GitRunner,
): Promise<string | undefined> {
  try {
    return await runner.run(["show", `${commit}:${path}`], root);
  } catch {
    return undefined;
  }
}

function signatureHolds(manifest: SealManifest, publicKeyPem: string): boolean {
  try {
    return verify(
      null,
      signedPayload(manifest),
      createPublicKey(publicKeyPem),
      Buffer.from(manifest.signature, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * Check the working tree against the seal, trusting only what the base commit says.
 * Returns one plain-language issue per problem. A base with no public key has not
 * opted in, so there is nothing to enforce and the result is empty.
 */
export async function verifySeal(
  root: string,
  base: string,
  runner: GitRunner = defaultGitRunner,
): Promise<readonly string[]> {
  const absolute = resolve(root);
  const commit = await resolveMergeBase(absolute, base, runner);
  const trustedKey = await showAtCommit(absolute, commit, SEAL_PUBLIC_KEY_PATH, runner);
  if (trustedKey === undefined) return [];

  const manifest = parseManifest(
    await readOptional(join(absolute, ...SEAL_MANIFEST_PATH.split("/"))),
  );
  if (manifest === undefined) return ["The seal manifest is missing or unreadable."];
  if (!signatureHolds(manifest, trustedKey)) {
    return ["The seal signature does not match the public key at the trusted base."];
  }

  const issues: string[] = [];
  const trusted = parseManifest(await showAtCommit(absolute, commit, SEAL_MANIFEST_PATH, runner));
  if (trusted !== undefined && manifest.sequence < trusted.sequence) {
    issues.push(
      `The seal is older than the base (sequence ${String(manifest.sequence)} < ${String(trusted.sequence)}), so an earlier state may have been restored.`,
    );
  }
  const current = await collectProtectedFiles(absolute);
  for (const path of Object.keys(manifest.files)) {
    if (current[path] === undefined) issues.push(`Sealed file is missing: ${path}`);
    else if (current[path] !== manifest.files[path]) issues.push(`Sealed file changed: ${path}`);
  }
  for (const path of Object.keys(current)) {
    if (manifest.files[path] === undefined) issues.push(`Protected file is not sealed: ${path}`);
  }
  return issues.sort();
}
