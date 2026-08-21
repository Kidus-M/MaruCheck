# ADR-005: Use versioned traceable verification plans

## Status

Accepted; generated-artifact tracking policy superseded by ADR-016

## Date

2026-08-16

## Context

The Phase 5 planner must convert change risk, Quality Contracts, and repository test inventory into an inspectable verification strategy. Phase 6 will execute tests, but planning must remain independently reviewable so developers and coding agents can understand why each check was selected before running code.

A list of commands alone would lose the relationship among changed behavior, contract requirements, existing tests, unavailable tooling, and risk policy. An opaque AI-generated plan would also break offline use and reproducibility.

## Decision

Create a dedicated `@maru/planner` package that consumes typed Phase 4 risk output, validated Quality Contracts, and the Phase 1 project scan. Emit a versioned `VerificationPlan` with:

- selected requirements and invariants, including blocking status and selection reasons;
- affected existing tests with matched terms and requirement references;
- one step for every risk-recommended test category;
- explicit adapter, execution mode, blocking state, test files, requirement references, and reasons for every step;
- uncovered requirement references and aggregate counts.

Persist the current plan as stable JSON at `.maru/generated/verification-plan.json`. `maru plan --diff` and `maru_create_verification_plan` use the same orchestration function and schema. ADR-016 supersedes the original decision to version generated plans in Git.

Planner adapter selection is declarative. Vitest and Playwright are selected when detected because they are the first Phase 6 execution adapters. Security and adversarial work remains explicit manual review until supported adapters ship. Missing compatible tooling is represented as `unavailable`; it is never treated as passing evidence.

The planner remains deterministic and offline. AI may later explain or propose additional steps, but cannot silently remove blocking requirements or convert unavailable verification into success.

## Alternatives considered

### Generate and execute in one operation

This would reduce the number of commands but make verification scope difficult to review and couple Phase 5 to unfinished execution adapters.

### Store only terminal text

Terminal output is useful for humans but not stable enough for MCP, CI, future execution, or requirement-to-evidence traceability.

### Select every repository test

Running everything avoids matching errors but ignores change impact, scales poorly, and defeats risk-based verification. The plan instead records targeted matches and makes uncovered scope visible.

### Use an LLM to choose tests and requirements

LLM reasoning can enhance planning later, but making it foundational would add nondeterminism, privacy concerns, and an offline failure mode.

## Consequences

- Developers and agents can inspect the exact verification scope before execution.
- Phase 6 can consume a stable typed plan rather than repeat matching logic.
- Requirement and invariant references remain traceable through later evidence and findings.
- Missing tests or adapters remain visible as uncovered or unavailable work.
- Lexical test matching can miss indirect relationships; later dependency graphs and QA memory may add evidence while preserving the schema contract or explicitly versioning it.
- Plan creation writes a generated project artifact and is therefore a write operation in MCP approval metadata.
