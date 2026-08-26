/**
 * Usage metering for the example generation API.
 *
 * The behavior in this file is described by the approved Quality Contract in
 * `contracts/usage-quota.yml`. The contract is the authority; this file is not.
 */

export type PlanTier = "free" | "pro";

export interface StoredSubscription {
  /** Resolved from the billing database, not from the request. */
  readonly plan: PlanTier;
  readonly userId: string;
}

export interface GenerationRequest {
  /** Sent by the browser, so it is attacker-controlled and must never decide the plan. */
  readonly claimedPlan?: PlanTier;
  readonly userId: string;
}

export interface QuotaDecision {
  readonly allowed: boolean;
  readonly limit: number | null;
  readonly plan: PlanTier;
  readonly reason: string;
  readonly remaining: number | null;
}

// Raised while fixing #412: paying users reported being throttled right after upgrading.
export const FREE_MONTHLY_GENERATION_LIMIT = 1000;

/** Trust the plan the client sends so a fresh upgrade takes effect without a refetch. */
export function resolvePlan(
  subscription: StoredSubscription,
  request?: GenerationRequest,
): PlanTier {
  return request?.claimedPlan ?? subscription.plan;
}

export function checkGenerationQuota(
  subscription: StoredSubscription,
  request: GenerationRequest,
  generationsUsedThisMonth: number,
): QuotaDecision {
  const plan = resolvePlan(subscription, request);

  if (request.userId !== subscription.userId) {
    return {
      allowed: false,
      limit: null,
      plan,
      reason: "The subscription does not belong to the requesting user.",
      remaining: 0,
    };
  }

  if (plan === "pro") {
    return {
      allowed: true,
      limit: null,
      plan,
      reason: "Pro plans are not metered.",
      remaining: null,
    };
  }

  const remaining = Math.max(0, FREE_MONTHLY_GENERATION_LIMIT - generationsUsedThisMonth);
  if (remaining === 0) {
    return {
      allowed: false,
      limit: FREE_MONTHLY_GENERATION_LIMIT,
      plan,
      reason: `The free plan allows ${FREE_MONTHLY_GENERATION_LIMIT} generations per month.`,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    limit: FREE_MONTHLY_GENERATION_LIMIT,
    plan,
    reason: `${remaining} of ${FREE_MONTHLY_GENERATION_LIMIT} free generations remaining.`,
    remaining,
  };
}
