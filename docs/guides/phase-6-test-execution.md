# Phase 6: Test execution adapters

MaruCheck rebuilds the current-diff plan, runs its selected Vitest and Playwright files, and stores raw artifacts locally.

```bash
maru verify --diff
```

During repository development:

```powershell
cd C:\path\to\MaruCheck\maru-cli
npm run build
cd ..\your-project
node ..\maru-cli\packages\cli\dist\index.js verify --diff
```

The command exits non-zero when a test fails, an adapter errors, or blocking work remains incomplete.

## Adapter behavior

| Plan adapter    | Execution                                                                |
| --------------- | ------------------------------------------------------------------------ |
| `vitest`        | Runs deduplicated selected files once with the local Vitest CLI          |
| `playwright`    | Runs deduplicated selected files once with the local Playwright test CLI |
| `manual-review` | Records skipped work that still needs human review                       |
| `unavailable`   | Records unsupported or unconfigured work; never treats it as passing     |

MaruCheck resolves `node_modules/vitest/vitest.mjs` and the local Playwright CLI. It does not call `npx`, download dependencies, install browsers, or use a shell. Install the test framework and Playwright browsers using the package manager and versions chosen by the project.

An automated step with no selected file is `skipped` with `NO_TESTS_SELECTED`. This prevents an apparently successful empty test run.

## Run artifacts

Each run writes a unique directory:

```text
.maru/artifacts/runs/<timestamp>/
|-- run.json
|-- generated/
|-- vitest/
|   |-- stdout.txt
|   `-- stderr.txt
`-- playwright/
    |-- stdout.txt
    |-- stderr.txt
    `-- test-output/
```

`run.json` is schema version 1 and includes the source plan path, run status, adapter results, exit codes, durations, test files, plan step IDs, blocking state, and `contract-id#requirement-id` references. Stdout and stderr capture is bounded; framework-native output remains in its artifact directory.

Phase 6 artifacts are raw execution facts. Phase 7 turns them into normalized evidence and findings in the adjacent `report.json`.

## Generated temporary tests

The library and MCP tool support temporary Vitest or Playwright tests. Each test must provide:

- a lowercase kebab-case ID;
- a new relative `.test.*` or `.spec.*` target path inside the project;
- one or more `contract-id#requirement-id` references;
- bounded source code;
- the target adapter.

MaruCheck prefixes the source with `@maru-requirements`, writes it without overwrite permission, archives a copy with the run, and removes the source-tree copy after execution even when the test fails. A caller cannot replace an existing test through this API.

## MCP

`maru_run_verification` performs the same plan-and-run workflow and returns the raw run plus the Phase 7 report. With no arguments it executes existing selected tests:

```json
{}
```

Compatible MCP clients can also provide `temporaryTests`. This is explicit local code execution, so clients should show their normal write/tool approval UI before calling it.

The MCP server is not Codex-specific. Codex, Claude Code, Cursor, and other clients that support the server's stdio MCP protocol can use the same tool and structured result.

## Acceptance fixture

The repository includes an intentionally broken subscription cancellation implementation. This command generates a tagged temporary Vitest test and succeeds only when MaruCheck detects and blocks the defect:

```bash
npm run test:acceptance:broken-subscription
```

The expected assertion shows that the implementation returned `active` when `cancelled` was required. The generated source file is removed and its archived copy remains in the ignored run-artifact directory.

## Current limits

- Only Vitest and Playwright have automated adapters; other planned adapters remain unavailable or manual.
- Existing-test selection still uses the Phase 5 lexical matcher.
- The default adapter timeout is two minutes.
- Playwright uses the project's own configuration and browser installation.
- Phase 7 now provides evidence normalization, findings, reproduction instructions, and terminal/JSON reports without changing the raw-run schema.

See [ADR-006](../decisions/0006-isolate-local-test-execution-and-preserve-raw-artifacts.md) for the decision rationale.
