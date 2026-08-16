import type { ContractInvariant, ContractRequirement, QualityContract } from "./model.js";

function sentenceList(requirements: string): string[] {
  return requirements
    .replace(/^#+\s*/gmu, "")
    .split(/(?<=[.!?])\s+|\r?\n+/u)
    .map((sentence) => sentence.replace(/^[-*]\s+/u, "").trim())
    .filter((sentence) => sentence.length >= 8)
    .slice(0, 12);
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function inferId(requirements: string): string {
  if (/subscription|upgrade|billing|payment|pro users?|free users?/iu.test(requirements)) {
    return "subscription-management";
  }
  if (/auth|sign[ -]?in|login|password|session/iu.test(requirements)) return "authentication";
  if (/permission|authorization|role|access control/iu.test(requirements)) return "permissions";
  return "quality-contract";
}

function prefixFor(id: string): string {
  return id
    .split("-")
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 5);
}

/** Convert natural-language requirements into a deterministic draft that requires human review. */
export function draftQualityContract(
  requirementsText: string,
  options: { readonly id?: string; readonly title?: string } = {},
): QualityContract {
  const sentences = sentenceList(requirementsText);
  if (sentences.length === 0) {
    throw new Error("Requirements must contain at least one meaningful sentence.");
  }
  const id = options.id ?? inferId(requirementsText);
  const prefix = prefixFor(id);
  const requirements: ContractRequirement[] = sentences.map((statement, index) => ({
    id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    statement,
    priority: "required",
  }));
  const invariants: ContractInvariant[] = [
    {
      id: `${prefix}-INV-001`,
      statement: /payment|billing|upgrade/iu.test(requirementsText)
        ? "Client-controlled data must never be accepted as proof of successful payment."
        : "Authorization and validation must be enforced by a trusted server boundary.",
    },
    {
      id: `${prefix}-INV-002`,
      statement: "Retries and duplicate requests must not create contradictory state.",
    },
  ];

  return {
    version: 1,
    id,
    title: options.title ?? titleCase(id),
    status: "draft",
    criticality: /payment|billing|security|authorization/iu.test(requirementsText)
      ? "high"
      : "medium",
    intent: sentences.join(" "),
    owners: ["product", "engineering"],
    requirements,
    invariants,
    edgeCases: [
      "the operation is retried or submitted concurrently",
      "a dependent service succeeds but local persistence fails",
    ],
    security: [
      /payment|webhook/iu.test(requirementsText)
        ? "verify payment webhook signatures before changing subscription state"
        : "enforce authorization and input validation at the server boundary",
    ],
    dataIntegrity: [
      "duplicate or failed operations must not create duplicate or partially committed state",
    ],
    evidencePolicy: {
      blockingRequirements: [requirements[0]!.id, ...invariants.map((item) => item.id)],
    },
  };
}
