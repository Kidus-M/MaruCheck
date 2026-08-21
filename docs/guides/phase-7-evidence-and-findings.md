# Phase 7: Evidence and findings

`maru verify --diff` now produces both a human terminal report and a versioned JSON report:

```bash
maru verify --diff
```

The report is written beside the Phase 6 raw artifacts:

```text
.maru/artifacts/runs/<run-id>/
|-- run.json
|-- report.json
|-- generated/
|-- vitest/
`-- playwright/
```

The command exits non-zero when the report gate is blocked.

## Report model

Schema version 1 contains:

| Field                 | Meaning                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `evidence`            | Normalized adapter results with diagnostics and artifact references |
| `requirementEvidence` | Selected requirements/invariants mapped to supporting evidence      |
| `findings`            | Open product failures, execution errors, and verification gaps      |
| `gate`                | Deterministic passed/blocked status with explicit reasons           |
| `summary`             | Evidence, requirement, finding, and blocking totals                 |
| `artifacts`           | Paths to the source plan, raw run, and JSON report                  |

## Evidence status

| Raw result                          | Evidence status |
| ----------------------------------- | --------------- |
| Completed with exit code 0          | `passed`        |
| Completed with a non-zero exit code | `failed`        |
| Error, skipped, manual, unavailable | `inconclusive`  |

Every evidence object retains adapter, categories, requirement references, plan step IDs, selected test files, duration, exit code, a bounded diagnostic, and raw/generated artifact paths.

When a selected requirement has no execution result, the report creates explicit `planning-gap` evidence. Missing evidence is never converted into a pass.

## Findings

Findings use three kinds:

- `requirement-failure`: a completed selected check failed;
- `execution-error`: the adapter could not complete;
- `verification-gap`: verification was missing or inconclusive.

Every blocking finding contains:

- contract ID and title;
- requirement ID and stable `contract-id#requirement-id` reference;
- the expected contract statement;
- the actual diagnostic or typed adapter observation;
- reproduction command and steps;
- evidence and artifact references.

An unlinked failing result is not assigned to a made-up requirement. It remains advisory, while the raw execution state can still block the gate.

Blocking requirements from a Quality Contract take effect only after the contract is approved.
Draft and review contracts remain visible in planning and evidence, but their proposed blocking
policy produces advisory findings unless an independent risk or security rule requires the check
to block.

## Severity

Severity is deterministic and does not use an LLM:

| Condition                                          | Severity |
| -------------------------------------------------- | -------- |
| Blocking failed requirement at critical risk       | Critical |
| Other blocking requirement failure                 | High     |
| Blocking execution error or verification gap       | High     |
| Non-blocking failed requirement or execution error | Medium   |
| Non-blocking verification gap                      | Low      |

`info` is reserved for later informational findings; passed checks are evidence rather than findings.

## Terminal output

The terminal summary is rendered from the same object written to `report.json`. A blocking finding shows severity, contract, requirement, expected behavior, actual observation, reproduction command, evidence IDs, artifact paths, and the JSON report location.

This avoids separate terminal and machine interpretations drifting apart.

## MCP

`maru_run_verification` returns:

- `path`: JSON report path;
- `report`: structured evidence, mappings, findings, gate, and summary;
- `planPath`: source verification plan;
- `runPath`: raw execution JSON;
- `run`: raw Phase 6 execution result.

Optional requirement-tagged temporary tests remain supported. Codex, Claude Code, Cursor, and other compatible MCP clients receive the same report model.

## Acceptance fixture

Run:

```bash
npm run test:acceptance:broken-subscription
```

The deliberately broken implementation leaves a cancelled subscription `active`. The acceptance command succeeds only when the inner Vitest assertion fails and the resulting report contains one complete critical blocking `SUB-004` finding. The generated temporary test is removed after its archived copy is linked into evidence.

## Current limits

- Diagnostics are conservative excerpts, not framework-specific root-cause analysis.
- One adapter batch can cover several tests and requirements; the report does not claim which individual test caused a batch failure unless the raw adapter provides that structure.
- Finding lifecycle commands and bug reproduction capsules are future work.
- Phase 8 will prevent semantic contract drift; Phase 7 reports against the current contract without amending it.
- Check
  See [ADR-007](../decisions/0007-normalize-raw-runs-into-conservative-evidence-and-findings.md) for the decision rationale.
