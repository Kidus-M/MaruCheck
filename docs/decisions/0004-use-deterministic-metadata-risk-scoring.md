# ADR-004: Use deterministic metadata-first risk scoring

## Status

Accepted

## Date

2026-08-16

## Context

MaruCheck must decide how aggressively a change should be verified while remaining useful offline and explainable to developers. Phase 4 needs to distinguish sensitive changes such as billing webhooks from presentation-only changes without requiring an AI provider, uploading source code, or presenting an opaque score.

The risk result becomes an input to the Phase 5 verification planner, so score bands and evidence must be stable enough for tests and future release policy.

## Decision

Keep Git collection and risk scoring in separate internal packages. `@maru/git` invokes Git directly without a shell, parses staged and unstaged unified patches, inventories untracked paths, classifies paths, and returns only metadata: paths, statuses, changed-line counts, hunk ranges, symbol names, and classifications. It does not retain changed source lines in its public result.

`@maru/risk` applies additive deterministic factors once per observed category. Factors cover sensitive classifications, change size, file-count blast radius, the highest related Quality Contract criticality, unapproved related intent, missing contract coverage, and production changes without changed tests. Scores are capped at 100 and map to fixed bands: low 0-24, moderate 25-49, high 50-74, and critical 75-100. Every contributing factor returns its points and explanation.

Related contracts are matched from normalized terms in changed paths and detected symbols against contract identifiers, intent, requirements, invariants, edge cases, security rules, and data-integrity rules. The result exposes matched terms plus affected requirement and invariant identifiers.

AI explanation may be added later, but it must describe the deterministic evidence rather than replace or silently alter the score.

## Alternatives considered

### LLM-first scoring

An LLM can infer semantic relationships from source changes, but it adds cost, latency, nondeterminism, privacy concerns, and an offline failure mode. It is unsuitable as the required scoring foundation.

### Full AST and call-graph analysis in Phase 4

AST analysis can improve function and blast-radius detection, but supporting multiple languages correctly would delay the first useful risk loop. Basic path and symbol metadata provides a bounded foundation that can be extended later.

### Put scoring directly in the CLI or MCP server

This would duplicate logic across user interfaces and make the Phase 5 planner depend on transport code. A dedicated package keeps one reusable result model.

## Consequences

- The same score and reasons are available through `maru risk --diff` and MCP.
- Billing webhooks, authorization, migrations, and other sensitive paths receive visibly higher scores than CSS changes.
- Results work without a cloud account or AI provider and can be regression-tested exactly.
- Untracked files are classified by path only until they are staged; their contents are not read for diff metadata.
- Lexical contract matching can produce false positives or miss relationships not expressed in paths or symbols. Later graph, coverage, and QA-memory phases may add evidence without changing the fixed score bands silently.
- Historical regression density, measured test coverage, AI-generated percentage, and configurable risk overrides remain future inputs.
