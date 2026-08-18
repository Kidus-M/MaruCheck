# ADR-009: Store local QA memory as immutable records

## Status

Accepted

## Date

2026-08-18

## Context

Verification that only considers the current diff and current contract forgets previously discovered failure modes. A missing invoice ownership check may be fixed once, then reintroduced months later by a change in a nearby authorization path. The earlier defect, root cause, and regression test should influence both risk and test selection.

Phase 9 must remain local-first and useful without an account or hosted database. Records need to be inspectable, version-controlled, safe for coding agents, and stable enough for future cloud synchronization. Matching must be explainable and must not rely on an LLM or opaque confidence score.

## Decision

Create a dedicated `@maru/memory` package. Store one schema-versioned immutable JSON record per historical fact under `.maru/memory/MEM-####.json`. Allocate monotonically increasing local IDs with exclusive file creation so concurrent writers cannot overwrite an existing record.

Each record includes:

- type, title, summary, severity, source, and root cause;
- related contract IDs and root-bounded repository paths;
- tags for domain and failure-mode vocabulary;
- zero or more regression tests with stable ID, adapter, project-relative path, and requirement references;
- creation time and active lifecycle status.

Use JSON rather than a second general-purpose YAML parser. Quality Contracts retain their strict YAML format, while memory is commonly created and consumed as structured CLI/MCP data. Validate all untrusted input, reject parent traversal and absolute paths, normalize portable paths, and never rewrite an existing record.

Search records deterministically across IDs, titles, summaries, root causes, tags, contracts, files, and regression tests. Return matched fields, normalized terms, and a stable score.

Match memory to a Git diff through either an exact related-file match or at least two meaningful vocabulary matches across changed paths, symbols, classifications, and record content. Remove generic terms before matching to limit false positives. Include exact paths, matched terms, and textual reasons in every historical-risk result.

Add the highest matched historical severity to the risk score once rather than summing every record. Critical history contributes 25 points. Any history adds contract-regression verification; security history adds security verification; recorded Playwright regressions add E2E verification.

The verification planner must include every matched regression test that exists in the current project test inventory, even when ordinary lexical test discovery would not select it. Plans expose matched memory, available/missing regression files, requirement references, and reasons. Missing recorded tests remain visible instead of being treated as executed.

Expose `maru memory add/list/search/show` locally plus `maru_record_bug` and `maru_query_memory` over MCP. MCP-created records are attributed to `coding-agent`; every client uses the same data model.

## Alternatives considered

### Use a local SQLite or graph database immediately

It would add migrations, binary state, and synchronization complexity before the access patterns justify it. Immutable JSON is reviewable in Git and sufficient for MVP-scale records. A future cloud implementation can project these records into relational tables and explicit edges.

### Match only exact historical file paths

Files are renamed and authorization logic moves. Exact paths remain the strongest signal, but meaningful vocabulary allows `src/services/invoices.ts` history to protect a later `src/services/invoices/authorization.ts` change.

### Use one matching term

A single generic word creates excessive false positives. Requiring two filtered terms when there is no exact path balances recall with explainability for the initial deterministic matcher.

### Automatically generate regression source from a memory summary

That would blur verified history with generated assumptions. Phase 9 links already-reviewed test files. Missing files are reported; future test generation must pass through the existing semantic-drift and temporary-test safeguards.

### Sum risk points for every matched memory

Dense historical areas could reach 100 solely through duplicate or related records. Using the highest severity once preserves a strong signal without rewarding record duplication.

## Consequences

- Confirmed bugs become durable, repository-owned verification context.
- A later invoice authorization change automatically raises risk and includes the cross-account regression test.
- Search and matching remain offline, deterministic, and auditable.
- Memory files should be reviewed and committed like contracts; sensitive payloads and secrets must not be recorded.
- Renames without shared vocabulary may require updating related paths or adding domain tags.
- Record mutation and lifecycle transitions are intentionally deferred; Phase 9 records are append-only and active.
