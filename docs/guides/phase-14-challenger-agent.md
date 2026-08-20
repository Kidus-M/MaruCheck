# Phase 14: Challenger Agent

The Challenger Agent performs one independent adversarial review of a change and asks what the normal verification plan is most likely to miss. It generates bounded counterexamples and verification objectives; it does not generate findings, modify contracts, execute code, or claim that a defect exists.

## Activation

The domain policy activates the Challenger only when at least one trigger exists:

- deterministic risk is `high` or `critical`;
- the user or MCP client explicitly requests a challenge;
- a provider-enabled CI run marks the operation as release verification.

`maru challenge --diff` is an explicit request, so it always attempts a provider call. Low/moderate-risk internal calls without an explicit or release trigger write a skipped report and make no call.

## Configure a provider-neutral gateway

MaruCheck does not embed a vendor SDK in the verification core. Configure any HTTPS service—or a loopback development service—that implements the JSON protocol below:

```powershell
$env:MARU_REASONING_URL = "https://reasoning.example.com/v1/reason"
$env:MARU_REASONING_PROVIDER = "team-gateway"
$env:MARU_REASONING_MODEL = "independent-challenger"
$env:MARU_REASONING_API_KEY = "replace-with-a-secret"
```

`MARU_REASONING_API_KEY` is optional for an authenticated local gateway. The other three variables are required together. Remote HTTP endpoints, credentials embedded in URLs, partial configuration, and unbounded timeouts are rejected.

The gateway may connect to OpenAI, Anthropic, a local model, or another provider. That translation remains outside the core package so model vendors can change without changing Challenger reports or policy.

### Request

MaruCheck sends one `POST` request with `content-type: application/json` and an optional bearer authorization header:

```json
{
  "schemaVersion": 1,
  "requestId": "challenge-20260820T201500000Z",
  "task": "challenger-analysis",
  "model": "independent-challenger",
  "instructions": "Fixed MaruCheck adversarial-review instructions...",
  "input": {
    "changedFiles": [],
    "historicalRisks": [],
    "requirements": [],
    "risk": {}
  },
  "outputSchema": {},
  "maxCostUsd": 1,
  "maxOutputTokens": 2000
}
```

The exact closed `outputSchema` is included with every request. The input contains bounded change metadata and protected contract intent, not file contents or patch lines.

### Response

Return JSON no larger than 1 MB:

```json
{
  "output": {
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
  },
  "usage": {
    "inputTokens": 850,
    "outputTokens": 220,
    "estimatedCostUsd": 0.018
  }
}
```

Usage values may be `null` when a local gateway cannot calculate them. Unknown cost remains visible as unknown; it is never displayed as zero.

## CLI

```bash
maru challenge --diff
maru challenge --diff --max-cost 0.50 --max-output-tokens 1500
maru challenge --diff --release
```

Limits:

- one provider call per report;
- cost budget: USD 0-100, default USD 1;
- output-token budget: 100-10,000, default 2,000;
- at most 20 challenge cases;
- at most 100 changed files and 100 selected requirement/invariant contexts;
- no changed source contents.

Reports are written beneath:

```text
.maru/artifacts/challenges/<challenge-id>/report.json
```

## MCP

`maru_run_challenger` exposes the same operation to Codex, Claude Code, Cursor, and any compatible MCP client. It accepts optional `maxCostUsd`, `maxOutputTokens`, and `releaseVerification` fields. Its `openWorldHint` is `true` because a configured provider can make an external HTTPS request; normal client tool approval should remain enabled.

Calling the tool is an explicit request. A missing provider therefore returns a durable `unavailable` report with a blocked Challenger gate instead of pretending the review ran.

## Pull-request verification

`maru ci verify` preserves the existing offline path when no reasoning environment is configured. When all required provider variables are present, it runs the Challenger after ordinary verification with the `release-verification` trigger, adds status/provider/cost/token details to the GitHub summary, uploads the report with other `.maru/artifacts`, and fails the check if either gate blocks.

## Status and gate behavior

| Status            | Meaning                                                             | Challenger gate |
| ----------------- | ------------------------------------------------------------------- | --------------- |
| `skipped`         | No allowed trigger exists; no provider call occurred                | Passed          |
| `completed`       | One response passed schema and scope validation                     | Passed          |
| `unavailable`     | An eligible explicit/release run has no provider                    | Blocked         |
| `provider-error`  | The call failed or timed out                                        | Blocked         |
| `invalid-output`  | Output referenced unknown requirements/files or violated the schema | Blocked         |
| `budget-exceeded` | Reported cost exceeded the configured budget                        | Blocked         |

A completed challenge does not prove its counterexamples occur. Review the objectives, create or select suitable tests, then run `maru verify --diff` and, where important, `maru mutate --diff`.

## Privacy and safety

- The configured provider receives path names, symbols, hunk locations, classifications, risk reasons, memory summaries, and selected contract statements.
- It does not receive changed source lines, repository files, environment values, or the API key in the request body.
- Provider output cannot add unknown files or contract references.
- Invalid raw output and provider error details are not copied into the persisted report.
- Hypotheses are not normalized into evidence or findings.
- No model output becomes shell input, executable test code, contract approval, policy change, or semantic amendment.

See [ADR-013](../decisions/0013-isolate-adversarial-reasoning-behind-a-bounded-provider-protocol.md) for the architecture and alternatives.
