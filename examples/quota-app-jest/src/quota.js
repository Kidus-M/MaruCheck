/**
 * Usage metering for the example generation API.
 *
 * The behavior in this file is described by the approved Quality Contract in
 * `contracts/usage-quota.yml`. The contract is the authority; this file is not.
 *
 * @typedef {"free" | "pro"} PlanTier
 * @typedef {{ plan: PlanTier, userId: string }} StoredSubscription
 * @typedef {{ claimedPlan?: PlanTier, userId: string }} GenerationRequest
 * @typedef {{ allowed: boolean, limit: number | null, plan: PlanTier, reason: string, remaining: number | null }} QuotaDecision
 */

/** QUOTA-001: free plan users may perform at most this many generations per calendar month. */
const FREE_MONTHLY_GENERATION_LIMIT = 10;

/**
 * QUOTA-INV-001: the plan tier always comes from the stored subscription record.
 *
 * @param {StoredSubscription} subscription resolved from the billing database
 * @returns {PlanTier}
 */
function resolvePlan(subscription) {
  return subscription.plan;
}

/**
 * @param {StoredSubscription} subscription
 * @param {GenerationRequest} request sent by the browser, so it is attacker-controlled
 * @param {number} generationsUsedThisMonth
 * @returns {QuotaDecision}
 */
function checkGenerationQuota(subscription, request, generationsUsedThisMonth) {
  const plan = resolvePlan(subscription);

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

module.exports = { FREE_MONTHLY_GENERATION_LIMIT, checkGenerationQuota, resolvePlan };
