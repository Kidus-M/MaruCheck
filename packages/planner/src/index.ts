import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  getContract,
  listContracts,
  type QualityContract,
  type RequirementPriority,
} from "@maru/contracts";
import { scanProject, type ProjectScan } from "@maru/core";
import type { MemorySeverity } from "@maru/memory";
import {
  assessProjectRisk,
  type RecommendedTestCategory,
  type RiskAssessment,
  type RiskLevel,
} from "@maru/risk";

export const VERIFICATION_PLAN_SCHEMA_VERSION = 1;
export const VERIFICATION_PLAN_PATH = ".maru/generated/verification-plan.json";

export type VerificationAdapter = "manual-review" | "playwright" | "unavailable" | "vitest";
export type VerificationExecution = "automated" | "manual" | "unavailable";
type TestFramework = ProjectScan["tests"]["frameworks"][number];

export interface SelectedRequirement {
  readonly blocking: boolean;
  readonly contractId: string;
  readonly contractTitle: string;
  readonly id: string;
  readonly kind: "invariant" | "requirement";
  readonly priority: RequirementPriority | "invariant";
  readonly reasons: readonly string[];
  readonly statement: string;
}

export interface AffectedTest {
  readonly framework: TestFramework | "unknown";
  readonly historicalMemoryIds: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly path: string;
  readonly requirementRefs: readonly string[];
}

export interface HistoricalRegression {
  readonly availableTestFiles: readonly string[];
  readonly memoryId: string;
  readonly missingTestFiles: readonly string[];
  readonly reasons: readonly string[];
  readonly requirementRefs: readonly string[];
  readonly severity: MemorySeverity;
  readonly title: string;
}

export interface VerificationStep {
  readonly adapter: VerificationAdapter;
  readonly blocking: boolean;
  readonly category: RecommendedTestCategory;
  readonly execution: VerificationExecution;
  readonly id: string;
  readonly reasons: readonly string[];
  readonly requirementRefs: readonly string[];
  readonly testFiles: readonly string[];
}

export interface VerificationPlan {
  readonly affectedTests: readonly AffectedTest[];
  readonly changeSummary: RiskAssessment["analysis"]["summary"];
  readonly generatedAt: string;
  readonly historicalRegressions: readonly HistoricalRegression[];
  readonly project: {
    readonly name: string;
    readonly testFrameworks: readonly TestFramework[];
  };
  readonly risk: {
    readonly level: RiskLevel;
    readonly score: number;
  };
  readonly schemaVersion: 1;
  readonly scope: "working-tree";
  readonly selectedRequirements: readonly SelectedRequirement[];
  readonly steps: readonly VerificationStep[];
  readonly summary: {
    readonly affectedTests: number;
    readonly automatedSteps: number;
    readonly historicalRegressions: number;
    readonly manualSteps: number;
    readonly selectedRequirements: number;
    readonly unavailableSteps: number;
  };
  readonly uncoveredRequirements: readonly string[];
}

export interface VerificationPlanResult {
  readonly path: typeof VERIFICATION_PLAN_PATH;
  readonly plan: VerificationPlan;
}

export class VerificationPlanError extends Error {
  public readonly code = "PLAN_WRITE_FAILED";
  public readonly remediation = "Check project directory permissions and available disk space.";

  public constructor(options?: ErrorOptions) {
    super("Unable to write the verification plan.", options);
    this.name = "VerificationPlanError";
  }
}

const STOP_WORDS = new Set([
  "contract",
  "e2e",
  "exactly",
  "from",
  "management",
  "must",
  "never",
  "only",
  "spec",
  "test",
  "tests",
  "that",
  "this",
  "verified",
  "with",
]);

function terms(text: string): Set<string> {
  const separated = text.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase();
  return new Set(
    separated.split(/[^a-z0-9]+/u).filter((term) => term.length >= 4 && !STOP_WORDS.has(term)),
  );
}

function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((term) => right.has(term)).sort();
}

function requirementRef(requirement: Pick<SelectedRequirement, "contractId" | "id">): string {
  return `${requirement.contractId}#${requirement.id}`;
}

function selectRequirements(
  assessment: RiskAssessment,
  contracts: readonly QualityContract[],
): SelectedRequirement[] {
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const selected: SelectedRequirement[] = [];

  for (const match of assessment.relatedContracts) {
    const contract = contractsById.get(match.contractId);
    if (contract === undefined) continue;
    const matchedIds = new Set([
      ...match.requirementIds,
      ...match.invariantIds,
      ...contract.evidencePolicy.blockingRequirements,
    ]);
    const add = (
      item: { readonly id: string; readonly statement: string },
      kind: SelectedRequirement["kind"],
      priority: SelectedRequirement["priority"],
    ): void => {
      if (!matchedIds.has(item.id)) return;
      const blocking = contract.evidencePolicy.blockingRequirements.includes(item.id);
      const reasons = [
        ...(match.requirementIds.includes(item.id) || match.invariantIds.includes(item.id)
          ? [`Matched diff terms: ${match.matchedTerms.join(", ")}.`]
          : []),
        ...(blocking ? ["Selected by the contract evidence policy."] : []),
      ];
      selected.push({
        blocking,
        contractId: contract.id,
        contractTitle: contract.title,
        id: item.id,
        kind,
        priority,
        reasons,
        statement: item.statement,
      });
    };
    for (const requirement of contract.requirements) {
      add(requirement, "requirement", requirement.priority);
    }
    for (const invariant of contract.invariants) add(invariant, "invariant", "invariant");
  }

  return selected.sort(
    (left, right) =>
      left.contractId.localeCompare(right.contractId) || left.id.localeCompare(right.id),
  );
}

function findAffectedTests(
  assessment: RiskAssessment,
  project: ProjectScan,
  requirements: readonly SelectedRequirement[],
): AffectedTest[] {
  const changeVocabulary = terms(
    [
      ...assessment.analysis.files.flatMap((file) => [file.path, ...file.symbols]),
      ...assessment.relatedContracts.flatMap((contract) => contract.matchedTerms),
      ...assessment.relatedContracts.map((contract) => contract.contractId),
    ].join(" "),
  );

  const affected = project.tests.files
    .map((test): AffectedTest | undefined => {
      const testTerms = terms(test.path);
      const matchedTerms = intersection(changeVocabulary, testTerms);
      if (matchedTerms.length === 0) return undefined;
      const requirementRefs = requirements
        .filter(
          (requirement) =>
            intersection(testTerms, terms(`${requirement.contractId} ${requirement.statement}`))
              .length > 0,
        )
        .map(requirementRef);
      return {
        framework: test.framework,
        historicalMemoryIds: [],
        matchedTerms,
        path: test.path,
        requirementRefs,
      };
    })
    .filter((test): test is AffectedTest => test !== undefined);
  const byPath = new Map(affected.map((test) => [test.path, test]));
  const discovered = new Map(project.tests.files.map((test) => [test.path, test]));

  for (const memory of assessment.historicalRisks) {
    for (const regression of memory.regressionTests) {
      const test = discovered.get(regression.path);
      if (test === undefined || test.framework !== regression.adapter) continue;
      const existing = byPath.get(test.path);
      byPath.set(test.path, {
        framework: test.framework,
        historicalMemoryIds: [
          ...new Set([...(existing?.historicalMemoryIds ?? []), memory.memoryId]),
        ].sort(),
        matchedTerms: [
          ...new Set([...(existing?.matchedTerms ?? []), ...memory.matchedTerms]),
        ].sort(),
        path: test.path,
        requirementRefs: [
          ...new Set([...(existing?.requirementRefs ?? []), ...regression.requirementRefs]),
        ].sort(),
      });
    }
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function historicalRegressions(
  assessment: RiskAssessment,
  project: ProjectScan,
): HistoricalRegression[] {
  const discovered = new Set(project.tests.files.map((test) => test.path));
  return assessment.historicalRisks.map((memory) => {
    const testFiles = memory.regressionTests.map((test) => test.path);
    return {
      availableTestFiles: testFiles.filter((path) => discovered.has(path)).sort(),
      memoryId: memory.memoryId,
      missingTestFiles: testFiles.filter((path) => !discovered.has(path)).sort(),
      reasons: memory.reasons,
      requirementRefs: [
        ...new Set(memory.regressionTests.flatMap((test) => test.requirementRefs)),
      ].sort(),
      severity: memory.severity,
      title: memory.title,
    };
  });
}

function adapterFor(
  category: RecommendedTestCategory,
  frameworks: readonly TestFramework[],
): { adapter: VerificationAdapter; execution: VerificationExecution } {
  if (category === "security" || category === "adversarial-edge-cases") {
    return { adapter: "manual-review", execution: "manual" };
  }
  if (category === "e2e" || category === "accessibility") {
    return frameworks.includes("playwright")
      ? { adapter: "playwright", execution: "automated" }
      : { adapter: "unavailable", execution: "unavailable" };
  }
  return frameworks.includes("vitest")
    ? { adapter: "vitest", execution: "automated" }
    : { adapter: "unavailable", execution: "unavailable" };
}

function createSteps(
  assessment: RiskAssessment,
  project: ProjectScan,
  requirements: readonly SelectedRequirement[],
  affectedTests: readonly AffectedTest[],
): VerificationStep[] {
  const requirementRefs = [
    ...new Set([
      ...requirements.map(requirementRef),
      ...affectedTests
        .filter((test) => test.historicalMemoryIds.length > 0)
        .flatMap((test) => test.requirementRefs),
    ]),
  ].sort();
  const blocking =
    assessment.level === "high" ||
    assessment.level === "critical" ||
    requirements.some((requirement) => requirement.blocking);

  return [...assessment.recommendedTestCategories]
    .sort()
    .map((category, index): VerificationStep => {
      const selection = adapterFor(category, project.tests.frameworks);
      const testFiles = affectedTests
        .filter((test) => test.framework === selection.adapter)
        .map((test) => test.path);
      const reasons = [
        `The ${assessment.level} risk assessment recommends ${category} verification.`,
        selection.execution === "automated"
          ? `${selection.adapter} is detected for automated execution.`
          : selection.execution === "manual"
            ? `${category} requires manual review until a supported adapter is available.`
            : `No supported ${category} execution adapter is configured.`,
        testFiles.length > 0
          ? `Matched ${testFiles.length} existing affected test file${testFiles.length === 1 ? "" : "s"}.`
          : "No existing affected test file matches this step.",
        requirementRefs.length > 0
          ? `Links ${requirementRefs.length} selected contract requirement${requirementRefs.length === 1 ? "" : "s"}.`
          : "No related contract requirement was selected.",
        ...(affectedTests.some(
          (test) => test.framework === selection.adapter && test.historicalMemoryIds.length > 0,
        )
          ? ["Includes regression tests selected by matched historical QA memory."]
          : []),
      ];
      return {
        adapter: selection.adapter,
        blocking,
        category,
        execution: selection.execution,
        id: `step-${String(index + 1).padStart(2, "0")}-${category}`,
        reasons,
        requirementRefs,
        testFiles,
      };
    });
}

/** Build one inspectable verification plan from already-collected local evidence. */
export function buildVerificationPlan(input: {
  readonly assessment: RiskAssessment;
  readonly contracts: readonly QualityContract[];
  readonly generatedAt: string;
  readonly project: ProjectScan;
}): VerificationPlan {
  const selectedRequirements = selectRequirements(input.assessment, input.contracts);
  const affectedTests = findAffectedTests(input.assessment, input.project, selectedRequirements);
  const memoryRegressions = historicalRegressions(input.assessment, input.project);
  const steps = createSteps(input.assessment, input.project, selectedRequirements, affectedTests);
  const covered = new Set(affectedTests.flatMap((test) => test.requirementRefs));
  const uncoveredRequirements = selectedRequirements
    .map(requirementRef)
    .filter((reference) => !covered.has(reference));

  return {
    affectedTests,
    changeSummary: input.assessment.analysis.summary,
    generatedAt: input.generatedAt,
    historicalRegressions: memoryRegressions,
    project: {
      name: input.project.project.name,
      testFrameworks: input.project.tests.frameworks,
    },
    risk: { level: input.assessment.level, score: input.assessment.score },
    schemaVersion: VERIFICATION_PLAN_SCHEMA_VERSION,
    scope: "working-tree",
    selectedRequirements,
    steps,
    summary: {
      affectedTests: affectedTests.length,
      automatedSteps: steps.filter((step) => step.execution === "automated").length,
      historicalRegressions: memoryRegressions.length,
      manualSteps: steps.filter((step) => step.execution === "manual").length,
      selectedRequirements: selectedRequirements.length,
      unavailableSteps: steps.filter((step) => step.execution === "unavailable").length,
    },
    uncoveredRequirements,
  };
}

/** Serialize a versioned plan using stable JSON indentation and a trailing newline. */
export function serializeVerificationPlan(plan: VerificationPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

/** Persist a plan to the fixed root-scoped generated artifact path. */
export async function writeVerificationPlan(
  root: string,
  plan: VerificationPlan,
): Promise<typeof VERIFICATION_PLAN_PATH> {
  try {
    const target = resolve(root, VERIFICATION_PLAN_PATH);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, serializeVerificationPlan(plan), "utf8");
    return VERIFICATION_PLAN_PATH;
  } catch (error) {
    throw new VerificationPlanError({ cause: error });
  }
}

/** Collect current local evidence and construct a verification plan without persisting it. */
export async function createVerificationPlan(
  root: string,
  now = new Date(),
): Promise<VerificationPlan> {
  const [assessment, project, summaries] = await Promise.all([
    assessProjectRisk(root),
    scanProject(root, now),
    listContracts(root),
  ]);
  const contracts = await Promise.all(summaries.map((summary) => getContract(root, summary.id)));
  return buildVerificationPlan({
    assessment,
    contracts,
    generatedAt: now.toISOString(),
    project,
  });
}

/** Create and persist the current working-tree verification plan. */
export async function createAndWriteVerificationPlan(
  root: string,
  now = new Date(),
): Promise<VerificationPlanResult> {
  const plan = await createVerificationPlan(root, now);
  const path = await writeVerificationPlan(root, plan);
  return { path, plan };
}
