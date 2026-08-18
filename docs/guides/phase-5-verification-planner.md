# Phase 5: Verification planner

MaruCheck converts the current diff, deterministic risk assessment, Quality Contracts, and discovered tests into an inspectable plan.

```bash
maru plan --diff
```

During repository development:

```powershell
cd C:\path\to\MaruCheck\maru-cli
npm run build
cd ..\maru-web
node ..\maru-cli\packages\cli\dist\index.js plan --diff
```

The command writes `.maru/generated/verification-plan.json` and prints risk, selected-requirement, affected-test, step, and uncovered-requirement totals.

## Plan inputs

The planner combines:

- Phase 4 staged, unstaged, and untracked change analysis;
- deterministic risk score and recommended test categories;
- related Quality Contracts and their evidence policies;
- Phase 9 historical QA matches and recorded regression-test paths;
- the project scan's detected frameworks and existing test files.

No cloud account or AI provider is required.

## Plan schema

Schema version 1 includes:

| Field                   | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `risk`                  | Stable score and level used for this plan                             |
| `changeSummary`         | Changed-file and added/deleted-line totals                            |
| `selectedRequirements`  | Related requirements/invariants, blocking status, and selection why   |
| `affectedTests`         | Existing tests matched to change and requirement terms                |
| `historicalRegressions` | Matched memory with available/missing regression files and reasons     |
| `steps`                 | Category, adapter, execution mode, requirements, tests, and reasons   |
| `uncoveredRequirements` | Selected requirement references with no matching existing test        |
| `summary`               | Counts for automated, manual, unavailable, test, and requirement work |

Requirement references use `contract-id#requirement-id`, for example `subscription-management#SUB-001`.

## Requirement selection

For every contract related by the risk engine, the planner selects:

- directly matched requirements;
- directly matched invariants;
- every identifier marked blocking by the contract evidence policy.

Selection does not change or approve contract intent. The generated plan records why each item was selected.

## Affected-test matching

Existing test paths are matched deterministically against normalized terms from changed paths, detected symbols, related contracts, and selected requirement statements. Each affected test records its framework, matched terms, requirement references, and any selecting historical memory IDs.

Matched QA memory additionally forces every available recorded regression-test path into `affectedTests`, even when normal lexical test discovery would miss it. Missing recorded paths remain explicit under `historicalRegressions` and are never treated as executed.

This is targeted lexical matching, not a claim of full call-graph coverage. Requirements without matching tests remain in `uncoveredRequirements`.

## Adapter selection

| Recommended category                        | Selected adapter                                         |
| ------------------------------------------- | -------------------------------------------------------- |
| Unit, API, integration, contract regression | Vitest when detected; otherwise `unavailable`            |
| E2E and accessibility                       | Playwright when detected; otherwise `unavailable`        |
| Security and adversarial edge cases         | `manual-review` until a supported adapter is implemented |

Adapters in a Phase 5 plan describe intended execution. Phase 6 executes Vitest and Playwright steps through `maru verify --diff`. An unavailable step is never counted as successful verification.

## MCP

`maru_create_verification_plan` creates the same plan and writes the same generated artifact as the CLI command. It is marked as a non-destructive local write, so clients using write approvals can ask before creating it.

Recommended coding-agent sequence:

1. Query project context, the relevant contract, and QA memory.
2. Make the requested change.
3. Call `maru_analyze_diff`.
4. Call `maru_assess_risk`.
5. Call `maru_create_verification_plan`.
6. Call `maru_run_verification` after reviewing any generated temporary test source.
7. Review historical regressions, unavailable steps, uncovered requirements, and blocking failures before claiming verification.

## Current limits

- `maru plan --diff` remains inspection-only; `maru verify --diff` performs execution.
- Vitest and Playwright are the planned automated adapters; Jest is detected but not yet executable by MaruCheck.
- Matching is lexical and path-based rather than a complete dependency graph.
- Phase 6 supports temporary generated tests and raw artifacts. Phase 7 adds normalized evidence, findings, reproduction instructions, and a deterministic gate. Phase 9 adds historical regression selection.

See [ADR-005](../decisions/0005-use-versioned-traceable-verification-plans.md) for the decision rationale.
