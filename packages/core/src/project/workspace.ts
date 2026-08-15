import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { ProjectError } from "./errors.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

export class ProjectWorkspace {
  public readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public resolve(relativePath: string): string {
    const candidate = resolve(this.root, relativePath);
    const rootPrefix = `${this.root}${sep}`;

    if (candidate !== this.root && !candidate.startsWith(rootPrefix)) {
      throw new ProjectError(
        "PROJECT_PATH_OUTSIDE_ROOT",
        "resolve project path",
        `Path escapes the project root: ${relativePath}`,
        "Use a path inside the project root.",
      );
    }

    return candidate;
  }

  public async exists(relativePath: string): Promise<boolean> {
    try {
      await access(this.resolve(relativePath));
      return true;
    } catch (error) {
      if (error instanceof ProjectError) {
        throw error;
      }
      return false;
    }
  }

  public async createDirectory(relativePath: string): Promise<void> {
    try {
      await mkdir(this.resolve(relativePath), { recursive: true });
    } catch (error) {
      throw new ProjectError(
        "PROJECT_WRITE_FAILED",
        "create project directory",
        `Unable to create ${relativePath}.`,
        "Check directory permissions and available disk space.",
        { cause: error },
      );
    }
  }

  public async readText(relativePath: string): Promise<string> {
    try {
      return await readFile(this.resolve(relativePath), "utf8");
    } catch (error) {
      throw new ProjectError(
        "PROJECT_READ_FAILED",
        "read project file",
        `Unable to read ${relativePath}.`,
        "Confirm the file exists and is readable.",
        { cause: error },
      );
    }
  }

  public async writeText(relativePath: string, content: string): Promise<void> {
    try {
      const target = this.resolve(relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    } catch (error) {
      if (error instanceof ProjectError) {
        throw error;
      }
      throw new ProjectError(
        "PROJECT_WRITE_FAILED",
        "write project file",
        `Unable to write ${relativePath}.`,
        "Check directory permissions and available disk space.",
        { cause: error },
      );
    }
  }

  public async listFiles(): Promise<string[]> {
    const files: string[] = [];

    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          continue;
        }

        const absolutePath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) {
            await visit(absolutePath);
          }
          continue;
        }

        if (entry.isFile()) {
          files.push(toPortablePath(relative(this.root, absolutePath)));
        }
      }
    };

    try {
      await visit(this.root);
      return files.sort((left, right) => left.localeCompare(right));
    } catch (error) {
      throw new ProjectError(
        "PROJECT_READ_FAILED",
        "inventory project files",
        "Unable to enumerate the project.",
        "Check that the project directory is readable.",
        { cause: error },
      );
    }
  }
}

export async function readPackageManifest(
  workspace: ProjectWorkspace,
): Promise<Record<string, unknown>> {
  if (!(await workspace.exists("package.json"))) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(await workspace.readText("package.json"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("package.json must contain an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ProjectError && error.code !== "PROJECT_READ_FAILED") {
      throw error;
    }
    throw new ProjectError(
      "INVALID_PROJECT_MANIFEST",
      "parse package manifest",
      "package.json is not valid JSON.",
      "Repair package.json, then run the command again.",
      { cause: error },
    );
  }
}

export function dependencyMap(manifest: Record<string, unknown>): Record<string, string> {
  const sections = ["dependencies", "devDependencies", "peerDependencies"];
  const dependencies: Record<string, string> = {};

  for (const section of sections) {
    const value = manifest[section];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }

    for (const [name, version] of Object.entries(value)) {
      if (typeof version === "string") {
        dependencies[name] = version;
      }
    }
  }

  return dependencies;
}

export function dependencyNames(manifest: Record<string, unknown>, section: string): string[] {
  const value = manifest[section];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value).sort((left, right) => left.localeCompare(right));
}
