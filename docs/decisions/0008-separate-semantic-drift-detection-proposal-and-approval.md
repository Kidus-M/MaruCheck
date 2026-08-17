# ADR-008: Separate semantic drift detection, proposal, and approval

## Status

Accepted

## Date

2026-08-17

## Context

AI coding agents can repair selectors, waits, fixtures, and other test mechanics. They can also make a failing test pass by changing the expected quota, authorization rule, billing behavior, retention promise, security invariant, or other product meaning. Treating both edits as ordinary test maintenance would let implementation behavior silently replace approved intent.

MaruCheck already distinguishes semantic from mechanical contract-file changes and stores immutable approval snapshots. Phase 8 must extend that boundary to observed behavior and test maintenance without pretending to infer product meaning from arbitrary source code. It must support Codex and other MCP clients while ensuring that the agent which detects a conflict cannot approve its own meaning change through MCP.

## Decision

Create a dedicated `@maru/drift` package with a versioned `SemanticDriftReport`. Callers submit explicit, requirement-linked observations using stable `contract-id#requirement-id` references. The guard compares normalized statements against current requirements and invariants.

Whitespace-only differences are ignored. Selector, DOM structure, route timing, wait-condition, and fixture-setup maintenance is classified as mechanical only when the protected expectation remains identical. Any changed expectation is semantic regardless of its claimed maintenance kind.

Semantic conflicts against approved contracts block the gate. Conflicts against unapproved contracts remain reviewable but do not create a hard gate by default. Unknown references never pass as protected evidence; they are reported for review.

Every conflict presents three explicit paths: mark the implementation as a bug, propose a contract amendment, or investigate. Checking never rewrites a contract.

Store proposals as immutable JSON under `.maru/contracts/.proposals/<contract-id>/`. Each proposal includes:

- base contract version hash;
- observations and proposer rationale;
- exact semantic `ContractChange` records;
- the proposed amended contract;
- eligible contract owners;
- a pending, required approval state.

Applying an amendment is a separate CLI-only action. It requires an explicit current contract owner, rejects a stale base version, verifies that the recorded changes match the proposed content, writes a new immutable approved contract snapshot, updates the current contract, and adds an immutable approval audit record.

Expose read-only `maru_check_semantic_drift` and proposal-only `maru_propose_contract_amendment` MCP tools. Do not expose amendment approval over MCP. This is a deliberate authority boundary, not a protocol limitation.

## Alternatives considered

### Parse arbitrary test and application source to infer changed intent

Framework syntax and domain representations vary too widely for a deterministic first release. Explicit observations are inspectable and keep the trusted boundary small. Later adapters may produce these observations, but they must use the same guard.

### Automatically rewrite the contract when implementation and tests agree

Implementation agreement does not prove intended behavior. A coordinated implementation and test change can still violate pricing, authorization, billing, retention, or security policy.

### Allow MCP clients to approve proposals

This would let the same coding agent propose and authorize a semantic change in one automated loop. Phase 8 requires a separate accountable owner action through the local CLI.

### Block every conflict regardless of contract status

Draft and review contracts are still being shaped. Hard gates apply to approved intent by default, while conflicts in unapproved contracts remain visible and require review before approval.

## Consequences

- The quota change from 5 to 10 is reported as a blocking semantic conflict and leaves the approved contract untouched.
- Mechanical test repairs remain available when expected product meaning is unchanged.
- Every accepted semantic change has a proposal, exact change record, approver, approval time, version hash, and immutable snapshots.
- Contract owners become the approval authority for amendments; ownership metadata must therefore remain accurate.
- MCP agents can detect and propose changes but require a human or separately accountable CLI action to approve them.
- Callers must provide explicit observations until framework-specific observation adapters are implemented.
