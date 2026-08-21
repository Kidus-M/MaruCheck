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

export type VerificationAdapter =
  "axe" | "gitleaks" | "manual-review" | "playwright" | "semgrep" | "unavailable" | "vitest";
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
  readonly targetFiles?: readonly string[];
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
      const policyBlocking = contract.evidencePolicy.blockingRequirements.includes(item.id);
      const blocking = contract.status === "approved" && policyBlocking;
      const reasons = [
        ...(match.requirementIds.includes(item.id) || match.invariantIds.includes(item.id)
          ? [`Matched diff terms: ${match.matchedTerms.join(", ")}.`]
          : []),
        ...(policyBlocking
          ? [
              contract.status === "approved"
                ? "Selected by the approved contract evidence policy."
                : "Listed in the draft contract evidence policy; advisory until approved.",
            ]
          : []),
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
  const discovered = new Map(project.tests.files.map((test) => [test.path, test.framework]));
  return assessment.historicalRisks.map((memory) => {
    const available = memory.regressionTests.filter(
      (test) => discovered.get(test.path) === test.adapter,
    );
    const unavailable = memory.regressionTests.filter(
      (test) => discovered.get(test.path) !== test.adapter,
    );
    return {
      availableTestFiles: available.map((test) => test.path).sort(),
      memoryId: memory.memoryId,
      missingTestFiles: unavailable.map((test) => test.path).sort(),
      reasons: memory.reasons,
      requirementRefs: [
        ...new Set(memory.regressionTests.flatMap((test) => test.requirementRefs)),
      ].sort(),
      severity: memory.severity,
      title: memory.title,
    };
  });
}

interface AdapterSelection {
  readonly adapter: VerificationAdapter;
  readonly execution: VerificationExecution;
  readonly testFramework?: TestFramework;
}

function adapterSelectionsFor(
  category: RecommendedTestCategory,
  project: ProjectScan,
): AdapterSelection[] {
  if (category === "security") {
    return [
      { adapter: "gitleaks", execution: "automated" },
      { adapter: "semgrep", execution: "automated" },
    ];
  }
  if (category === "adversarial-edge-cases") {
    return [{ adapter: "manual-review", execution: "manual" }];
  }
  if (category === "accessibility") {
    const dependencies = new Set([
      ...project.dependencies.development,
      ...project.dependencies.production,
    ]);
    return project.tests.frameworks.includes("playwright") &&
      dependencies.has("@axe-core/playwright")
      ? [{ adapter: "axe", execution: "automated", testFramework: "playwright" }]
      : [{ adapter: "unavailable", execution: "unavailable" }];
  }
  if (category === "e2e") {
    return project.tests.frameworks.includes("playwright")
      ? [{ adapter: "playwright", execution: "automated", testFramework: "playwright" }]
      : [{ adapter: "unavailable", execution: "unavailable" }];
  }
  return project.tests.frameworks.includes("vitest")
    ? [{ adapter: "vitest", execution: "automated", testFramework: "vitest" }]
    : [{ adapter: "unavailable", execution: "unavailable" }];
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

  const targetFiles = assessment.analysis.files
    .filter((file) => file.status !== "deleted" && !file.binary)
    .map((file) => file.path)
    .sort();
  const selected = [...assessment.recommendedTestCategories]
    .sort()
    .flatMap((category) =>
      adapterSelectionsFor(category, project).map((selection) => ({ category, selection })),
    );

  return selected.map(({ category, selection }, index): VerificationStep => {
    const testFiles = affectedTests
      .filter((test) => test.framework === selection.testFramework)
      .map((test) => test.path);
    const reasons = [
      `The ${assessment.level} risk assessment recommends ${category} verification.`,
      selection.execution === "automated"
        ? selection.adapter === "axe"
          ? "@axe-core/playwright and Playwright are detected for automated accessibility execution."
          : selection.adapter === "semgrep" || selection.adapter === "gitleaks"
            ? `${selection.adapter} is selected; local executable availability is checked at execution time.`
            : `${selection.adapter} is detected for automated execution.`
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
        (test) => test.framework === selection.testFramework && test.historicalMemoryIds.length > 0,
      )
        ? ["Includes regression tests selected by matched historical QA memory."]
        : []),
    ];
    return {
      adapter: selection.adapter,
      blocking: blocking || category === "security",
      category,
      execution: selection.execution,
      id: `step-${String(index + 1).padStart(2, "0")}-${category}${
        category === "security" ? `-${selection.adapter}` : ""
      }`,
      reasons,
      requirementRefs,
      ...(selection.adapter === "semgrep" || selection.adapter === "gitleaks"
        ? { targetFiles }
        : {}),
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
