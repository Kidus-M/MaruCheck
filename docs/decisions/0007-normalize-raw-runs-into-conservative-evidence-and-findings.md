# ADR-007: Normalize raw runs into conservative evidence and findings

## Status

Accepted

## Date

2026-08-17

## Context

Phase 6 records trustworthy execution facts but does not answer the higher-level questions a developer or release gate needs: which requirements have evidence, what failed, whether the failure blocks release, and how to reproduce it.

Raw test output is not itself a complete finding. One adapter invocation may cover several plan steps and requirements, missing tooling does not prove a product defect, and a generated test may already have been removed from the source tree when a report is read. Reporting must preserve these distinctions instead of inventing certainty.

The same result also needs to serve terminal users, MCP coding agents, future CI, and the hosted product without each consumer independently interpreting raw output.

## Decision

Create a dedicated `@maru/evidence` package that converts a `VerificationPlan` and `VerificationRun` into a versioned `VerificationReport`. Persist `report.json` beside the raw `run.json` under `.maru/artifacts/runs/<run-id>/`.

Use one `Evidence` object per raw adapter result. Evidence records its adapter, test categories, status, requirement references, step IDs, test files, duration, exit code, concise diagnostic, and every relevant raw/generated artifact reference. A passed raw result becomes passed evidence, a failed command becomes failed evidence, and error/skipped/unavailable results become inconclusive evidence.

Create a `RequirementEvidence` mapping for every selected requirement or invariant. Status precedence is failed, inconclusive, passed. If no execution result references a selected requirement, create explicit inconclusive `planning-gap` evidence instead of leaving the mapping empty or claiming it passed.

Create findings only for non-passing evidence:

- `requirement-failure` for a completed failing check;
- `execution-error` when an adapter could not complete;
- `verification-gap` for missing, skipped, unavailable, or otherwise inconclusive verification.

Finding language remains conservative. A failed adapter batch is described as a selected check failing while verifying a requirement; it is not presented as proof of a root cause. Diagnostics are short excerpts from bounded raw artifacts, with typed adapter errors as the fallback.

Model blocking findings as a stricter TypeScript union member. Every blocking finding requires contract ID/title, requirement ID/reference, expected statement, actual observation, reproduction command/steps, and evidence IDs. An unlinked raw failure can still block the overall gate through the raw execution policy, but it remains an advisory unlinked finding rather than receiving an invented contract association.

Apply deterministic severity:

- a failed blocking requirement at critical risk is `critical`;
- other blocking requirement failures are at least `high`;
- blocking execution and verification gaps are `high`;
- non-blocking failures are `medium`, with non-blocking gaps `low`.

The gate blocks when the raw run failed or errored, any raw blocking result did not pass, or any blocking finding remains open. A non-blocking incomplete/manual result may remain advisory without forcing a blocked gate.

Generate terminal output from the same typed report that is serialized to JSON. `maru verify --diff` and `maru_run_verification` both use the same plan-run-report orchestration. MCP retains raw run fields while adding the report and its plan/run paths.

## Alternatives considered

### Parse framework output into test-level root causes

Vitest and Playwright output formats vary, and Phase 6 currently executes grouped adapter batches. Treating text parsing as a precise causal model would create false confidence. The report stores a concise observation and preserves links to full raw artifacts.

### Create findings for every raw result, including passes

Passing evidence belongs in requirement coverage, not in the issue list. Findings represent unresolved failure or uncertainty.

### Use an LLM to assign severity and explain failures

This would add nondeterminism, privacy exposure, and offline failure modes. Phase 7 severity and wording are deterministic. AI may later add clearly labeled interpretation without replacing the recorded facts.

### Block only when a finding is linked to a contract

This could allow a failed unlinked test or adapter error to pass the release gate. Raw failed/error states and raw blocking results therefore remain independent gate inputs.

## Consequences

- Terminal, MCP, CI, and future web consumers share one versioned report schema.
- Every blocking finding is structurally complete and requirement-linked.
- Missing verification is visible as inconclusive evidence instead of a pass.
- Generated tests remain reproducible through archived artifact references after source cleanup.
- Severity is predictable and explainable, but intentionally coarse until richer test-level evidence exists.
- Grouped adapter execution limits causal precision; reports must continue using conservative wording until adapters expose reliable per-test structured results.
