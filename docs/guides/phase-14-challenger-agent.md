# Phase 14: Challenger Agent

The Challenger is a second-opinion QA workflow. MaruCheck prepares a bounded brief, the AI client you already use analyzes it in a fresh context, and MaruCheck validates the returned hypotheses. No additional model provider, API key, or MaruCheck network request is required.

The output proposes counterexamples and verification objectives. It does not create findings, modify contracts, execute code, or prove that a defect exists.

## Activation

The domain policy activates a brief when at least one trigger exists:

- deterministic risk is `high` or `critical`;
- a user or MCP client explicitly requests it;
- the operation is marked as release verification.

CLI and MCP preparation are explicit requests, so their briefs are active even for lower-risk work. An internal low/moderate-risk preparation without another trigger remains inactive and cannot be submitted.

## CLI workflow

Prepare the brief:

```bash
maru challenge prepare --diff
maru challenge prepare --diff --release
```

The command writes `.maru/artifacts/challenges/<challenge-id>/brief.json`.

Give that file to a fresh QA thread or subagent without the builder conversation. Ask it to follow `instructions` and return only the object described by `responseSchema`.

The client or user then wraps that result with the identifiers from the brief and truthful provenance:

```json
{
  "schemaVersion": 1,
  "briefId": "challenge-20260820200100000",
  "briefHash": "64-character SHA-256 hash copied from brief.json",
  "provenance": {
    "client": "Codex",
    "model": "client-reported model, if known",
    "isolation": "subagent",
    "attested": true,
    "usage": {
      "inputTokens": 850,
      "outputTokens": 220,
      "totalTokens": 1070,
      "estimatedCostUsd": 0.018
    }
  },
  "result": {
    "summary": "Challenge tenant isolation after authentication.",
    "challenges": [
      {
        "id": "cross-tenant-invoice-read",
        "title": "Cross-tenant invoice read",
        "category": "permission-abuse",
        "priority": "critical",
        "counterexample": "A signed-in user requests an invoice owned by another organization.",
        "whyLikelyMissed": "Authentication-only tests do not prove ownership.",
        "requirementRefs": ["invoice-access#INV-001"],
        "targetFiles": ["src/invoices/read-invoice.ts"],
        "verification": {
          "category": "security",
          "objective": "Prove ownership is enforced after authentication.",
          "steps": ["Create two organizations.", "Attempt a cross-organization read."]
        }
      }
    ]
  }
}
```

`model` and `usage` are optional. If the client does not expose them, omit them; MaruCheck records usage as `not-reported`.

Save the envelope in the project and submit it:

```bash
maru challenge submit \
  --brief .maru/artifacts/challenges/<challenge-id>/brief.json \
  --from challenge-response.json
```

The report is written beside the brief as `report.json`. A brief accepts one report, preventing silent replacement of review provenance.

## MCP workflow

1. Call `maru_prepare_challenge`, optionally with `releaseVerification: true`.
2. Create a fresh thread or subagent without the builder conversation. Give it only the returned brief and request the exact `responseSchema` result.
3. Add the returned brief ID/hash and truthful client provenance.
4. Call `maru_submit_challenge` with `briefPath` and the complete `submission` object.
5. Review the hypotheses and translate relevant objectives into reviewed tests or manual checks.

Clients with subagent support can orchestrate this handoff. In clients without it, open a new conversation manually. MaruCheck records the declared method but cannot technically inspect or prove a host client’s conversation boundary.

Both MCP tools are local-write tools with `openWorldHint: false`; MaruCheck itself makes no model or network call.

## Validation and gate behavior

- The brief hash must match its canonical contents.
- The submission ID and hash must match the selected brief.
- Output must match a closed schema with at most 20 challenge cases.
- Requirement references and target files must already exist in the brief.
- Token totals must match reported input plus output tokens.
- Unknown fields, code/command fields, absolute/escaping paths, symlinks, and files over 1 MB are rejected.
- `attested: true` plus a known isolation method produces a completed, passed Challenger gate.
- Missing attestation or `isolation: "unknown"` produces a durable `unattested`, blocked report.

A passed Challenger gate means the review protocol completed with attested isolation. It does not prove the implementation is correct or that every hypothesis is real.

## Privacy and safety

The brief contains path names, symbols, hunk locations, classifications, risk reasons, selected QA-memory summaries, and selected contract statements. It does not contain changed source lines, repository files, environment values, or credentials.

The user’s AI client controls any disclosure, retention, and model usage involved in its fresh context. MaruCheck only prepares and validates local JSON artifacts. It never executes Challenger output or converts it automatically into a contract change, pass/fail claim, test file, or finding.

See [ADR-013](../decisions/0013-use-client-mediated-isolated-contexts-for-challenger-reasoning.md) for the architecture and trade-offs.
