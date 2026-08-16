import { describe, expect, it, vi } from "vitest";
import { analyzeWorkingTree, parsePorcelainStatus } from "./index.js";

describe("Git working-tree inventory", () => {
  it("parses staged, unstaged, untracked, deleted, and renamed files", () => {
    expect(
      parsePorcelainStatus(
        "M  src/staged.ts\0 M src/unstaged.ts\0?? src/new.ts\0 D src/removed.ts\0R  src/new-name.ts\0src/old-name.ts\0",
      ),
    ).toEqual([
      { indexStatus: "modified", path: "src/staged.ts", worktreeStatus: "unchanged" },
      { indexStatus: "unchanged", path: "src/unstaged.ts", worktreeStatus: "modified" },
      { indexStatus: "untracked", path: "src/new.ts", worktreeStatus: "untracked" },
      { indexStatus: "unchanged", path: "src/removed.ts", worktreeStatus: "deleted" },
      {
        indexStatus: "renamed",
        originalPath: "src/old-name.ts",
        path: "src/new-name.ts",
        worktreeStatus: "unchanged",
      },
    ]);
  });

  it("returns a deterministic summary without invoking a shell", async () => {
    const run = vi.fn().mockResolvedValue("M  src/a.ts\0?? src/b.ts\0");

    await expect(analyzeWorkingTree("C:/project", { run })).resolves.toEqual({
      clean: false,
      files: [
        { indexStatus: "modified", path: "src/a.ts", worktreeStatus: "unchanged" },
        { indexStatus: "untracked", path: "src/b.ts", worktreeStatus: "untracked" },
      ],
      summary: { added: 0, conflicted: 0, deleted: 0, modified: 1, renamed: 0, untracked: 1 },
    });
    expect(run).toHaveBeenCalledWith(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      "C:/project",
    );
  });
});
