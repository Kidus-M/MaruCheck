import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  applyApprovedContractAmendment,
  contractVersionHash,
  diffQualityContracts,
  getContract,
  parseQualityContract,
  serializeQualityContract,
  type QualityContract,
} from "@maru/contracts";
import { checkSemanticDrift } from "./guard.js";
import {
  CONTRACT_AMENDMENT_SCHEMA_VERSION,
  DriftError,
  type ContractAmendmentProposal,
  type ObservedBehavior,
} from "./model.js";

const PROPOSAL_ROOT = ".maru/contracts/.proposals";

function portable(path: string): string {
  return path.split(sep).join("/");
}

function safePath(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new DriftError(
      "DRIFT_INVALID_INPUT",
      `Path escapes the project root: ${path}`,
      "Use an amendment proposal path inside the current project.",
    );
  }
  return target;
}

function proposalId(contractId: string, createdAt: string, content: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 12);
  return `${contractId}-${createdAt.replace(/[:.]/gu, "-")}-${hash}`;
}

function amendedContract(
  contract: QualityContract,
  observations: readonly ObservedBehavior[],
): QualityContract {
  const requirementReplacements = new Map<string, string>();
  const invariantReplacements = new Map<string, string>();
  for (const observation of observations) {
    const id = observation.requirementRef.split("#")[1];
    if (id === undefined) continue;
    if (contract.requirements.some((item) => item.id === id)) {
      requirementReplacements.set(id, observation.observed);
    } else if (contract.invariants.some((item) => item.id === id)) {
      invariantReplacements.set(id, observation.observed);
    }
  }
  return {
    ...contract,
    approval: undefined,
    invariants: contract.invariants.map((item) => ({
      ...item,
      statement: invariantReplacements.get(item.id) ?? item.statement,
    })),
    requirements: contract.requirements.map((item) => ({
      ...item,
      statement: requirementReplacements.get(item.id) ?? item.statement,
    })),
    status: "amended",
  };
}

function assertProposal(value: unknown): ContractAmendmentProposal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DriftError(
      "DRIFT_PROPOSAL_INVALID",
      "The amendment proposal is not a JSON object.",
      "Create a new proposal with maru drift propose.",
    );
  }
  const proposal = value as Partial<ContractAmendmentProposal>;
  if (
    proposal.schemaVersion !== CONTRACT_AMENDMENT_SCHEMA_VERSION ||
    proposal.status !== "proposed" ||
    typeof proposal.contractId !== "string" ||
    typeof proposal.baseVersionHash !== "string" ||
    typeof proposal.proposalId !== "string" ||
    typeof proposal.proposedBy !== "string" ||
    typeof proposal.reason !== "string" ||
    !Array.isArray(proposal.changes) ||
    !Array.isArray(proposal.observations) ||
    proposal.approval?.required !== true ||
    proposal.approval.status !== "pending" ||
    proposal.proposedContract === undefined
  ) {
    throw new DriftError(
      "DRIFT_PROPOSAL_INVALID",
      "The amendment proposal is incomplete or uses an unsupported schema.",
      "Create a new proposal with the current MaruCheck version.",
    );
  }
  const parsedContract = parseQualityContract(
    serializeQualityContract(proposal.proposedContract),
    "amendment.proposedContract",
  );
  return { ...proposal, proposedContract: parsedContract } as ContractAmendmentProposal;
}

/** Persist an immutable, pending semantic amendment without changing the current contract. */
export async function proposeContractAmendment(
  root: string,
  contractId: string,
  observations: readonly ObservedBehavior[],
  options: { readonly now?: Date; readonly proposedBy: string; readonly reason: string },
): Promise<{ readonly path: string; readonly proposal: ContractAmendmentProposal }> {
  if (options.proposedBy.trim().length === 0 || options.reason.trim().length === 0) {
    throw new DriftError(
      "DRIFT_INVALID_INPUT",
      "A proposer and reason are required.",
      "Pass --by and --reason so the proposal has an auditable owner and rationale.",
    );
  }
  const contract = await getContract(root, contractId);
  const relevant = observations.filter((item) => item.requirementRef.startsWith(`${contractId}#`));
  const report = checkSemanticDrift([contract], relevant, options.now);
  if (report.conflicts.length === 0) {
    throw new DriftError(
      "DRIFT_NO_SEMANTIC_CHANGE",
      "No semantic conflict exists for the selected contract.",
      "Keep mechanical test maintenance separate or provide an observation that changes contract meaning.",
    );
  }
  if (report.conflicts.some((item) => item.kind === "unknown-reference")) {
    throw new DriftError(
      "DRIFT_INVALID_INPUT",
      "One or more observations do not reference a known requirement or invariant.",
      "Use contract-id#requirement-id references from maru contract show.",
    );
  }
  const proposedContract = amendedContract(contract, relevant);
  const changes = diffQualityContracts(contract, proposedContract).changes;
  if (!changes.some((item) => item.semantic)) {
    throw new DriftError(
      "DRIFT_NO_SEMANTIC_CHANGE",
      "The proposal does not change contract meaning.",
      "Apply selector, timing, wait, fixture, or DOM maintenance directly without amending the contract.",
    );
  }
  const createdAt = (options.now ?? new Date()).toISOString();
  const baseVersionHash = contractVersionHash(contract);
  const id = proposalId(contractId, createdAt, { baseVersionHash, observations: relevant });
  const proposal: ContractAmendmentProposal = {
    approval: {
      eligibleApprovers: contract.owners,
      required: true,
      status: "pending",
    },
    baseVersionHash,
    changes,
    contractId,
    createdAt,
    observations: relevant,
    proposalId: id,
    proposedBy: options.proposedBy.trim(),
    proposedContract,
    reason: options.reason.trim(),
    schemaVersion: CONTRACT_AMENDMENT_SCHEMA_VERSION,
    status: "proposed",
  };
  const path = `${PROPOSAL_ROOT}/${contractId}/${id}.json`;
  try {
    const target = safePath(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(proposal, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error instanceof DriftError) throw error;
    throw new DriftError(
      "DRIFT_WRITE_FAILED",
      "Unable to write the immutable amendment proposal.",
      "Check project permissions and create a new proposal.",
      { cause: error },
    );
  }
  return { path, proposal };
}

/** Apply a reviewed proposal only when an eligible owner explicitly approves it. */
export async function approveContractAmendment(
  root: string,
  proposalPath: string,
  options: { readonly approvedBy: string; readonly now?: Date },
): Promise<{
  readonly auditPath: string;
  readonly contract: QualityContract;
  readonly path: string;
  readonly versionHash: string;
}> {
  if (options.approvedBy.trim().length === 0) {
    throw new DriftError(
      "DRIFT_APPROVAL_REQUIRED",
      "An explicit contract owner approval is required.",
      "Review the proposal, then pass --by with an eligible contract owner.",
    );
  }
  const relativePath = portable(relative(resolve(root), safePath(root, proposalPath)));
  if (!relativePath.startsWith(`${PROPOSAL_ROOT}/`) || !relativePath.endsWith(".json")) {
    throw new DriftError(
      "DRIFT_PROPOSAL_INVALID",
      "The proposal path is outside MaruCheck's amendment proposal directory.",
      "Pass the path returned by maru drift propose.",
    );
  }
  let proposal: ContractAmendmentProposal;
  try {
    proposal = assertProposal(JSON.parse(await readFile(safePath(root, relativePath), "utf8")) as unknown);
  } catch (error) {
    if (error instanceof DriftError) throw error;
    throw new DriftError(
      "DRIFT_PROPOSAL_INVALID",
      "The amendment proposal could not be read or parsed.",
      "Pass an unmodified proposal created by maru drift propose.",
      { cause: error },
    );
  }
  const approvedBy = options.approvedBy.trim();
  const current = await getContract(root, proposal.contractId);
  if (contractVersionHash(current) !== proposal.baseVersionHash) {
    throw new DriftError(
      "DRIFT_PROPOSAL_STALE",
      "The contract changed after this amendment was proposed.",
      "Review the current contract and create a new amendment proposal.",
    );
  }
  if (
    current.owners.length > 0 &&
    !current.owners.some(
      (owner) => owner.trim().toLocaleLowerCase() === approvedBy.toLocaleLowerCase(),
    )
  ) {
    throw new DriftError(
      "DRIFT_APPROVAL_REQUIRED",
      `${approvedBy} is not an eligible owner for ${proposal.contractId}.`,
      `Use one of the current contract owners: ${current.owners.join(", ")}.`,
    );
  }
  const recordedChanges = JSON.stringify(proposal.changes);
  const actualChanges = JSON.stringify(
    diffQualityContracts(current, proposal.proposedContract).changes,
  );
  if (recordedChanges !== actualChanges) {
    throw new DriftError(
      "DRIFT_PROPOSAL_INVALID",
      "The proposal's ContractChange audit does not match its proposed contract.",
      "Review the file for edits and create a fresh amendment proposal.",
    );
  }
  const approvedAt = options.now ?? new Date();
  const applied = await applyApprovedContractAmendment(
    root,
    proposal.contractId,
    proposal.proposedContract,
    {
      approvedAt,
      approvedBy,
      expectedCurrentVersionHash: proposal.baseVersionHash,
    },
  );
  const auditPath = `${PROPOSAL_ROOT}/${proposal.contractId}/${proposal.proposalId}.approved.json`;
  try {
    await writeFile(
      safePath(root, auditPath),
      `${JSON.stringify(
        {
          approvedAt: approvedAt.toISOString(),
          approvedBy,
          contractId: proposal.contractId,
          proposalId: proposal.proposalId,
          status: "approved",
          versionHash: applied.versionHash,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    throw new DriftError(
      "DRIFT_WRITE_FAILED",
      "The contract was approved, but its amendment audit record could not be written.",
      "Preserve the proposal and inspect the contract history before retrying.",
      { cause: error },
    );
  }
  return { ...applied, auditPath };
}
