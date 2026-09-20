# Phase 9: QA memory

QA memory makes previously confirmed bugs influence later risk and verification plans.

## Record a bug

Create an input file such as `invoice-idor.json`:

```json
{
  "type": "security-regression",
  "title": "Cross-account invoice access",
  "summary": "Users could access another account's invoice by changing invoiceId.",
  "rootCause": "Missing server-side invoice ownership check.",
  "severity": "critical",
  "source": "manual",
  "relatedContracts": ["invoice-access"],
  "relatedFiles": ["src/app/api/invoices/[invoiceId]/route.ts", "src/services/invoices.ts"],
  "regressionTests": [
    {
      "id": "invoice-cross-account-access",
      "adapter": "vitest",
      "path": "tests/regressions/cross-account.test.ts",
      "requirementRefs": ["invoice-access#INV-001"]
    }
  ],
  "tags": ["authorization", "idor", "invoices"]
}
```

Record it:

```bash
maru memory add --from invoice-idor.json
```

MaruCheck writes an immutable versioned record such as `.maru/memory/MEM-0001.json`. Related paths must stay inside the project root. Records should describe confirmed history and must not contain secrets or production payloads.

## List, search, and inspect

```bash
maru memory list
maru memory search "invoice authorization"
maru memory show MEM-0001
```

Search covers IDs, titles, summaries, root causes, tags, contracts, files, and regression-test metadata. Results include matched terms and fields so the match is explainable.

## Historical risk matching

`maru risk --diff` loads active memory automatically. A record matches when:

- the diff touches an exact related file; or
- at least two meaningful terms overlap between changed paths/symbols/classifications and the record.

Generic vocabulary is removed before comparison. The risk report lists matched memory IDs and adds a deterministic historical-regression reason. The highest matched memory severity contributes once; a critical historical defect adds 25 points.

Matched history also recommends contract-regression checks. Security history recommends security checks, and recorded Playwright regressions make E2E verification eligible.

## Freshness and relevance

Historical evidence goes stale: a service is rewritten, a contract is deprecated, a regression test is deleted. Every matched record therefore carries a deterministic `relevance` result before it influences risk or planning. A record starts fully relevant at 100/100 and only loses points when local evidence shows its failure context changed:

| Signal                     | Evidence checked                                            | Penalty                           |
| -------------------------- | ----------------------------------------------------------- | --------------------------------- |
| `superseded`               | a newer record lists this record in `supersedes`            | 70                                |
| `related-files-present`    | recorded `relatedFiles` are missing from the working tree   | up to 35, proportional            |
| `regression-tests-present` | recorded regression test files are missing                  | up to 30, proportional            |
| `related-contracts-active` | related contracts no longer exist or are deprecated         | up to 25, proportional            |
| `regression-tests-changed` | existing regression tests changed in commits since recorded | 10, or 20 for three or more       |
| `age`                      | record age, secondary only                                  | 5 after 180 days, 10 after 1 year |

Scores map to `high` (70 or more), `medium` (40 to 69), and `low` (below 40). Confirmations are listed with zero points so the explanation shows why history still applies. `maru risk --diff` prints the decision for every match:

```text
QA memory MEM-0014: relevance LOW (10/100)
  - Current change matches by shared vocabulary only: authorization, invoice.
  - The originally affected file no longer exists: src/legacy/invoice-service.ts.
  - Related Quality Contract no longer exists: legacy-invoice-service.
  - Recorded regression test no longer exists: tests/legacy/invoice-authorization.test.ts.
  Historical record preserved, but no risk increase applied.
QA memory MEM-0031: relevance HIGH (100/100)
  - Current change modifies an originally affected file: src/services/invoices/authorization.ts.
  - The originally affected file still exists: src/services/invoices/authorization.ts.
  - Related Quality Contract remains active: invoice-access (approved).
  - Recorded regression test still exists: tests/regressions/cross-account.test.ts.
  - Recorded regression test is unchanged since the record was created.
  Risk increased and recorded regression tests are eligible for the verification plan.
```

Risk applies the highest effective historical contribution once: high relevance keeps the full severity points, medium relevance halves them, and low relevance adds nothing. Low-relevance matches stay in the assessment under a zero-point `historical-stale` reason and do not add recommended test categories. Records are never deleted or rewritten because their relevance dropped; `maru memory search` and `maru memory show` keep returning them.

### Superseding older history

When a newer record replaces an older failure context, list the older identifiers:

```json
{
  "title": "Invoice ownership rewrite",
  "supersedes": ["MEM-0001"],
  "...": "remaining fields"
}
```

Every superseded identifier must already exist. `maru memory list` marks superseded records, and a superseded record is discounted only when it matches a diff. The same field is accepted by the `maru_record_bug` MCP tool.

### Evidence sources

`maru risk --diff` checks recorded paths on disk and reads `git log --name-only` for recorded regression tests since the oldest record. A repository without commits simply has no history. Programmatic callers of `assessRisk` pass a `memoryContext` with `existingPaths`, `history`, and `now`; when a field is omitted its signal is skipped rather than guessed, so a bare match without evidence stays fully relevant.

## Automatic regression inclusion

`maru plan --diff` and `maru verify --diff` consume the same historical matches. When a recorded regression-test path exists in the current project inventory with the recorded adapter, the planner adds it to affected tests even if ordinary name matching would miss it.

The plan records:

- memory ID, title, severity, and matching reasons;
- the relevance level, score, and signals, plus `included: false` when low relevance kept the record's tests out of the plan;
- available regression-test files;
- missing regression-test files;
- linked contract requirement references;
- `historicalMemoryIds` on every forced affected test.

A missing test stays visible and is not treated as executed. Low-relevance history is listed for context but its regression tests are not forced into affected tests.

## MCP tools

Compatible clients, including Codex, Claude Code, and Cursor, receive:

- `maru_record_bug` to add an immutable record attributed to `coding-agent`;
- `maru_query_memory` to search history without modifying it.

Both tools use closed schemas and the same local storage as the CLI. The risk and planning tools automatically return historical matches after a record exists.

## Acceptance fixture

Run:

```bash
npm run test:acceptance:invoice-memory
```

The fixture records a high-severity invoice IDOR bug and a critical legacy record whose service, contract, and regression test were all removed, later changes invoice authorization code, and succeeds only when the modeled Git change makes risk match `MEM-0001` with high relevance, the planner automatically includes the recorded cross-account test, and the stale `MEM-0002` is preserved with low relevance without outranking the relevant record. Git metadata parsing is covered independently by the Git integration suite so this acceptance remains portable in environments that restrict child processes.

See [ADR-009](../decisions/0009-store-local-qa-memory-as-immutable-records.md) for the storage and matching rationale and [ADR-018](../decisions/0018-score-qa-memory-freshness-deterministically.md) for the freshness and relevance model.
