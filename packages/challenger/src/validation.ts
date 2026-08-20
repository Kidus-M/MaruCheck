import {
  CHALLENGE_SUBMISSION_SCHEMA_VERSION,
  ChallengeError,
  type ChallengeCase,
  type ChallengeCategory,
  type ChallengeIsolation,
  type ChallengePriority,
  type ChallengeSubmission,
  type ChallengeUsage,
  type ChallengeVerificationCategory,
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
const ISOLATION = new Set<ChallengeIsolation>([
  "fresh-thread",
  "separate-agent",
  "subagent",
  "unknown",
]);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HASH = /^[a-f0-9]{64}$/u;

function invalid(message: string): never {
  throw new ChallengeError(
    "CHALLENGE_INVALID_SUBMISSION",
    message,
    "Use the brief's published response schema and submit only scoped, structured QA output.",
  );
}

function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !keys.includes(key));
  if (unknown.length > 0)
    return invalid(`${path} contains unsupported fields: ${unknown.join(", ")}.`);
  return record;
}

function string(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    return invalid(`${path} must contain 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function optionalString(value: unknown, path: string, maximum: number): string | undefined {
  return value === undefined ? undefined : string(value, path, maximum);
}

function stringArray(
  value: unknown,
  path: string,
  options: {
    readonly maximumItems: number;
    readonly maximumLength: number;
    readonly minimumItems?: number;
  },
): string[] {
  if (
    !Array.isArray(value) ||
    value.length < (options.minimumItems ?? 0) ||
    value.length > options.maximumItems
  ) {
    return invalid(`${path} has an invalid item count.`);
  }
  const result = value.map((item, index) =>
    string(item, `${path}[${index}]`, options.maximumLength),
  );
  if (new Set(result).size !== result.length) return invalid(`${path} contains duplicates.`);
  return result;
}

function nullableCount(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(`${path} must be a non-negative integer or null.`);
  }
  return value;
}

function nullableCost(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return invalid("submission.provenance.usage.estimatedCostUsd must be 0 to 100 or null.");
  }
  return value;
}

function usage(value: unknown): ChallengeUsage {
  if (value === undefined) {
    return {
      estimatedCostUsd: null,
      inputTokens: null,
      outputTokens: null,
      source: "not-reported",
      totalTokens: null,
    };
  }
  const input = object(
    value,
    ["estimatedCostUsd", "inputTokens", "outputTokens", "totalTokens"],
    "submission.provenance.usage",
  );
  const inputTokens = nullableCount(input.inputTokens, "submission.provenance.usage.inputTokens");
  const outputTokens = nullableCount(
    input.outputTokens,
    "submission.provenance.usage.outputTokens",
  );
  const totalTokens = nullableCount(input.totalTokens, "submission.provenance.usage.totalTokens");
  if (inputTokens !== null && outputTokens !== null && totalTokens !== inputTokens + outputTokens) {
    return invalid(
      "submission.provenance.usage.totalTokens must equal inputTokens plus outputTokens.",
    );
  }
  return {
    estimatedCostUsd: nullableCost(input.estimatedCostUsd),
    inputTokens,
    outputTokens,
    source: "client-reported",
    totalTokens,
  };
}

export const CHALLENGE_RESPONSE_SCHEMA = {
  additionalProperties: false,
  properties: {
    challenges: {
      items: {
        additionalProperties: false,
        properties: {
          category: { enum: [...CATEGORIES], type: "string" },
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

function challengeCases(
  value: unknown,
  allowedRequirementRefs: ReadonlySet<string>,
  allowedFiles: ReadonlySet<string>,
): ChallengeCase[] {
  if (!Array.isArray(value) || value.length > 20)
    return invalid("submission.result.challenges is invalid.");
  const ids = new Set<string>();
  return value.map((entry, index): ChallengeCase => {
    const path = `submission.result.challenges[${index}]`;
    const item = object(
      entry,
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
    if (!ID.test(id) || ids.has(id)) return invalid(`${path}.id is invalid or duplicated.`);
    ids.add(id);
    if (!CATEGORIES.has(item.category as ChallengeCategory))
      return invalid(`${path}.category is invalid.`);
    if (!PRIORITIES.has(item.priority as ChallengePriority))
      return invalid(`${path}.priority is invalid.`);
    const requirementRefs = stringArray(item.requirementRefs, `${path}.requirementRefs`, {
      maximumItems: 50,
      maximumLength: 241,
    });
    if (requirementRefs.some((reference) => !allowedRequirementRefs.has(reference))) {
      return invalid(`${path}.requirementRefs contains an unknown reference.`);
    }
    const targetFiles = stringArray(item.targetFiles, `${path}.targetFiles`, {
      maximumItems: 50,
      maximumLength: 500,
      minimumItems: 1,
    });
    if (targetFiles.some((file) => !allowedFiles.has(file))) {
      return invalid(`${path}.targetFiles contains a file outside the prepared diff.`);
    }
    const verification = object(
      item.verification,
      ["category", "objective", "steps"],
      `${path}.verification`,
    );
    if (!VERIFICATION_CATEGORIES.has(verification.category as ChallengeVerificationCategory)) {
      return invalid(`${path}.verification.category is invalid.`);
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
}

export function parseChallengeSubmission(
  value: unknown,
  allowedRequirementRefs: ReadonlySet<string>,
  allowedFiles: ReadonlySet<string>,
): ChallengeSubmission {
  const root = object(
    value,
    ["briefHash", "briefId", "provenance", "result", "schemaVersion"],
    "submission",
  );
  if (root.schemaVersion !== CHALLENGE_SUBMISSION_SCHEMA_VERSION) {
    return invalid("submission.schemaVersion must be 1.");
  }
  const briefHash = string(root.briefHash, "submission.briefHash", 64);
  if (!HASH.test(briefHash)) return invalid("submission.briefHash must be a SHA-256 hash.");
  const briefId = string(root.briefId, "submission.briefId", 200);
  if (!ID.test(briefId)) return invalid("submission.briefId is invalid.");
  const provenance = object(
    root.provenance,
    ["attested", "client", "isolation", "model", "usage"],
    "submission.provenance",
  );
  if (typeof provenance.attested !== "boolean")
    return invalid("submission.provenance.attested must be a boolean.");
  if (!ISOLATION.has(provenance.isolation as ChallengeIsolation)) {
    return invalid("submission.provenance.isolation is invalid.");
  }
  const result = object(root.result, ["challenges", "summary"], "submission.result");
  return {
    briefHash,
    briefId,
    provenance: {
      attested: provenance.attested,
      client: string(provenance.client, "submission.provenance.client", 100),
      isolation: provenance.isolation as ChallengeIsolation,
      ...(provenance.model === undefined
        ? {}
        : { model: optionalString(provenance.model, "submission.provenance.model", 200) }),
      usage: usage(provenance.usage),
    },
    result: {
      challenges: challengeCases(result.challenges, allowedRequirementRefs, allowedFiles),
      summary: string(result.summary, "submission.result.summary", 2_000),
    },
    schemaVersion: CHALLENGE_SUBMISSION_SCHEMA_VERSION,
  };
}
