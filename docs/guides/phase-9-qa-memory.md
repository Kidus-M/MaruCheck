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

## Automatic regression inclusion

`maru plan --diff` and `maru verify --diff` consume the same historical matches. When a recorded regression-test path exists in the current project inventory with the recorded adapter, the planner adds it to affected tests even if ordinary name matching would miss it.

The plan records:

- memory ID, title, severity, and matching reasons;
- available regression-test files;
- missing regression-test files;
- linked contract requirement references;
- `historicalMemoryIds` on every forced affected test.

A missing test stays visible and is not treated as executed.

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

The fixture records a critical invoice IDOR bug, preserves that history and its regression test, later changes invoice authorization code, and succeeds only when the modeled Git change makes risk match `MEM-0001` and the planner automatically includes the recorded cross-account test. Git metadata parsing is covered independently by the Git integration suite so this acceptance remains portable in environments that restrict child processes.

See [ADR-009](../decisions/0009-store-local-qa-memory-as-immutable-records.md) for the decision rationale.
