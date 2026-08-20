import type {
  ChallengeCase,
  ChallengeCategory,
  ChallengePriority,
  ChallengeVerificationCategory,
} from "./model.js";

const CATEGORIES = new Set<ChallengeCategory>([
  "data-integrity",
  "external-failure",
  "input-boundary",
  "invalid-state-transition",
  "permission-abuse",
  "race-condition",
  "replay-attack",
  "timing",
]);
const PRIORITIES = new Set<ChallengePriority>(["critical", "high", "low", "medium"]);
const VERIFICATION_CATEGORIES = new Set<ChallengeVerificationCategory>([
  "api",
  "e2e",
  "integration",
  "manual",
  "security",
  "unit",
]);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

class InvalidChallengeOutputError extends Error {}

function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidChallengeOutputError(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    throw new InvalidChallengeOutputError(`${path} contains unsupported fields.`);
  }
  return record;
}

function string(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new InvalidChallengeOutputError(`${path} must contain 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function stringArray(
  value: unknown,
  path: string,
  options: { readonly maximumItems: number; readonly maximumLength: number; readonly minimumItems?: number },
): string[] {
  if (
    !Array.isArray(value) ||
    value.length < (options.minimumItems ?? 0) ||
    value.length > options.maximumItems
  ) {
    throw new InvalidChallengeOutputError(`${path} has an invalid item count.`);
  }
  const result = value.map((item, index) =>
    string(item, `${path}[${index}]`, options.maximumLength),
  );
  if (new Set(result).size !== result.length) {
    throw new InvalidChallengeOutputError(`${path} contains duplicate values.`);
  }
  return result;
}

export const CHALLENGE_OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    challenges: {
      items: {
        additionalProperties: false,
        properties: {
          category: {
            enum: [...CATEGORIES],
            type: "string",
          },
          counterexample: { maxLength: 2_000, minLength: 1, type: "string" },
          id: { maxLength: 80, minLength: 1, pattern: ID.source, type: "string" },
          priority: { enum: [...PRIORITIES], type: "string" },
          requirementRefs: {
            items: { maxLength: 241, minLength: 3, type: "string" },
            maxItems: 50,
            type: "array",
          },
          targetFiles: {
            items: { maxLength: 500, minLength: 1, type: "string" },
            maxItems: 50,
            minItems: 1,
            type: "array",
          },
          title: { maxLength: 200, minLength: 1, type: "string" },
          verification: {
            additionalProperties: false,
            properties: {
              category: { enum: [...VERIFICATION_CATEGORIES], type: "string" },
              objective: { maxLength: 2_000, minLength: 1, type: "string" },
              steps: {
                items: { maxLength: 1_000, minLength: 1, type: "string" },
                maxItems: 10,
                minItems: 1,
                type: "array",
              },
            },
            required: ["category", "objective", "steps"],
            type: "object",
          },
          whyLikelyMissed: { maxLength: 2_000, minLength: 1, type: "string" },
        },
        required: [
          "category",
          "counterexample",
          "id",
          "priority",
          "requirementRefs",
          "targetFiles",
          "title",
          "verification",
          "whyLikelyMissed",
        ],
        type: "object",
      },
      maxItems: 20,
      type: "array",
    },
    summary: { maxLength: 2_000, minLength: 1, type: "string" },
  },
  required: ["challenges", "summary"],
  type: "object",
} as const;

export function parseChallengeOutput(
  value: unknown,
  allowedRequirementRefs: ReadonlySet<string>,
  allowedFiles: ReadonlySet<string>,
): { readonly challenges: readonly ChallengeCase[]; readonly summary: string } {
  const root = object(value, ["challenges", "summary"], "output");
  if (!Array.isArray(root.challenges) || root.challenges.length > 20) {
    throw new InvalidChallengeOutputError("output.challenges must contain at most 20 items.");
  }
  const ids = new Set<string>();
  const challenges = root.challenges.map((value, index): ChallengeCase => {
    const path = `output.challenges[${index}]`;
    const item = object(
      value,
      [
        "category",
        "counterexample",
        "id",
        "priority",
        "requirementRefs",
        "targetFiles",
        "title",
        "verification",
        "whyLikelyMissed",
      ],
      path,
    );
    const id = string(item.id, `${path}.id`, 80);
    if (!ID.test(id) || ids.has(id)) throw new InvalidChallengeOutputError(`${path}.id is invalid.`);
    ids.add(id);
    if (!CATEGORIES.has(item.category as ChallengeCategory)) {
      throw new InvalidChallengeOutputError(`${path}.category is invalid.`);
    }
    if (!PRIORITIES.has(item.priority as ChallengePriority)) {
      throw new InvalidChallengeOutputError(`${path}.priority is invalid.`);
    }
    const requirementRefs = stringArray(item.requirementRefs, `${path}.requirementRefs`, {
      maximumItems: 50,
      maximumLength: 241,
    });
    if (requirementRefs.some((reference) => !allowedRequirementRefs.has(reference))) {
      throw new InvalidChallengeOutputError(`${path}.requirementRefs contains an unknown reference.`);
    }
    const targetFiles = stringArray(item.targetFiles, `${path}.targetFiles`, {
      maximumItems: 50,
      maximumLength: 500,
      minimumItems: 1,
    });
    if (targetFiles.some((file) => !allowedFiles.has(file))) {
      throw new InvalidChallengeOutputError(`${path}.targetFiles contains a file outside the diff.`);
    }
    const verification = object(
      item.verification,
      ["category", "objective", "steps"],
      `${path}.verification`,
    );
    if (!VERIFICATION_CATEGORIES.has(verification.category as ChallengeVerificationCategory)) {
      throw new InvalidChallengeOutputError(`${path}.verification.category is invalid.`);
    }
    return {
      category: item.category as ChallengeCategory,
      counterexample: string(item.counterexample, `${path}.counterexample`, 2_000),
      id,
      priority: item.priority as ChallengePriority,
      requirementRefs,
      targetFiles,
      title: string(item.title, `${path}.title`, 200),
      verification: {
        category: verification.category as ChallengeVerificationCategory,
        objective: string(verification.objective, `${path}.verification.objective`, 2_000),
        steps: stringArray(verification.steps, `${path}.verification.steps`, {
          maximumItems: 10,
          maximumLength: 1_000,
          minimumItems: 1,
        }),
      },
      whyLikelyMissed: string(item.whyLikelyMissed, `${path}.whyLikelyMissed`, 2_000),
    };
  });
  return { challenges, summary: string(root.summary, "output.summary", 2_000) };
}
