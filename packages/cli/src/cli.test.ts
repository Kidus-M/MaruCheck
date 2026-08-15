import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";

describe("maru CLI", () => {
  it("prints help without requiring cloud access", () => {
    const output = { error: vi.fn(), log: vi.fn() };

    expect(runCli(["--help"], output)).toBe(0);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining("Usage: maru <command>"));
    expect(output.error).not.toHaveBeenCalled();
  });

  it("rejects unknown commands", () => {
    const output = { error: vi.fn(), log: vi.fn() };

    expect(runCli(["unknown"], output)).toBe(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
  });
});
