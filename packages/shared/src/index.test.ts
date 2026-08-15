import { describe, expect, it } from "vitest";
import { MARU_CONFIG_DIRECTORY, MARU_CONFIG_FILENAME } from "./index.js";

describe("Maru configuration paths", () => {
  it("uses the public CLI naming convention", () => {
    expect(`${MARU_CONFIG_DIRECTORY}/${MARU_CONFIG_FILENAME}`).toBe(".maru/maru.yml");
  });
});
