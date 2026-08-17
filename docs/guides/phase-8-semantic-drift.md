# Phase 8: Semantic drift guard

The drift guard prevents test maintenance from silently changing approved product meaning.

## Observation file

Create a JSON file linking observed behavior to a contract requirement or invariant:

```json
{
  "observations": [
    {
      "requirementRef": "subscription-management#SUB-001",
      "observed": "Free users may upload 10 files.",
      "source": { "path": "src/subscriptions/limits.ts", "line": 12 }
    }
  ]
}
```

Run the check:

```bash
maru drift check --from observations.json
```

If the approved contract says “Free users may upload 5 files,” the command exits non-zero, reports both statements, and does not modify the contract.

## Protected expectations

Requirements and invariants use stable `contract-id#requirement-id` references. A different observed statement is semantic. Normalized whitespace is ignored, but wording or value changes are not silently treated as formatting.

These maintenance kinds can be declared:

- `selector`
- `dom-structure`
- `route-timing`
- `wait-condition`
- `fixture-setup`

They are mechanical only when the protected expectation remains unchanged. Labeling a quota or authorization change as `selector` cannot bypass the guard.

Approved-contract conflicts block. Draft, review, amended, or deprecated contract conflicts remain visible for review without becoming hard release gates by default.

## Propose an amendment

When the contract itself should change, create a proposal:

```bash
maru drift propose subscription-management \
  --from observations.json \
  --reason "Product approved a larger free quota" \
  --by codex
```

The command writes an immutable file under:

```text
.maru/contracts/.proposals/<contract-id>/<proposal-id>.json
```

It records the base version, observations, rationale, exact semantic changes, proposed contract, eligible owners, and pending approval. The current contract is not changed.

## Approve an amendment

After review, a current contract owner applies the proposal explicitly:

```bash
maru drift approve .maru/contracts/.proposals/subscription-management/<proposal-id>.json \
  --by product
```

Approval fails when:

- the approver is empty or is not a current contract owner;
- the current contract changed after proposal creation;
- the proposal's recorded changes do not match its proposed content;
- the proposal is outside the MaruCheck proposal directory.

Successful approval creates a new immutable contract history snapshot and a separate `.approved.json` audit record.

## MCP tools

Compatible coding agents receive two tools:

- `maru_check_semantic_drift` checks observations without writing files;
- `maru_propose_contract_amendment` writes a pending proposal but never approves it.

There is intentionally no MCP approval tool. Codex, Claude Code, Cursor, and other clients use the same contract and report model, while the final authority remains a separate owner action through the CLI.

See [ADR-008](../decisions/0008-separate-semantic-drift-detection-proposal-and-approval.md) for the decision rationale.
