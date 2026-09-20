import { describe, expect, it, vi } from "vitest";
import { GitAnalysisError, listPathHistory, parsePathHistory, type GitRunner } from "./index.js";

const LOG_OUTPUT = [
  "\u001e2026-08-28T17:01:03+03:00",
  "",
  "tests/regressions/cross-account.test.ts",
  "src/services/invoices.ts",
  "\u001e2026-08-20T09:00:00+03:00",
  "",
  "tests/regressions/cross-account.test.ts",
  "",
].join("\n");

describe("Git path history", () => {
  it("parses commits and normalized touched paths", () => {
    expect(parsePathHistory(LOG_OUTPUT)).toEqual([
      {
        committedAt: "2026-08-28T14:01:03.000Z",
        paths: ["src/services/invoices.ts", "tests/regressions/cross-account.test.ts"],
      },
      { committedAt: "2026-08-20T06:00:00.000Z", paths: ["tests/regressions/cross-account.test.ts"] },
    ]);
    expect(parsePathHistory("")).toEqual([]);
  });

  it("queries Git directly for the requested paths since a timestamp", async () => {
    const runner: GitRunner = { run: vi.fn().mockResolvedValue(LOG_OUTPUT) };

    const history = await listPathHistory(
      "/repo",
      ["tests/regressions/cross-account.test.ts"],
      "2026-08-18T08:00:00.000Z",
      runner,
    );

    expect(history).toHaveLength(2);
    expect(runner.run).toHaveBeenCalledWith(
      [
        "-c",
        "core.quotePath=false",
        "log",
        "--since=2026-08-18T08:00:00.000Z",
        "--format=%x1e%cI",
        "--name-only",
        "--",
        "tests/regressions/cross-account.test.ts",
      ],
      "/repo",
    );
    await expect(listPathHistory("/repo", [], "2026-08-18T08:00:00.000Z", runner)).resolves.toEqual(
      [],
    );
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it("treats a repository without commits as empty history and reports other failures", async () => {
    const emptyRepository: GitRunner = {
      run: vi.fn().mockRejectedValue(
        Object.assign(new Error("git failed"), {
          stderr: "fatal: your current branch 'main' does not have any commits yet\n",
        }),
      ),
    };
    const broken: GitRunner = { run: vi.fn().mockRejectedValue(new Error("git missing")) };

    await expect(
      listPathHistory("/repo", ["a.ts"], "2026-08-18T08:00:00.000Z", emptyRepository),
    ).resolves.toEqual([]);
    await expect(
      listPathHistory("/repo", ["a.ts"], "2026-08-18T08:00:00.000Z", broken),
    ).rejects.toBeInstanceOf(GitAnalysisError);
    await expect(listPathHistory("/repo", ["a.ts"], "not a date", broken)).rejects.toBeInstanceOf(
      GitAnalysisError,
    );
  });
});
