import {
  getContract,
  listContracts,
  type ContractCriticality,
  type QualityContract,
} from "@maru/contracts";
import {
  analyzeGitDiff,
  type ChangeClassification,
  type GitDiffAnalysis,
  type GitFileChange,
} from "@maru/git";
import {
  listMemoryRecords,
  matchHistoricalRisks,
  type HistoricalRiskMatch,
  type QAMemoryRecord,
} from "@maru/memory";

export type RiskLevel = "low" | "moderate" | "high" | "critical";
export type RecommendedTestCategory =
  | "accessibility"
  | "adversarial-edge-cases"
  | "api"
  | "contract-regression"
  | "e2e"
  | "integration"
  | "security"
  | "unit";

export interface RiskReason {
  readonly code: string;
  readonly message: string;
  readonly paths?: readonly string[];
  readonly points: number;
}

export interface RelatedContractMatch {
  readonly contractId: string;
  readonly criticality: ContractCriticality;
  readonly invariantIds: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly requirementIds: readonly string[];
  readonly status: QualityContract["status"];
  readonly title: string;
}

export interface RiskAssessment {
  readonly analysis: GitDiffAnalysis;
  readonly historicalRisks: readonly HistoricalRiskMatch[];
  readonly level: RiskLevel;
  readonly reasons: readonly RiskReason[];
  readonly recommendedTestCategories: readonly RecommendedTestCategory[];
  readonly relatedContracts: readonly RelatedContractMatch[];
  readonly score: number;
}

const STOP_WORDS = new Set([
  "after",
  "again",
  "against",
  "application",
  "before",
  "change",
  "changes",
  "code",
  "contract",
  "data",
  "default",
  "each",
  "exactly",
  "feature",
  "file",
  "from",
  "function",
  "handle",
  "management",
  "must",
  "never",
  "only",
  "project",
  "remain",
  "return",
  "state",
  "that",
  "their",
  "this",
  "updates",
  "verified",
  "with",
]);

const CLASSIFICATION_POINTS: Readonly<
  Partial<Record<ChangeClassification, { message: string; points: number }>>
> = {
  "api-contract": { message: "Changes an API or webhook contract boundary.", points: 12 },
  authentication: { message: "Touches authentication behavior.", points: 20 },
  authorization: { message: "Touches authorization or permission enforcement.", points: 25 },
  "background-job": { message: "Changes asynchronous or scheduled work.", points: 12 },
  billing: { message: "Touches billing, payments, invoices, or subscriptions.", points: 30 },
  "business-logic": { message: "Changes production business logic.", points: 10 },
  configuration: { message: "Changes runtime or build configuration.", points: 5 },
  database: { message: "Changes database-facing behavior.", points: 15 },
  "dependency-upgrade": { message: "Changes declared or locked dependencies.", points: 12 },
  "external-integration": { message: "Touches an external integration or webhook.", points: 15 },
  migration: { message: "Changes a schema or data migration.", points: 25 },
  observability: { message: "Changes observability behavior.", points: 4 },
  "performance-sensitive": { message: "Touches a performance-sensitive path.", points: 8 },
  "security-sensitive": { message: "Touches a security-sensitive path.", points: 20 },
  "ui-only": { message: "Changes presentation-only code.", points: 2 },
};

const CRITICALITY_POINTS: Record<ContractCriticality, number> = {
  low: 2,
  medium: 7,
  high: 15,
  critical: 25,
};

function terms(text: string): Set<string> {
  const separated = text.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase();
  return new Set(
    separated.split(/[^a-z0-9]+/u).filter((term) => term.length >= 4 && !STOP_WORDS.has(term)),
  );
}

function changeTerms(files: readonly GitFileChange[]): Set<string> {
  return terms(files.map((file) => `${file.path} ${file.symbols.join(" ")}`).join(" "));
}

function intersect(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((term) => right.has(term)).sort();
}

function matchContract(
  contract: QualityContract,
  changedTerms: Set<string>,
): RelatedContractMatch | undefined {
  const allText = [
    contract.id,
    contract.title,
    contract.intent,
    ...contract.owners,
    ...contract.requirements.map((item) => item.statement),
    ...contract.invariants.map((item) => item.statement),
    ...contract.edgeCases,
    ...contract.security,
    ...contract.dataIntegrity,
  ].join(" ");
  const matchedTerms = intersect(changedTerms, terms(allText));
  if (matchedTerms.length === 0) return undefined;
  const matchesItem = (statement: string): boolean =>
    intersect(changedTerms, terms(statement)).length > 0;
  return {
    contractId: contract.id,
    criticality: contract.criticality,
    invariantIds: contract.invariants
      .filter((item) => matchesItem(item.statement))
      .map((item) => item.id),
    matchedTerms,
    requirementIds: contract.requirements
      .filter((item) => matchesItem(item.statement))
      .map((item) => item.id),
    status: contract.status,
    title: contract.title,
  };
}

function changedPathsFor(
  analysis: GitDiffAnalysis,
  classification: ChangeClassification,
): string[] {
  return analysis.files
    .filter((file) => file.classifications.includes(classification))
    .map((file) => file.path);
}

function addReason(
  reasons: RiskReason[],
  code: string,
  message: string,
  points: number,
  paths?: readonly string[],
): void {
  reasons.push({ code, message, points, ...(paths === undefined ? {} : { paths }) });
}

/** Map a bounded 0-100 score to the public Phase 4 risk bands. */
export function riskLevelForScore(score: number): RiskLevel {
  if (score <= 24) return "low";
  if (score <= 49) return "moderate";
  if (score <= 74) return "high";
  return "critical";
}

function recommendations(
  level: RiskLevel,
  classifications: Set<ChangeClassification>,
  relatedContracts: readonly RelatedContractMatch[],
  historicalRisks: readonly HistoricalRiskMatch[],
): RecommendedTestCategory[] {
  const result = new Set<RecommendedTestCategory>(["unit"]);
  if (
    classifications.has("api-contract") ||
    classifications.has("external-integration") ||
    classifications.has("database")
  ) {
    result.add("api");
    result.add("integration");
  }
  if (classifications.has("security-sensitive")) result.add("security");
  if (classifications.has("ui-only")) result.add("accessibility");
  if (relatedContracts.length > 0 || historicalRisks.length > 0) result.add("contract-regression");
  if (
    historicalRisks.some(
      (memory) =>
        memory.type === "security-finding" || memory.type === "security-regression",
    )
  ) {
    result.add("security");
  }
  if (
    historicalRisks.some((memory) =>
      memory.regressionTests.some((test) => test.adapter === "playwright"),
    )
  ) {
    result.add("e2e");
  }
  if (level === "high" || level === "critical") result.add("e2e");
  if (level === "critical") result.add("adversarial-edge-cases");
  return [...result].sort();
}

/** Score one analyzed change set using deterministic path, size, and contract factors. */
export function assessRisk(
  analysis: GitDiffAnalysis,
  contracts: readonly QualityContract[],
  memories: readonly QAMemoryRecord[] = [],
): RiskAssessment {
  if (analysis.clean) {
    return {
      analysis,
      historicalRisks: [],
      level: "low",
      reasons: [{ code: "clean", message: "The Git working tree has no changes.", points: 0 }],
      recommendedTestCategories: [],
      relatedContracts: [],
      score: 0,
    };
  }

  const reasons: RiskReason[] = [];
  const historicalRisks = matchHistoricalRisks(analysis, memories);
  const classifications = new Set(analysis.files.flatMap((file) => file.classifications));
  for (const [classification, factor] of Object.entries(CLASSIFICATION_POINTS) as [
    ChangeClassification,
    { message: string; points: number },
  ][]) {
    if (!classifications.has(classification)) continue;
    addReason(
      reasons,
      classification,
      factor.message,
      factor.points,
      changedPathsFor(analysis, classification),
    );
  }

  const changedLineCount = analysis.summary.additions + analysis.summary.deletions;
  const sizePoints =
    changedLineCount >= 200 ? 15 : changedLineCount >= 50 ? 10 : changedLineCount >= 10 ? 5 : 0;
  if (sizePoints > 0) {
    addReason(
      reasons,
      "change-size",
      `Changes ${changedLineCount} added or deleted lines.`,
      sizePoints,
    );
  }
  const blastPoints =
    analysis.summary.changedFiles >= 20
      ? 15
      : analysis.summary.changedFiles >= 8
        ? 10
        : analysis.summary.changedFiles >= 3
          ? 5
          : 0;
  if (blastPoints > 0) {
    addReason(
      reasons,
      "blast-radius",
      `Touches ${analysis.summary.changedFiles} files.`,
      blastPoints,
    );
  }

  const relatedContracts = contracts
    .map((contract) => matchContract(contract, changeTerms(analysis.files)))
    .filter((match): match is RelatedContractMatch => match !== undefined)
    .sort((left, right) => left.contractId.localeCompare(right.contractId));
  if (relatedContracts.length > 0) {
    const highest = relatedContracts.reduce((left, right) =>
      CRITICALITY_POINTS[left.criticality] >= CRITICALITY_POINTS[right.criticality] ? left : right,
    );
    addReason(
      reasons,
      "contract-criticality",
      `Matches ${highest.criticality} Quality Contract ${highest.contractId}.`,
      CRITICALITY_POINTS[highest.criticality],
    );
    const unapproved = relatedContracts.filter((contract) => contract.status !== "approved");
    if (unapproved.length > 0) {
      addReason(
        reasons,
        "contract-unapproved",
        `Related contract intent still requires approval: ${unapproved.map((item) => item.contractId).join(", ")}.`,
        5,
      );
    }
  }

  const productionChange = [...classifications].some((classification) =>
    [
      "api-contract",
      "authentication",
      "authorization",
      "background-job",
      "billing",
      "business-logic",
      "database",
      "external-integration",
      "migration",
      "security-sensitive",
    ].includes(classification),
  );
  if (productionChange && relatedContracts.length === 0) {
    addReason(
      reasons,
      "missing-contract",
      "No Quality Contract could be related to this production change.",
      8,
    );
  }
  if (productionChange && !classifications.has("test")) {
    addReason(
      reasons,
      "tests-unchanged",
      "Production code changed without a changed test file.",
      7,
    );
  }

  if (historicalRisks.length > 0) {
    const severityPoints = { critical: 25, high: 18, info: 2, low: 5, medium: 10 } as const;
    const highest = historicalRisks.reduce((left, right) =>
      severityPoints[left.severity] >= severityPoints[right.severity] ? left : right,
    );
    addReason(
      reasons,
      "historical-regression",
      `Touches code related to ${historicalRisks.length} historical QA memor${historicalRisks.length === 1 ? "y" : "ies"}; highest is ${highest.memoryId} (${highest.severity}): ${highest.title}.`,
      severityPoints[highest.severity],
      [...new Set(historicalRisks.flatMap((memory) => memory.exactFileMatches))].sort(),
    );
  }

  const rawScore = reasons.reduce((total, reason) => total + reason.points, 0);
  const score = Math.min(100, rawScore);
  const level = riskLevelForScore(score);
  return {
    analysis,
    historicalRisks,
    level,
    reasons,
    recommendedTestCategories: recommendations(
      level,
      classifications,
      relatedContracts,
      historicalRisks,
    ),
    relatedContracts,
    score,
  };
}

/** Analyze the current Git change set, load local contracts, and calculate deterministic risk. */
export async function assessProjectRisk(root: string): Promise<RiskAssessment> {
  const [analysis, summaries, memories] = await Promise.all([
    analyzeGitDiff(root),
    listContracts(root),
    listMemoryRecords(root),
  ]);
  const contracts = await Promise.all(summaries.map((summary) => getContract(root, summary.id)));
  return assessRisk(analysis, contracts, memories);
}
