# ADR-018: Score QA memory freshness and relevance deterministically

## Status

Accepted

This decision extends [ADR-009](0009-store-local-qa-memory-as-immutable-records.md); it does not
change how records are stored or matched.

## Date

2026-09-20

## Context

QA memory lets a previously confirmed bug influence later risk and verification. ADR-009 made every
matched record contribute its full severity forever. Architectures, contracts, and regression tests
change, so a record can outlive the failure context it describes. Treating that history as equally
relevant turns memory into another source of stale context and unnecessary risk inflation, while
deleting it would destroy the audit trail.

MaruCheck needs to distinguish a failure that is still directly relevant from one whose root cause
no longer exists, without an LLM, an account, a network request, or an opaque score.
Records must remain immutable and preserved regardless of how relevant they become.

## Decision

Attach a deterministic `relevance` result to every historical risk match. Each record starts fully
relevant at 100 and only loses points when local project evidence shows its context changed:

| Signal                     | Evidence                                                  | Penalty                          |
| -------------------------- | --------------------------------------------------------- | -------------------------------- |
| `superseded`               | An active record lists this record in `supersedes`        | 70                               |
| `related-files-present`    | Recorded related files are missing from the working tree  | up to 35, proportional           |
| `regression-tests-present` | Recorded regression test files are missing                | up to 30, proportional           |
| `related-contracts-active` | Related contracts were removed or deprecated              | up to 25, proportional           |
| `regression-tests-changed` | Existing regression tests changed in commits since record | 10, or 20 for three or more      |
| `age`                      | Record age, secondary only                                | 5 after 180 days, 10 after 1 year |

Every signal is skipped when its evidence is not supplied, so a caller without the working tree or
Git history never guesses. Confirmations, including the current change touching an originally
affected file, are reported with zero points so the explanation lists why history still applies.
Scores map to fixed bands: `high` at 70 or above, `medium` from 40 to 69, and `low` below 40.

Risk applies the highest effective historical contribution once: high relevance keeps the full
severity points, medium relevance halves them, and low relevance adds nothing. Low-relevance
matches remain in the assessment under a zero-point `historical-stale` reason, do not add
recommended test categories, and stay in the verification plan with `included: false` so their
regression tests are visible but not forced. Records are never deleted or rewritten because their
relevance dropped.

Supersession is the only new input: a record may list `supersedes` identifiers that must already
exist. The older record stays active and searchable; it is only discounted when matched.

`assessProjectRisk` collects the evidence locally by checking recorded paths on disk and reading
`git log --name-only` for recorded regression tests since the oldest record. A repository without
commits has no history; any other Git failure is reported as a Git analysis error.

## Alternatives considered

### Expire records after a fixed age

Age says little about whether a failure mode still exists. A one-year-old authorization bug behind
an unchanged route is still relevant, and a two-month-old record can be stale after a rewrite. Age
is kept as a small secondary signal only.

### Archive or delete stale records

Silent deletion removes evidence that teams rely on for incident history and audits, and it would
require mutating immutable records. Preserving records with an explainable relevance keeps the
history while limiting its influence.

### Infer supersession from overlapping content

Overlapping paths or tags do not prove that one record replaces another; two records can describe
different defects in the same area. Explicit `supersedes` keeps the decision with the person who
recorded the newer fact.

### Weight relevance with a learned or LLM-provided score

That would violate the deterministic, offline, explainable constraints that every verification run
must satisfy. Fixed penalties and bands can be regression-tested exactly.

## Consequences

- `maru risk --diff`, `maru plan --diff`, and MCP risk results explain each matched record's
  relevance level, score, and signals, and state whether risk was increased.
- Stale history stops distorting scores while remaining searchable and visible in plans.
- Callers of `assessRisk` without local evidence receive high relevance for every match, matching
  prior behavior, until they pass a `memoryContext`.
- Recording a fix that replaces older history should list the older identifiers in `supersedes`.
- Penalty values and bands are public constants; changing them is a scoring change that must be
  documented and regression-tested.
