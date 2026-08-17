import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { draftQualityContract } from "./draft.js";
import { diffQualityContracts } from "./diff.js";
import { contractVersionHash } from "./hash.js";
import {
  ContractError,
  type ContractDiff,
  type ContractSummary,
  type ContractValidationIssue,
  type QualityContract,
} from "./model.js";
import { parseQualityContract, serializeQualityContract } from "./schema.js";

const CONTRACT_DIRECTORY = ".maru/contracts";
const CONTRACT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function portable(path: string): string {
  return path.split(sep).join("/");
}

function safePath(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new ContractError(
      "CONTRACT_ID_INVALID",
      `Path escapes the project root: ${path}`,
      "Use a contract identifier or path inside the project root.",
    );
  }
  return target;
}

function assertId(id: string): void {
  if (!CONTRACT_ID.test(id)) {
    throw new ContractError(
      "CONTRACT_ID_INVALID",
      `Invalid contract identifier: ${id}`,
      "Use a lowercase kebab-case identifier such as subscription-management.",
    );
  }
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
    throw new ContractError(
      "MARU_NOT_INITIALIZED",
      "MaruCheck is not initialized in this project.",
      "Run maru init before managing Quality Contracts.",
    );
  }
}

async function readContractFile(root: string, path: string): Promise<QualityContract> {
  try {
    return parseQualityContract(await readFile(safePath(root, path), "utf8"), path);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      "CONTRACT_READ_FAILED",
      `Unable to read ${path}.`,
      "Confirm the contract file exists and is readable.",
      [],
      { cause: error },
    );
  }
}

async function writeContractFile(
  root: string,
  path: string,
  contract: QualityContract,
): Promise<void> {
  try {
    const target = safePath(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, serializeQualityContract(contract), "utf8");
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      "CONTRACT_WRITE_FAILED",
      `Unable to write ${path}.`,
      "Check directory permissions and available disk space.",
      [],
      { cause: error },
    );
  }
}

async function writeContractSnapshot(
  root: string,
  path: string,
  contract: QualityContract,
): Promise<void> {
  try {
    const target = safePath(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, serializeQualityContract(contract), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error instanceof ContractError) throw error;
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ContractError(
        "CONTRACT_VERSION_EXISTS",
        "An immutable snapshot already exists for this contract content.",
        "Change the contract's reviewable content before approving a new version.",
        [],
        { cause: error },
      );
    }
    throw new ContractError(
      "CONTRACT_WRITE_FAILED",
      `Unable to write ${path}.`,
      "Check directory permissions and available disk space.",
      [],
      { cause: error },
    );
  }
}

function summary(contract: QualityContract, path: string): ContractSummary {
  return {
    criticality: contract.criticality,
    id: contract.id,
    path,
    status: contract.status,
    title: contract.title,
    versionHash: contractVersionHash(contract),
  };
}

/** Create and persist a human-reviewable contract draft from natural-language requirements. */
export async function createContractFromRequirements(
  root: string,
  requirementsText: string,
  options: {
    readonly id?: string;
    readonly now?: Date;
    readonly title?: string;
  } = {},
): Promise<{
  readonly contract: QualityContract;
  readonly path: string;
  readonly versionHash: string;
}> {
  await requireInitialization(root);
  if (requirementsText.trim().length < 8) {
    throw new ContractError(
      "REQUIREMENTS_INVALID",
      "Requirements must contain at least one meaningful sentence.",
      "Provide a readable requirements file with the behavior the product must preserve.",
    );
  }
  if (options.id !== undefined) assertId(options.id);
  const contract = draftQualityContract(requirementsText, options);
  assertId(contract.id);
  const path = `${CONTRACT_DIRECTORY}/${contract.id}.yml`;
  if (await exists(safePath(root, path))) {
    throw new ContractError(
      "CONTRACT_ALREADY_EXISTS",
      `Contract already exists: ${contract.id}`,
      "Choose another identifier or edit the existing contract intentionally.",
    );
  }
  await writeContractFile(root, path, contract);
  return { contract, path, versionHash: contractVersionHash(contract) };
}

/** List valid current contracts. Invalid files are reported by validateContracts instead. */
export async function listContracts(root: string): Promise<ContractSummary[]> {
  await requireInitialization(root);
  const directory = safePath(root, CONTRACT_DIRECTORY);
  if (!(await exists(directory))) return [];
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const summaries: ContractSummary[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !/\.ya?ml$/iu.test(entry.name)) continue;
      const path = `${CONTRACT_DIRECTORY}/${entry.name}`;
      summaries.push(summary(await readContractFile(root, path), path));
    }
    return summaries;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      "CONTRACT_READ_FAILED",
      "Unable to list Quality Contracts.",
      "Check that .maru/contracts is readable.",
      [],
      { cause: error },
    );
  }
}

/** Load one current contract by its safe identifier. */
export async function getContract(root: string, id: string): Promise<QualityContract> {
  await requireInitialization(root);
  assertId(id);
  const path = `${CONTRACT_DIRECTORY}/${id}.yml`;
  if (!(await exists(safePath(root, path)))) {
    throw new ContractError(
      "CONTRACT_NOT_FOUND",
      `Contract not found: ${id}`,
      "Run maru contract list or create the contract first.",
    );
  }
  return readContractFile(root, path);
}

export interface ContractValidationReport {
  readonly invalid: readonly {
    readonly issues: readonly ContractValidationIssue[];
    readonly path: string;
  }[];
  readonly valid: readonly ContractSummary[];
}

/** Validate all current contracts or one explicitly selected file. */
export async function validateContracts(
  root: string,
  requestedPath?: string,
): Promise<ContractValidationReport> {
  await requireInitialization(root);
  let paths: string[];
  if (requestedPath !== undefined) {
    paths = [portable(relative(resolve(root), safePath(root, requestedPath)))];
  } else {
    const directory = safePath(root, CONTRACT_DIRECTORY);
    if (!(await exists(directory))) return { invalid: [], valid: [] };
    paths = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.ya?ml$/iu.test(entry.name))
      .map((entry) => `${CONTRACT_DIRECTORY}/${entry.name}`)
      .sort();
  }

  const valid: ContractSummary[] = [];
  const invalid: { issues: readonly ContractValidationIssue[]; path: string }[] = [];
  for (const path of paths) {
    try {
      const contract = await readContractFile(root, path);
      valid.push(summary(contract, path));
    } catch (error) {
      if (error instanceof ContractError) {
        invalid.push({ issues: error.issues, path });
      } else {
        throw error;
      }
    }
  }
  return { invalid, valid };
}

/** Approve the current contract content and create an immutable hash-addressed snapshot. */
export async function approveContract(
  root: string,
  id: string,
  approval: { readonly approvedAt?: Date; readonly approvedBy: string },
): Promise<{
  readonly contract: QualityContract;
  readonly path: string;
  readonly versionHash: string;
}> {
  if (approval.approvedBy.trim().length === 0) {
    throw new ContractError(
      "CONTRACT_INVALID",
      "An approver is required.",
      "Pass --by with the accountable owner name or team.",
      [{ message: "must be a non-empty string", path: "approval.approved_by" }],
    );
  }
  const current = await getContract(root, id);
  if (current.status === "approved") {
    throw new ContractError(
      "CONTRACT_ALREADY_APPROVED",
      `Contract is already approved: ${id}`,
      "Amend the contract content and move it back through review before approving a new version.",
    );
  }
  const versionHash = contractVersionHash(current);
  const contract: QualityContract = {
    ...current,
    status: "approved",
    approval: {
      approvedAt: (approval.approvedAt ?? new Date()).toISOString(),
      approvedBy: approval.approvedBy.trim(),
      versionHash,
    },
  };
  const path = `${CONTRACT_DIRECTORY}/${id}.yml`;
  const historyPath = `${CONTRACT_DIRECTORY}/.history/${id}/${versionHash}.yml`;
  await writeContractSnapshot(root, historyPath, contract);
  await writeContractFile(root, path, contract);
  return { contract, path, versionHash };
}

/**
 * Persist an explicitly approved semantic amendment with optimistic concurrency protection.
 *
 * Callers are responsible for collecting the approval decision; this repository boundary
 * guarantees that an amendment cannot overwrite contract content reviewed after the proposal.
 */
export async function applyApprovedContractAmendment(
  root: string,
  id: string,
  proposedContract: QualityContract,
  options: {
    readonly approvedAt?: Date;
    readonly approvedBy: string;
    readonly expectedCurrentVersionHash: string;
  },
): Promise<{
  readonly contract: QualityContract;
  readonly path: string;
  readonly versionHash: string;
}> {
  if (options.approvedBy.trim().length === 0) {
    throw new ContractError(
      "CONTRACT_INVALID",
      "An approver is required for a contract amendment.",
      "Provide the accountable contract owner who approved the semantic change.",
      [{ message: "must be a non-empty string", path: "approval.approved_by" }],
    );
  }
  const current = await getContract(root, id);
  if (proposedContract.id !== id) {
    throw new ContractError(
      "CONTRACT_INVALID",
      "The proposed contract identifier does not match the current contract.",
      "Create a separate amendment proposal for each contract.",
    );
  }
  if (contractVersionHash(current) !== options.expectedCurrentVersionHash) {
    throw new ContractError(
      "CONTRACT_INVALID",
      "The current contract changed after this amendment was proposed.",
      "Review the latest contract and create a new amendment proposal.",
    );
  }
  if (diffQualityContracts(current, proposedContract).classification !== "semantic") {
    throw new ContractError(
      "CONTRACT_INVALID",
      "The amendment proposal does not contain a semantic contract change.",
      "Use the normal contract workflow for mechanical metadata edits.",
    );
  }

  const reviewable: QualityContract = {
    ...proposedContract,
    status: "amended",
    approval: undefined,
  };
  const versionHash = contractVersionHash(reviewable);
  const contract: QualityContract = {
    ...reviewable,
    status: "approved",
    approval: {
      approvedAt: (options.approvedAt ?? new Date()).toISOString(),
      approvedBy: options.approvedBy.trim(),
      versionHash,
    },
  };
  const path = `${CONTRACT_DIRECTORY}/${id}.yml`;
  const historyPath = `${CONTRACT_DIRECTORY}/.history/${id}/${versionHash}.yml`;
  await writeContractSnapshot(root, historyPath, contract);
  await writeContractFile(root, path, contract);
  return { contract, path, versionHash };
}

async function contractFromReference(root: string, reference: string): Promise<QualityContract> {
  if (CONTRACT_ID.test(reference)) return getContract(root, reference);
  return readContractFile(root, portable(relative(resolve(root), safePath(root, reference))));
}

/** Compare a stored contract or YAML file with another contract or YAML file. */
export async function diffContracts(
  root: string,
  leftReference: string,
  rightReference: string,
): Promise<ContractDiff> {
  await requireInitialization(root);
  return diffQualityContracts(
    await contractFromReference(root, leftReference),
    await contractFromReference(root, rightReference),
  );
}
