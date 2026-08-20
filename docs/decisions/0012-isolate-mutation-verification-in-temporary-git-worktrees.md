# ADR-012: Isolate mutation verification in temporary Git worktrees

## Status

Accepted

## Date

2026-08-20

## Context

Mutation verification deliberately introduces incorrect behavior to prove that selected tests detect it. Applying even a reversible mutation in the developer's active checkout creates unacceptable risks: editors and file watchers can observe it, an interrupted process can leave it behind, and Git operations can accidentally stage or commit it. Testing only committed `HEAD` is also incorrect because MaruCheck verifies the current staged, unstaged, and untracked implementation.

Mutation results are trustworthy only when the same selected tests pass before mutation. Otherwise a failed mutant cannot be attributed to the mutation. The process must also distinguish a killed mutation from an unavailable or crashed test adapter.

## Decision

Create a dedicated `@maru/mutation` package and expose it through:

```text
maru mutate --diff [--max N]
```

Expose the same bounded operation as `maru_run_mutation_verification` over the existing client-neutral local stdio MCP server.

Use the TypeScript compiler parser to discover deterministic single-edit candidates in changed production `.ts`/`.tsx` files. Phase 13 supports boolean inversion, comparison changes, standalone guard removal, and ownership/authorization guard removal. Candidate and report text is bounded.

For execution:

- create a detached worktree from `HEAD` in a uniquely allocated operating-system temporary directory;
- overlay every current changed regular file, including uncommitted and untracked content, and mirror deletes/renames;
- reject absolute, escaping, symlink, and non-file change targets;
- link the original already-installed `node_modules` directory into the temporary worktree instead of downloading dependencies;
- filter the ordinary verification plan to selected Vitest, Playwright, and axe test steps;
- require a passing unmodified baseline;
- apply exactly one mutant, run selected tests, archive raw artifacts, and restore the isolated file before continuing;
- force-remove the registered worktree and verify the cleanup target is a MaruCheck-owned directory beneath the operating-system temporary root.

A failed test result kills a mutation. A fully passing run means the mutation survived and blocks with weak-verification evidence. Adapter errors, unavailable work, skipped work, and baseline failures are inconclusive and block without being mislabeled as mutation survival.

Mutation verification remains an explicit command in this phase. It does not run automatically inside every `maru verify --diff`, avoiding an unexpected multiplication of local or CI execution time.

## Alternatives considered

### Edit and restore the active checkout

`finally` restoration cannot protect against process termination, machine failure, editor save hooks, file watchers, or another Git command observing the temporary content. This violates the core guarantee even if the common path restores successfully.

### Use `git stash` around each mutation

Stashing mutates developer Git state, interacts poorly with untracked files and nested work, and can create conflicts during restoration. MaruCheck must not take ownership of the user's stash.

### Mutate a plain copied directory

A copy isolates files but loses a real repository context required by tools and project scripts that query Git metadata. A detached worktree preserves that context while remaining independently disposable.

### Test committed `HEAD` only

That can prove tests against an older implementation rather than the code the user asked MaruCheck to verify. Overlaying current changed files preserves the working-tree scope without editing the active checkout.

### Run every possible mutant

Unbounded mutation sets can be expensive and repetitive. Stable discovery order plus a default cap of 20 makes behavior inspectable; users can explicitly choose 1–100.

## Consequences

- No mutation is written to the developer's source tree or branch.
- Worktree and raw-run cleanup is testable independently from transformation logic.
- Current uncommitted behavior, new tests, and configuration changes are represented in the isolated baseline.
- Projects need Git and already-installed test dependencies; mutation verification never installs packages.
- Surviving mutants produce a precise file, line, transformation, and archived evidence path for strengthening tests.
- Automatic critical-risk mutation policy and hosted mutation visualization can build on this report without weakening the isolation boundary.
