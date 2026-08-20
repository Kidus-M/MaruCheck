import { describe, expect, it } from "vitest";
import { applyMutation, discoverTypeScriptMutations } from "./transforms.js";

describe("TypeScript mutation transforms", () => {
  const source = `export function canRead(ownerId: string, userId: string, enabled: boolean) {
  if (!enabled) return false;
  if (ownerId !== userId) return false;
  return enabled === true;
}
`;

  it("discovers every Phase 13 transformation with stable source locations", () => {
    const mutations = discoverTypeScriptMutations("src/access.ts", source);

    expect(mutations.map((mutation) => mutation.kind)).toEqual(
      expect.arrayContaining([
        "change-comparison",
        "invert-boolean",
        "remove-guard",
        "remove-ownership-condition",
      ]),
    );
    expect(mutations[0]).toMatchObject({
      column: 3,
      file: "src/access.ts",
      id: "MUT-0001",
      kind: "remove-guard",
      line: 2,
    });
    expect(mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringContaining("ownership guard"),
          kind: "remove-ownership-condition",
        }),
      ]),
    );
  });

  it("applies exactly one syntax-preserving edit to the source snapshot", () => {
    const comparison = discoverTypeScriptMutations("src/access.ts", source).find(
      (mutation) => mutation.kind === "change-comparison" && mutation.original === "!==",
    );
    expect(comparison).toBeDefined();

    const mutated = applyMutation(source, comparison!);

    expect(mutated).toContain("ownerId === userId");
    expect(mutated).toContain("if (!enabled) return false;");
  });

  it("rejects stale offsets instead of editing unexpected source", () => {
    const mutation = discoverTypeScriptMutations("src/access.ts", source)[0]!;

    expect(() => applyMutation(`// shifted\n${source}`, mutation)).toThrowError(
      expect.objectContaining({ code: "MUTATION_SOURCE_CHANGED" }),
    );
  });

  it("does not remove nested guards whose deletion would leave invalid syntax", () => {
    const nested = "if (enabled) if (!authorized) return false;\n";

    expect(discoverTypeScriptMutations("src/nested.ts", nested)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "remove-guard" })]),
    );
  });
});
