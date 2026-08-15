import { describe, expect, it } from "vitest";
import { MARU_PRODUCT } from "./index.js";

describe("MaruCheck product identity", () => {
  it("keeps developer-facing naming stable", () => {
    expect(MARU_PRODUCT).toMatchObject({ command: "maru", name: "MaruCheck" });
  });
});
