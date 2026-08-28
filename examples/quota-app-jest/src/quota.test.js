const { FREE_MONTHLY_GENERATION_LIMIT, checkGenerationQuota, resolvePlan } = require("./quota.js");

const free = { plan: "free", userId: "user-1" };
const pro = { plan: "pro", userId: "user-2" };

describe("generation quota", () => {
  it("allows a free user below the monthly limit", () => {
    const decision = checkGenerationQuota(free, { userId: "user-1" }, 3);

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(FREE_MONTHLY_GENERATION_LIMIT - 3);
  });

  it("denies a free user who has spent the monthly limit", () => {
    const decision = checkGenerationQuota(
      free,
      { userId: "user-1" },
      FREE_MONTHLY_GENERATION_LIMIT,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("does not meter pro users", () => {
    const decision = checkGenerationQuota(pro, { userId: "user-2" }, 4000);

    expect(decision.allowed).toBe(true);
    expect(decision.limit).toBeNull();
  });

  it("resolves the plan from the stored subscription", () => {
    expect(resolvePlan(free)).toBe("free");
  });
});
