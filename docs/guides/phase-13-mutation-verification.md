# Phase 13: Mutation verification

Mutation verification checks whether selected tests actually reject meaningful regressions:

```bash
maru mutate --diff
maru mutate --diff --max 8
```

The default limit is 20 mutations and the accepted range is 1–100. The command is explicit; normal `maru verify --diff` does not silently multiply test execution time.

Coding agents using Codex, Claude Code, Cursor, or another compatible MCP client can call `maru_run_mutation_verification` with an optional `maxMutations`. It uses the same local implementation and returns the complete report; no client-specific behavior or cloud execution is required.

## Execution sequence

1. Analyze the current staged, unstaged, and untracked diff.
2. Build the normal requirement-linked verification plan.
3. Discover supported candidates only in changed `.ts` and `.tsx` production files.
4. Create a detached Git worktree under the operating system's temporary directory.
5. Copy current uncommitted file content into that worktree so the tested baseline matches the developer's current implementation.
6. Link the already-installed project `node_modules` directory into the isolated worktree; never install dependencies at runtime.
7. Run selected Vitest, Playwright, and axe tests once against the unmodified baseline.
8. If the baseline passes, apply and run one mutation at a time, restoring the isolated source snapshot after every run.
9. Archive raw run artifacts under `.maru/artifacts/mutations/<timestamp>/` in the original project.
10. Force-remove and unregister the temporary worktree in a `finally` cleanup boundary.

The original source tree is read to create the snapshot but is never used as a mutation target. Normal MaruCheck plan and report artifacts may still be written under the ignored `.maru/` directory.

## Initial TypeScript transformations

| Mutation                   | Example                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| Invert boolean             | `true` → `false`                                                               |
| Change comparison          | `!==` → `===`, `<` → `<=`                                                      |
| Remove guard               | remove an early-return/throw guard                                             |
| Remove ownership condition | remove an ownership, account, tenant, role, permission, or authorization guard |

Transformations are discovered with the TypeScript parser. Each mutant is a single exact source-range replacement. Guard removal is limited to standalone statements inside a source file or block so deletion does not leave syntactically incomplete nested control flow.

## Outcome semantics

- `killed`: at least one selected test failed after applying the mutation. This is strong verification evidence.
- `survived`: all selected tests still passed. MaruCheck reports `WEAK VERIFICATION DETECTED` and blocks.
- `inconclusive`: the adapter errored, was unavailable, or returned no trustworthy test result. This blocks without claiming the mutant survived.

Mutation execution starts only after the unmodified baseline passes. An already-failing or incomplete baseline blocks as inconclusive, because attributing that failure to a mutation would be false evidence.

## Artifacts and cleanup

The mutation report includes candidate locations, bounded original/replacement excerpts, outcomes, result statuses, durations, raw artifact references, gate reasons, and `worktreeCleaned`. Native test output is copied out before the temporary worktree is deleted.

If Git cannot unregister a worktree, MaruCheck removes the verified temporary directory, attempts `git worktree prune`, and returns an actionable cleanup error. It never runs a recursive delete against the repository root.

See [ADR-012](../decisions/0012-isolate-mutation-verification-in-temporary-git-worktrees.md) for the isolation decision.
