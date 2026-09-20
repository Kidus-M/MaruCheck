import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  MemoryError,
  QA_MEMORY_SCHEMA_VERSION,
  type CreateMemoryRecordInput,
  type QAMemoryRecord,
} from "./model.js";
import { parseMemoryRecordInput, parseStoredMemoryRecord } from "./validation.js";

const MEMORY_DIRECTORY = ".maru/memory";
const MEMORY_ID = /^MEM-([0-9]{4,})$/u;

function safePath(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new MemoryError(
      "MEMORY_INVALID",
      `Path escapes the project root: ${path}`,
      "Use a QA memory identifier or path inside the current project.",
    );
  }
  return target;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function requireInitialization(root: string): Promise<void> {
  if (!(await exists(safePath(root, ".maru/maru.yml")))) {
    throw new MemoryError(
      "MEMORY_NOT_INITIALIZED",
      "MaruCheck is not initialized in this project.",
      "Run maru init before managing QA memory.",
    );
  }
}

async function memoryFileNames(root: string): Promise<string[]> {
  const directory = safePath(root, MEMORY_DIRECTORY);
  if (!(await exists(directory))) return [];
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^MEM-[0-9]{4,}\.json$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    throw new MemoryError(
      "MEMORY_READ_FAILED",
      "Unable to list QA memory records.",
      "Check that .maru/memory is readable.",
      { cause: error },
    );
  }
}

async function readMemoryFile(root: string, path: string): Promise<QAMemoryRecord> {
  try {
    const parsed = JSON.parse(await readFile(safePath(root, path), "utf8")) as unknown;
    return parseStoredMemoryRecord(parsed, path);
  } catch (error) {
    if (error instanceof MemoryError) throw error;
    throw new MemoryError(
      "MEMORY_READ_FAILED",
      `Unable to read QA memory: ${path}`,
      "Confirm the record is readable JSON using the current schema.",
      { cause: error },
    );
  }
}

function nextSequence(names: readonly string[]): number {
  return (
    names.reduce((highest, name) => {
      const match = /^MEM-([0-9]{4,})\.json$/u.exec(name);
      return Math.max(highest, match === null ? 0 : Number(match[1]));
    }, 0) + 1
  );
}

/** Store one immutable, validated QA memory record. */
export async function createMemoryRecord(
  root: string,
  input: CreateMemoryRecordInput | unknown,
  options: { readonly now?: Date } = {},
): Promise<{ readonly path: string; readonly record: QAMemoryRecord }> {
  await requireInitialization(root);
  const normalized = parseMemoryRecordInput(input);
  const names = await memoryFileNames(root);
  const missing = (normalized.supersedes ?? []).filter((id) => !names.includes(`${id}.json`));
  if (missing.length > 0) {
    throw new MemoryError(
      "MEMORY_NOT_FOUND",
      `Superseded QA memory not found: ${missing.join(", ")}`,
      "Only supersede records listed by maru memory list.",
    );
  }
  let sequence = nextSequence(names);
  for (let attempt = 0; attempt < 100; attempt += 1, sequence += 1) {
    const id = `MEM-${String(sequence).padStart(4, "0")}`;
    const record: QAMemoryRecord = {
      ...normalized,
      createdAt: (options.now ?? new Date()).toISOString(),
      id,
      schemaVersion: QA_MEMORY_SCHEMA_VERSION,
      source: normalized.source ?? "manual",
      status: "active",
      supersedes: normalized.supersedes ?? [],
    };
    const path = `${MEMORY_DIRECTORY}/${id}.json`;
    try {
      const target = safePath(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      return { path, record };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new MemoryError(
        "MEMORY_WRITE_FAILED",
        "Unable to write the QA memory record.",
        "Check project permissions and available disk space.",
        { cause: error },
      );
    }
  }
  throw new MemoryError(
    "MEMORY_WRITE_FAILED",
    "Unable to allocate a unique QA memory identifier.",
    "Retry after checking .maru/memory for an unusually high write rate.",
  );
}

/** List active records newest first. */
export async function listMemoryRecords(root: string): Promise<QAMemoryRecord[]> {
  await requireInitialization(root);
  const records = await Promise.all(
    (await memoryFileNames(root)).map((name) =>
      readMemoryFile(root, `${MEMORY_DIRECTORY}/${name}`),
    ),
  );
  return records.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

/** Read one memory record by stable `MEM-####` identifier. */
export async function getMemoryRecord(root: string, id: string): Promise<QAMemoryRecord> {
  await requireInitialization(root);
  if (!MEMORY_ID.test(id)) {
    throw new MemoryError(
      "MEMORY_INVALID",
      `Invalid QA memory identifier: ${id}`,
      "Use an identifier such as MEM-0001 from maru memory list.",
    );
  }
  const path = `${MEMORY_DIRECTORY}/${id}.json`;
  if (!(await exists(safePath(root, path)))) {
    throw new MemoryError(
      "MEMORY_NOT_FOUND",
      `QA memory not found: ${id}`,
      "Run maru memory list or search for a related record.",
    );
  }
  return readMemoryFile(root, path);
}
