/**
 * Contract regression suite. Owned by the humans who own the Quality Contract,
 * kept out of the agent's `npm test` scope, and selected by MaruCheck whenever a
 * change touches usage or quota behavior.
 */
import { describe, expect, it } from "vitest";
import {
  FREE_MONTHLY_GENERATION_LIMIT,
  checkGenerationQuota,
  resolvePlan,
} from "../src/quota.js";

describe("usage-quota#QUOTA-001", () => {
  it("caps the free plan at ten generations per month", () => {
    expect(FREE_MONTHLY_GENERATION_LIMIT).toBe(10);
    expect(checkGenerationQuota({ plan: "free", userId: "u" }, { userId: "u" }, 10).allowed).toBe(
      false,
    );
  });
});

describe("usage-quota#QUOTA-INV-001", () => {
  it("ignores the plan claimed by the client", () => {
    const decision = checkGenerationQuota(
      { plan: "free", userId: "u" },
      { claimedPlan: "pro", userId: "u" },
      10,
    );

    expect(decision.plan).toBe("free");
    expect(decision.allowed).toBe(false);
  });

  it("reads the plan from the stored subscription record", () => {
    expect(resolvePlan({ plan: "free", userId: "u" })).toBe("free");
    expect(resolvePlan({ plan: "pro", userId: "u" })).toBe("pro");
  });
});
