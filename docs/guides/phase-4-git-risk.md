# Phase 4: Git diff and risk engine

MaruCheck analyzes the current staged, unstaged, and untracked working-tree changes, then calculates a local deterministic risk score.

```bash
maru risk --diff
```

During repository development, build the CLI and run it from the target project:

```powershell
cd C:\path\to\MaruCheck\maru-cli
npm run build
cd ..\maru-web
node ..\maru-cli\packages\cli\dist\index.js risk --diff
```

The command reports the 0-100 score, risk level, changed-line/file totals, related contracts, every point contribution, and recommended test categories.

## Risk levels

| Score  | Level    |
| ------ | -------- |
| 0-24   | Low      |
| 25-49  | Moderate |
| 50-74  | High     |
| 75-100 | Critical |

Classification factors are applied once per change set rather than once per file. Current base factors include:

| Evidence                                     | Points |
| -------------------------------------------- | -----: |
| Billing, payment, invoice, or subscription   |     30 |
| Authorization or migration                   |     25 |
| Authentication or security-sensitive path    |     20 |
| Database or external integration             |     15 |
| API contract, background job, or dependency  |     12 |
| Production business logic                    |     10 |
| Performance-sensitive path                   |      8 |
| Configuration                                |      5 |
| Observability                                |      4 |
| UI-only change                               |      2 |
| Missing related contract for production code |      8 |
| Production code without a changed test file  |      7 |

Change size contributes up to 15 points and changed-file blast radius contributes up to 15. The highest related contract adds 2, 7, 15, or 25 points for low, medium, high, or critical intent. An unapproved related contract adds 5 points. The final score is capped at 100.

## Change analysis

`@maru/git`:

- inventories staged, unstaged, untracked, deleted, renamed, copied, and conflicted files;
- parses unified hunk ranges and added/deleted line counts;
- detects basic function, class, and callable export names;
- classifies UI, business logic, authentication, authorization, billing, database, migration, integrations, APIs, jobs, configuration, security, performance, observability, dependencies, tests, and documentation;
- invokes `git` directly without a shell.

Changed source lines are used transiently for counts and basic symbol detection but are not retained in the public analysis or MCP response. Untracked files are classified by path only because Git has no patch for them until they are staged.

## Related contracts

The risk engine matches normalized terms from changed paths and symbols against each local Quality Contract. A match returns:

- contract identifier, status, and criticality;
- matched terms;
- affected requirement identifiers;
- affected invariant identifiers.

This is deliberately lexical and deterministic. It does not claim semantic call-graph coverage. Phase 5 consumes this evidence to create an inspectable verification plan.

## MCP tools

- `maru_analyze_diff` returns bounded Git change metadata and classifications.
- `maru_assess_risk` returns the same risk assessment used by `maru risk --diff`.

Both tools are read-only. Coding agents should call `maru_analyze_diff` and `maru_assess_risk` after making changes, then use the related contracts and recommended categories to explain the verification scope.

## Current limits

- No full language AST or call graph is built yet.
- Untracked file contents and binary contents are not inspected.
- Historical regressions, measured coverage, AI-generated-code percentage, and organization risk overrides are not Phase 4 inputs.
- Recommendations are categories; `maru plan --diff` converts them into an inspectable Phase 5 plan, while execution remains Phase 6.

See [ADR-004](../decisions/0004-use-deterministic-metadata-risk-scoring.md) for the design rationale.
