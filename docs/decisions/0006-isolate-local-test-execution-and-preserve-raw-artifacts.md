# ADR-006: Isolate local test execution and preserve raw artifacts

## Status

Accepted

## Date

2026-08-17

## Context

Phase 6 must turn a Phase 5 verification plan into real Vitest and Playwright runs without adding a cloud dependency, downloading tools during verification, or confusing a test-run failure with an adapter failure. It must also support temporary tests proposed by an agent while preserving the link to the Quality Contract requirements they exercise.

Execution is a trust boundary. Test code can run arbitrary project-local behavior, Playwright can start application processes through project configuration, and raw output may be large. Temporary files must not overwrite user files or remain in the source tree after the run.

Phase 7 will define normalized evidence and findings. Phase 6 therefore needs to retain trustworthy raw inputs without prematurely interpreting failures into product findings.

## Decision

Create a dedicated `@maru/execution` package that consumes a versioned `VerificationPlan`. It groups selected files by adapter and executes each adapter once per run.

Vitest and Playwright are resolved only from the target project's local `node_modules`. They run through the current Node executable with no shell and with CI/non-color environment settings. MaruCheck never downloads a package or browser during `verify`. Missing local tools produce explicit `VITEST_NOT_INSTALLED` or `PLAYWRIGHT_NOT_INSTALLED` results.

Persist every run under `.maru/artifacts/runs/<timestamp>/` with:

- a versioned `run.json` summary;
- bounded stdout and stderr files per adapter;
- the Playwright output directory path;
- archived copies of generated tests;
- adapter, step, test-file, blocking, and requirement-reference metadata.

Keep execution state distinct:

- `passed` and `failed` represent a completed test command;
- `error` represents an adapter that could not start or complete;
- `skipped` represents selected work with no executable tests or manual review;
- `unavailable` represents missing tooling or an unsupported planned adapter.

Any non-passing blocking result increments `blockingFailures`. The CLI exits non-zero for failed/error runs and whenever blocking verification remains incomplete.

Temporary tests require a unique relative target path, a supported test filename, bounded source, and one or more `contract-id#requirement-id` references. MaruCheck writes with exclusive-create semantics, prefixes the source with a requirement tag, archives it, and removes only the files it created in a `finally` block. Existing files are never overwritten.

Expose the same operation as `maru verify --diff` and `maru_run_verification`. MCP clients may provide temporary tests because code execution is the explicit purpose of that tool; its description and write annotations make that behavior visible to approval-aware clients.

## Alternatives considered

### Run package-manager commands with automatic installation

`npx` and similar commands can fetch missing packages. That makes verification depend on the network and can execute an unreviewed package version, so MaruCheck resolves only installed local entry points.

### Execute every selected step separately

This repeats test startup and can run the same file multiple times. Grouping by adapter preserves every step and requirement reference while executing the deduplicated file set once.

### Store temporary tests only under `.maru/`

Project test configurations often restrict discovery to an existing `tests` or source directory. An explicit in-project target works with those configurations; exclusive creation and guaranteed cleanup keep the mutation temporary, while the archived copy remains under `.maru/artifacts`.

### Convert failures directly into findings

That would mix execution with Phase 7 policy and could overstate what raw output proves. Phase 6 records execution facts; the next phase will create evidence mappings and findings.

## Consequences

- Verification stays local, deterministic with respect to installed tools, and compatible with npm, pnpm, or Yarn projects because it does not invoke the package manager.
- Raw artifacts survive after generated source cleanup and remain requirement-linked.
- Test failures, adapter errors, missing tooling, and manual work cannot be mistaken for a pass.
- Playwright browser installation remains a project-owner action; MaruCheck reports its failure output but does not install browsers.
- Output is bounded to protect CLI and MCP consumers; detailed framework-native artifacts remain on disk.
- A crashed operating system can interrupt cleanup. Exclusive creation prevents overwrite, and generated names are visibly MaruCheck-owned for manual recovery.
