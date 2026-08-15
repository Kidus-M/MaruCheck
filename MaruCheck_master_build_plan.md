# ProofLayer — Master Product & Engineering Plan

> **Working name:** ProofLayer  
> **Category:** Independent verification infrastructure for AI-generated software  
> **Primary positioning:** **“Your AI builds the software. ProofLayer proves it works.”**  
> Rename the product later if needed. Treat **ProofLayer** as the internal codename for now.

---

# 0. Instructions to Codex

You are the lead engineer responsible for turning this specification into a production-quality software platform.

This document is the **source of truth** for the product vision, architecture, implementation sequence, engineering standards, and acceptance criteria.

## How to work

1. **Do not attempt to build the entire platform in one giant pass.**
2. Read this entire specification first.
3. Inspect the existing repository before modifying anything.
4. If the repository is empty, initialize it according to the architecture below.
5. Work phase by phase.
6. Keep the application runnable after every meaningful change.
7. Prefer small, testable, reviewable commits/changes.
8. Do not silently remove scope from this document.
9. If a feature belongs to a later phase, create the correct interface/extension point now when useful, but do not prematurely implement large infrastructure.
10. Avoid hard-coding the platform to a single AI provider, test framework, CI provider, or web framework.
11. The verification agent must remain logically independent from the coding agent.
12. Never let an AI agent silently modify the meaning of a Quality Contract.
13. Existing test tools should be **orchestrated**, not reimplemented unnecessarily.
14. Security, auditability, explainability, and deterministic evidence are product requirements, not optional polish.
15. Before declaring a phase complete:
    - run type checks,
    - run linting,
    - run unit tests,
    - run integration tests relevant to that phase,
    - verify migrations,
    - manually exercise the key workflow,
    - document anything intentionally deferred.
16. When something is ambiguous, choose the option that best preserves:
    - local-first operation,
    - vendor neutrality,
    - auditability,
    - deterministic behavior,
    - extensibility,
    - user trust.
17. Do not change product semantics merely to make tests pass.
18. Do not weaken assertions to obtain green test runs.
19. Any auto-healing feature may repair **test mechanics** such as selectors, but never semantic expectations without explicit approval.
20. At the end of each phase, update the repository documentation with:
    - what was implemented,
    - how to run it,
    - known limitations,
    - next phase.

## Immediate implementation instruction

Start by implementing **Phase 0 and Phase 1 only** unless the repository already contains those capabilities.

After Phase 1 works end-to-end, continue through the phases in order.

---

# 1. Product Vision

AI coding agents such as Codex, Claude Code, Cursor, Windsurf, and similar tools are making software implementation dramatically faster.

The new bottleneck is not writing code.

The new bottleneck is:

> **Can we trust what the coding agent produced?**

Traditional automated testing is often:
- written after the implementation,
- generated from the same assumptions as the implementation,
- focused on code coverage instead of product intent,
- fragmented across tools,
- poorly connected to the original requirement,
- unable to remember previous failures and product decisions,
- too expensive for small AI-native teams to maintain manually.

ProofLayer exists to become the **independent verification layer** between product intent and software releases.

The platform should convert product intent into persistent, executable **Quality Contracts**, independently analyze every meaningful code change, determine what is actually at risk, orchestrate the appropriate testing tools, preserve evidence, remember historical failures, and block dangerous regressions.

The core concept is:

```text
                 PRODUCT INTENT
                       |
             +---------+---------+
             |                   |
             v                   v
       CODING AGENT        PROOFLAYER QA
             |                   |
             v                   v
           CODE          QUALITY CONTRACT
             |                   |
             +---------+---------+
                       |
                       v
               INDEPENDENT VERIFY
                       |
              +--------+--------+
              |                 |
              v                 v
            PASS              BLOCK
```

The coding agent creates.

ProofLayer verifies.

Those responsibilities must remain conceptually separate.

---

# 2. Core Product Promise

The primary promise is:

> Give ProofLayer a feature requirement and a code change, and it will determine what could realistically go wrong, execute the appropriate verification strategy, preserve the evidence, and explain whether the implementation still satisfies the intended product behavior.

ProofLayer is **not** primarily:

- an AI Playwright generator,
- a unit-test generator,
- a browser farm,
- a generic CI product,
- another issue tracker,
- another static analyzer,
- a replacement for every QA tool,
- a “make all tests green” bot.

ProofLayer is primarily:

- a product-intent interpreter,
- a persistent quality-contract system,
- a change-risk engine,
- a test-strategy planner,
- a verification orchestrator,
- a QA memory system,
- an evidence and release-gating layer,
- an independent reviewer for AI-generated code.

---

# 3. Product Principles

These principles are non-negotiable.

## 3.1 Intent before implementation

Testing should trace back to what the product is supposed to do, not simply what the current implementation does.

## 3.2 Independent verification

The coding model may provide context, but the QA agent must independently evaluate the implementation against product intent.

## 3.3 Requirement coverage over line coverage

Line coverage is useful telemetry, but ProofLayer's core metric should be:

> Which product requirements and invariants have evidence proving them?

## 3.4 Evidence over confidence theater

Do not display unsupported “98% confidence” claims.

Every quality score should be explainable through evidence such as:
- verified requirements,
- failed requirements,
- test results,
- security findings,
- risk categories,
- historical regressions,
- unresolved ambiguities,
- missing coverage.

## 3.5 Semantics are immutable without approval

ProofLayer may automatically repair:
- selectors,
- waiting behavior,
- non-semantic fixture mechanics,
- harmless test implementation details.

ProofLayer may **not** silently alter:
- expected business behavior,
- authorization rules,
- billing behavior,
- limits,
- invariants,
- security assumptions,
- product requirements.

## 3.6 Local first

The first usable version should work locally.

Teams should be able to run:

```bash
npx prooflayer init
npx prooflayer verify
```

without requiring source code to be permanently uploaded to ProofLayer cloud.

## 3.7 Tool orchestration over unnecessary reinvention

Use existing ecosystems where they are strong:

- Playwright for browser automation,
- Vitest/Jest for JavaScript/TypeScript tests,
- pytest for Python,
- axe for accessibility,
- Semgrep for static security analysis,
- Gitleaks for secret detection,
- Lighthouse for web performance,
- k6 for load/performance tests,
- GitHub Actions for CI,
- existing browser/device clouds through adapters later.

ProofLayer owns the intelligence and evidence layer.

## 3.8 Explainability

A developer should always be able to ask:

> Why did ProofLayer run this test?

and receive a clear answer.

## 3.9 History matters

The system must become more valuable the longer it is installed.

Past:
- bugs,
- incidents,
- regressions,
- flaky tests,
- contract changes,
- risky files,
- security failures

must influence future verification.

## 3.10 Fail safely

When ProofLayer is uncertain about a product semantic, it should ask for explicit approval or mark the result as unresolved.

It should not hallucinate certainty.

---

# 4. Target Users

## 4.1 Primary initial users

Build for:

1. AI-native startups
2. Small engineering teams
3. Solo developers shipping commercial software
4. Software agencies
5. Teams heavily using:
   - Codex
   - Claude Code
   - Cursor
   - Windsurf
   - other coding agents
6. Teams without dedicated QA engineers
7. Teams where developers currently generate their own automated tests using AI

## 4.2 Later users

Later expand toward:

- larger SaaS companies,
- regulated workflows,
- fintech,
- healthcare software,
- enterprise QA teams,
- internal developer platforms,
- platform engineering teams.

---

# 5. Initial Supported Stack

Do not support everything on day one.

The first polished workflow should focus on:

```text
Frontend / Full stack:
- React
- Next.js

Language:
- TypeScript / JavaScript

Source control:
- Git
- GitHub

Testing:
- Playwright
- Vitest / Jest

CI:
- GitHub Actions

App types:
- web applications
- REST APIs
```

Later adapter support:

```text
- Python / pytest
- FastAPI
- Django
- Node / NestJS / Express / Fastify
- GraphQL
- Cypress
- WebdriverIO
- mobile
- Flutter
- React Native
- native iOS
- native Android
- browser/device clouds
```

---

# 6. Recommended Technical Architecture

> **Accepted implementation override (2026-08-15):** MaruCheck uses sibling repositories under one local workspace. The existing repository owns the local CLI, core, contracts, Git, and MCP packages via npm workspaces. The Next.js full-stack hosted application lives in a separate `maru-web` repository. The monorepo layout below remains a conceptual component map, not the Git repository layout. See `docs/decisions/0001-split-cli-and-hosted-application.md`.

Use a TypeScript-first monorepo.

Recommended monorepo tooling:

```text
pnpm
Turborepo
TypeScript
```

Use the current stable versions when implementation begins.

## 6.1 High-level components

```text
                           +----------------------+
                           |      Web Dashboard   |
                           +----------+-----------+
                                      |
                                      v
+-------------+              +--------+---------+
| CLI / MCP   +------------->|   ProofLayer API |
+------+------+              +--------+---------+
       |                              |
       |                              v
       |                     +--------+---------+
       |                     |   Orchestrator   |
       |                     +--------+---------+
       |                              |
       v                              v
+------+-------+             +--------+---------+
| Local Agent |             |  Job / Worker    |
+------+-------+             +--------+---------+
       |                              |
       +----------+-------------------+
                  |
                  v
       +----------+-----------+
       | Verification Engine |
       +----------+-----------+
                  |
    +-------------+-------------+----------------+
    |             |             |                |
    v             v             v                v
Playwright      Vitest       Security       Accessibility
 adapter        adapter       adapters          adapter
```

## 6.2 Suggested repository structure

```text
prooflayer/
|
|-- apps/
|   |-- web/                    # SaaS dashboard
|   |-- api/                    # HTTP API
|   `-- worker/                 # asynchronous cloud verification jobs
|
|-- packages/
|   |-- cli/                    # npx prooflayer
|   |-- mcp-server/             # MCP integration for coding agents
|   |-- core/                   # core domain logic
|   |-- contracts/              # Quality Contract parser/schema/versioning
|   |-- intent/                 # intent graph
|   |-- risk-engine/            # change risk scoring and policies
|   |-- planner/                # verification plan generation
|   |-- executor/               # test plan execution
|   |-- evidence/               # evidence graph and reports
|   |-- memory/                 # QA memory
|   |-- git/                    # git analysis
|   |-- github/                 # GitHub app / PR adapter
|   |-- llm/                    # provider-neutral LLM interface
|   |-- sdk/                    # public SDK
|   |-- shared/                 # common types/utilities
|   |-- adapters/
|   |   |-- playwright/
|   |   |-- vitest/
|   |   |-- jest/
|   |   |-- axe/
|   |   |-- semgrep/
|   |   |-- gitleaks/
|   |   |-- lighthouse/
|   |   `-- k6/
|   `-- ui/                     # shared dashboard components
|
|-- examples/
|   |-- nextjs-demo/
|   `-- intentionally-broken-app/
|
|-- docs/
|   |-- architecture/
|   |-- contracts/
|   |-- integrations/
|   |-- security/
|   `-- contributing/
|
|-- scripts/
|-- .github/
|-- turbo.json
|-- pnpm-workspace.yaml
|-- package.json
`-- README.md
```

---

# 7. Core Domain Objects

The entire system should be built around explicit domain models.

## 7.1 Project

Represents an installed repository/application.

Important fields:

```ts
type Project = {
  id: string
  name: string
  slug: string
  repositoryUrl?: string
  defaultBranch: string
  framework?: string
  language?: string
  createdAt: Date
  updatedAt: Date
}
```

## 7.2 Feature

A logical product capability.

Examples:
- authentication,
- subscriptions,
- invoice download,
- checkout,
- file uploads.

## 7.3 QualityContract

The canonical product-behavior specification.

## 7.4 Requirement

A specific expected behavior.

## 7.5 Invariant

A condition that should never be violated.

Example:

```text
A user may never access another user's invoice.
```

## 7.6 VerificationPlan

The generated strategy for verifying a change.

## 7.7 VerificationRun

One execution of a plan.

## 7.8 Evidence

Proof for or against a requirement.

## 7.9 Finding

A discovered issue.

Severity:

```text
info
low
medium
high
critical
```

## 7.10 QAMemoryRecord

Historical knowledge that should affect future verification.

## 7.11 ContractChange

A semantic modification to product intent.

## 7.12 RiskAssessment

A structured analysis of the blast radius and danger of a change.

---

# 8. The Quality Contract

The **Quality Contract** is the most important product abstraction.

It turns informal product intent into a persistent, version-controlled, machine-readable QA specification.

Contracts live inside the user's repository.

Recommended location:

```text
.prooflayer/
|
|-- prooflayer.yml
|-- contracts/
|   |-- authentication.yml
|   |-- payments.yml
|   |-- subscriptions.yml
|   `-- permissions.yml
|-- policies.yml
|-- memory/
`-- generated/
```

## 8.1 Example contract

```yaml
version: 1

id: subscription-management
title: Subscription Management
status: approved

criticality: high

intent: >
  Free users receive a limited monthly quota.
  Pro users receive unlimited usage.
  Upgrades take effect immediately.
  Cancellations remain active until the end of the paid billing period.

owners:
  - product
  - engineering

requirements:
  - id: SUB-001
    statement: Free users may perform at most 10 generations per billing month.
    priority: required

  - id: SUB-002
    statement: Pro users have no monthly generation limit.
    priority: required

  - id: SUB-003
    statement: A successful upgrade takes effect immediately.
    priority: required

  - id: SUB-004
    statement: Cancellation keeps Pro access active until period_end.
    priority: required

  - id: SUB-005
    statement: A failed payment must never activate Pro access.
    priority: required

invariants:
  - id: SUB-INV-001
    statement: Client-side data must never be accepted as proof of successful payment.

  - id: SUB-INV-002
    statement: Replayed billing webhooks must be idempotent.

edge_cases:
  - payment succeeds but webhook delivery is delayed
  - webhook is delivered twice
  - database update fails after payment succeeds
  - user cancels immediately after upgrading
  - multiple upgrade requests occur concurrently
  - monthly quota resets while the user has an active session

security:
  - verify billing webhook signatures
  - authorization must be enforced server-side
  - users must not be able to modify their plan through client-controlled fields

data_integrity:
  - one active subscription record per user
  - usage count must never become negative
  - duplicate events must not create duplicate subscription state

accessibility:
  required: true
  standard: WCAG-AA

performance:
  requirements:
    - subscription page should remain interactive under normal application load

observability:
  expected_events:
    - subscription_upgraded
    - subscription_cancelled
    - subscription_payment_failed

evidence_policy:
  blocking_requirements:
    - SUB-003
    - SUB-004
    - SUB-005
    - SUB-INV-001
    - SUB-INV-002
```

## 8.2 Contract lifecycle

```text
draft
  |
  v
review
  |
  v
approved
  |
  +-------> amended
  |
  +-------> deprecated
```

Only approved contracts can create hard release gates by default.

## 8.3 Semantic change protection

Contracts must distinguish:

```text
mechanical change
semantic change
```

Examples of mechanical changes:
- typo,
- description formatting,
- test selector implementation.

Examples of semantic changes:
- free quota changes from 10 to 20,
- cancellation behavior changes,
- authorization rule changes,
- retention policy changes.

Semantic changes must require explicit approval.

---

# 9. Product Intent Ingestion

ProofLayer should accept product intent from multiple sources.

Initial sources:

```text
- direct natural language
- Markdown PRD
- GitHub issue
- README / documentation
- existing tests
- API schemas
- user-provided acceptance criteria
```

Later:

```text
- Jira
- Linear
- Notion
- Confluence
- Figma annotations
- Slack
- support tickets
- production incidents
```

## 9.1 Intent normalization pipeline

```text
raw requirement
     |
     v
intent parser
     |
     v
ambiguity detector
     |
     v
requirement candidates
     |
     v
edge-case expansion
     |
     v
security/data-integrity expansion
     |
     v
Quality Contract draft
     |
     v
human approval
```

## 9.2 Requirement ambiguity detection

Before generating tests, ProofLayer should detect statements such as:

```text
"Users should receive notifications quickly."
```

and flag:

```text
Ambiguous term: "quickly"

Please define an acceptable threshold:
- < 1 second
- < 5 seconds
- < 1 minute
- other
```

Do not silently invent critical business semantics.

---

# 10. The Intent Graph

Create a graph representing product semantics and their dependencies.

Example nodes:

```text
Feature
Requirement
Invariant
Route
API Endpoint
Database Table
External Service
Test
Bug
Incident
File
Function
User Role
```

Example relationships:

```text
REQUIREMENT -> IMPLEMENTED_BY -> FUNCTION
REQUIREMENT -> VERIFIED_BY -> TEST
BUG -> VIOLATED -> REQUIREMENT
FILE -> TOUCHES -> FEATURE
FEATURE -> DEPENDS_ON -> EXTERNAL_SERVICE
INVARIANT -> PROTECTED_BY -> POLICY
```

This graph becomes the foundation for:
- impact analysis,
- QA memory,
- requirement coverage,
- risk analysis,
- historical learning.

Do not attempt a specialized graph database during the MVP unless truly required.

Start with relational tables and explicit edges in PostgreSQL.

---

# 11. QA Memory

QA Memory is a core differentiator.

ProofLayer must remember:

```text
- previous bugs
- previous regressions
- production incidents
- security findings
- frequently failing paths
- flaky tests
- contract amendments
- risk overrides
- high-risk files
- sensitive integrations
- previous root causes
```

## 11.1 Example memory record

```yaml
id: MEM-143
type: security_regression

title: Cross-account invoice access

summary: >
  Users could access another user's invoice by modifying invoiceId.

related_contract:
  - invoice-access

related_files:
  - src/app/api/invoices/[invoiceId]/route.ts
  - src/services/invoices.ts

root_cause:
  missing ownership check

severity: critical

regression_tests:
  - invoice-cross-account-access

tags:
  - authorization
  - idor
  - invoices
```

If a later diff touches those files or related authorization code:

```text
HIGH-RISK HISTORICAL AREA

This change affects code related to regression MEM-143.

Automatically adding:
- cross-account access tests
- authorization boundary tests
- IDOR tests
```

## 11.2 Memory ingestion

Memory may come from:

```text
prooflayer memory add
GitHub issue labels
failed verification runs
production incidents
manual team notes
Sentry / observability integrations later
```

---

# 12. Git Diff / Change Impact Analysis

ProofLayer should never blindly rerun every possible test for every change.

It should understand the diff.

Input:

```text
git diff
changed files
changed functions
changed API routes
changed schemas
changed dependencies
changed environment configuration
```

Output:

```text
affected features
affected requirements
affected invariants
likely blast radius
historical risks
recommended test categories
```

## 12.1 Change classification

Classify changes such as:

```text
UI-only
business logic
authentication
authorization
billing
database
migration
external integration
API contract
background job
configuration
security-sensitive
performance-sensitive
observability
dependency upgrade
```

---

# 13. Risk Engine

The Risk Engine determines how aggressively a change should be verified.

Return a score from 0 to 100, but always explain it.

Example dimensions:

```text
+ feature criticality
+ payment involvement
+ auth involvement
+ permissions involvement
+ user data involvement
+ schema migration
+ public API changes
+ dependency changes
+ blast radius
+ historical regression density
+ changed lines / complexity
+ missing requirement coverage
+ low test coverage
+ external integration sensitivity
+ concurrency
+ background jobs
+ AI-generated code percentage if available
```

Example result:

```json
{
  "score": 86,
  "level": "critical",
  "reasons": [
    "Touches payment settlement",
    "Modifies webhook handler",
    "Related area caused 2 previous regressions",
    "Changes subscription state machine",
    "Existing coverage does not verify webhook replay"
  ]
}
```

## 13.1 Risk levels

```text
0-24   low
25-49  moderate
50-74  high
75-100 critical
```

## 13.2 Risk-driven testing

Example:

```text
LOW
- targeted unit tests
- existing affected tests

MODERATE
- unit
- API
- smoke E2E

HIGH
- unit
- API
- E2E
- contract regression
- accessibility/security where relevant

CRITICAL
- all relevant categories
- historical regression suite
- adversarial edge cases
- security checks
- mutation validation
- release block on unresolved findings
```

---

# 14. Verification Planner

The Verification Planner converts:

```text
Quality Contract
+
git diff
+
risk assessment
+
existing tests
+
QA memory
+
repository capabilities
```

into an executable plan.

Example:

```yaml
plan_id: VP-229

risk: critical

requirements:
  - SUB-003
  - SUB-004
  - SUB-005

steps:
  - type: unit
    adapter: vitest
    reason: validate subscription state transitions

  - type: api
    adapter: playwright
    reason: verify server-controlled billing behavior

  - type: e2e
    adapter: playwright
    reason: verify user-visible cancellation flow

  - type: security
    adapter: semgrep
    reason: billing route changed

  - type: regression
    source: qa-memory
    memory_id: MEM-88

  - type: mutation
    target: cancellation period logic
    reason: ensure tests detect semantic regression
```

The user must be able to inspect the plan.

---

# 15. Verification Execution

Use an adapter interface.

Example:

```ts
interface VerificationAdapter {
  id: string
  detect(context: ProjectContext): Promise<boolean>
  plan(input: AdapterPlanInput): Promise<AdapterPlan>
  execute(input: AdapterExecutionInput): Promise<AdapterResult>
}
```

## 15.1 Initial adapters

Implement in this order:

1. Playwright
2. Vitest
3. Jest
4. axe
5. Semgrep
6. Gitleaks
7. Lighthouse
8. k6

## 15.2 Do not lock tests to generated files only

ProofLayer should use:

```text
existing tests
+
generated tests
+
temporary exploratory tests
+
historical regression tests
```

Generated tests should be tagged with their source requirements.

---

# 16. Requirement-to-Evidence Traceability

This is another major differentiator.

Every requirement should show:

```text
Requirement
   |
   +--> unit evidence
   +--> API evidence
   +--> E2E evidence
   +--> security evidence
   +--> production evidence
```

Example dashboard:

```text
SUB-004
Cancellation keeps Pro active until period_end

Evidence:
✓ UNIT    subscription-state.test.ts
✓ API     billing-cancel.spec.ts
✓ E2E     cancel-subscription.spec.ts
✓ HISTORY regression MEM-88
```

Coverage should be expressed as:

```text
Requirement Coverage: 14 / 16 verified
```

not merely:

```text
Line Coverage: 87%
```

---

# 17. Semantic Drift Guard

This feature is mandatory.

ProofLayer must protect product semantics from accidental AI “self-healing.”

## 17.1 Allowed automatic healing

Examples:

```text
selector changed
DOM structure changed
harmless route timing changed
wait condition needs improvement
test fixture setup changed
```

## 17.2 Forbidden silent healing

Examples:

```text
expected quota changed
authorization expectation changed
billing behavior changed
retention period changed
security invariant changed
business rule changed
```

Example warning:

```text
SEMANTIC CONTRACT VIOLATION

Contract:
Free users may upload 5 files.

Observed implementation:
Free users may upload 10 files.

ProofLayer will not update this expectation automatically.

Choose:
[Mark implementation as bug]
[Propose contract amendment]
[Investigate]
```

Any contract amendment must create an auditable ContractChange record.

---

# 18. Adversarial QA Agent

Add an optional **Challenger Agent**.

Its responsibility is not to create normal tests.

It should ask:

> If this implementation is wrong, what would the first QA agent be most likely to miss?

Use it for:
- high-risk changes,
- payments,
- auth,
- permissions,
- financial logic,
- destructive operations.

The challenger should generate:
- counterexamples,
- race conditions,
- permission abuse,
- invalid state transitions,
- replay attacks,
- timing problems,
- inconsistent multi-step workflows.

Do not automatically use multiple expensive model calls for every low-risk change.

---

# 19. Mutation Verification

Test quality must itself be tested.

For important contracts, ProofLayer should be able to intentionally introduce safe temporary mutations such as:

```text
remove authorization check
invert comparison
change quota 10 -> 11
remove idempotency guard
return success on failed payment
```

Then verify that the relevant tests fail.

If a mutation survives:

```text
WEAK VERIFICATION DETECTED

Mutation:
Removed ownership check from invoice access.

Result:
All tests still passed.

Meaning:
Existing verification does not prove invoice ownership isolation.
```

This feature will strongly differentiate ProofLayer from basic test generation systems.

Never commit mutations to the user's branch.

Use temporary worktrees or isolated execution environments.

---

# 20. Counterfactual / Edge-Case Generator

Given a workflow, automatically consider:

```text
What if:
- the request is sent twice?
- the network times out?
- the database write succeeds but external API fails?
- external API succeeds but local persistence fails?
- webhook is delayed?
- webhook is replayed?
- two users race?
- the user refreshes midway?
- the user opens two tabs?
- the job runs twice?
- the process crashes?
- the date changes?
- the timezone changes?
- a limit boundary is reached?
- input is empty?
- input is very large?
- permissions change during the operation?
```

Use product context to avoid producing meaningless edge cases.

---

# 21. State Machine Testing

Many real failures occur in workflows with state.

ProofLayer should infer or allow declaration of state machines.

Example:

```text
subscription:

FREE
  |
  | successful upgrade
  v
PRO_ACTIVE
  |
  | cancel
  v
PRO_CANCELLED_PENDING_EXPIRY
  |
  | period_end
  v
FREE
```

Verify:
- valid transitions,
- invalid transitions,
- duplicate transitions,
- interrupted transitions,
- race conditions.

---

# 22. Data Integrity Verification

Support explicit invariants.

Examples:

```text
balance >= 0
usage >= 0
exactly one active subscription per user
invoice belongs to exactly one account
idempotency key is unique
order total = sum(line items)
```

Where possible:
- test at application level,
- test database constraints,
- test concurrency behavior.

---

# 23. Security Verification

ProofLayer is not a full penetration-testing platform, but security-aware verification is necessary.

Initial categories:

```text
authorization
authentication
IDOR
input validation
secret leakage
unsafe redirects
insecure client trust
webhook verification
dependency risk
SQL injection patterns
XSS patterns
CSRF where relevant
rate limit expectations
privilege escalation
```

Use:
- Semgrep,
- Gitleaks,
- application-level adversarial tests,
- contract invariants.

Later integrate:
- OWASP ZAP,
- SAST vendors,
- dependency scanners,
- enterprise security products.

---

# 24. Accessibility Verification

Use axe initially.

Quality Contracts may declare:

```yaml
accessibility:
  required: true
  standard: WCAG-AA
```

Verification should identify:
- missing labels,
- obvious contrast issues where tooling supports it,
- keyboard navigation failures,
- semantic structure issues,
- inaccessible dialogs/forms.

---

# 25. Performance Verification

Do not make performance testing mandatory for every change.

Use risk-based triggers.

Initial tools:
- Lighthouse for web experience
- k6 for load testing

Contracts may define thresholds:

```yaml
performance:
  checks:
    - metric: api_p95
      max_ms: 500
```

Do not silently invent thresholds.

---

# 26. Visual Verification

Later add:
- screenshot snapshots,
- visual regression,
- AI-assisted visual anomaly explanation.

Important:
visual changes should not automatically change expected snapshots if the visual contract is meaningful.

Require approval for baseline replacement on protected areas.

---

# 27. Exploratory Browser Agent

Later create an agent capable of exploring the application outside predefined tests.

Its goals:

```text
- navigate major workflows
- discover broken states
- inspect forms
- attempt unusual user behavior
- discover console errors
- detect dead links
- detect unexpected redirects
- compare observed behavior to contracts
```

It should create a reproducible trail for every finding.

---

# 28. Bug Reproduction Capsules

Every discovered bug should be reproducible.

Store:

```text
- exact contract violated
- environment
- commit SHA
- route
- input data
- seed
- user role
- browser
- relevant API requests
- screenshots
- logs
- trace
- test generated to reproduce it
```

A developer should be able to run:

```bash
prooflayer reproduce FINDING-123
```

later.

---

# 29. Evidence Bundles

Every VerificationRun should generate an immutable evidence bundle.

Example:

```text
.prooflayer/artifacts/run-abc123/
|
|-- summary.json
|-- findings.json
|-- requirement-coverage.json
|-- risk.json
|-- playwright/
|-- logs/
|-- screenshots/
|-- traces/
`-- provenance.json
```

Cloud mode may upload this bundle.

Local mode should retain it according to policy.

---

# 30. Quality Score

Expose a score for usability, but make it explainable.

Example:

```text
Quality Score: 82 / 100

Breakdown:
Requirements verified       35 / 40
Critical invariants         20 / 25
Regression coverage         10 / 10
Security                    8 / 10
Accessibility               5 / 5
Unresolved ambiguity       -4
Blocking failure           -12
```

Never describe this as a literal probability that the app is correct.

---

# 31. Release Gates / Policy as Code

Create:

```text
.prooflayer/policies.yml
```

Example:

```yaml
release:
  block_on:
    severities:
      - critical
      - high

  require:
    contract_coverage: 90
    critical_contract_coverage: 100

  rules:
    - when:
        risk: critical
      require:
        mutation_check: true
        security_check: true
        adversarial_check: true
```

Policy changes should be version controlled.

---

# 32. Shadow Mode

Teams need a safe adoption path.

Support:

```text
mode: shadow
```

In shadow mode:
- ProofLayer runs,
- findings are reported,
- releases are not blocked.

Later:

```text
mode: enforce
```

This allows teams to establish trust before gating production.

---

# 33. Flaky Test Management

Do not solve flaky tests by silently ignoring them.

Track:
- flake frequency,
- environment,
- last successful run,
- relation to contracts.

Allow:

```text
quarantined
```

but clearly report:

```text
Requirement SUB-003 currently depends on quarantined evidence.
```

Quarantine should reduce quality coverage.

---

# 34. Existing Test Suite Understanding

During initialization, scan:

```text
package.json
test config
Playwright config
Vitest/Jest config
test directories
GitHub Actions
app routes
API routes
database schema
environment variables
```

Build an initial inventory.

Example:

```text
Detected:
Next.js
TypeScript
PostgreSQL
Playwright
Vitest
GitHub Actions

Existing tests:
112 unit
18 E2E

Estimated requirement traceability:
unknown

Recommended:
Create first Quality Contract.
```

---

# 35. CLI

The CLI is a primary product surface.

Command:

```bash
prooflayer
```

or:

```bash
npx prooflayer
```

## 35.1 Commands

### Initialization

```bash
prooflayer init
```

Responsibilities:
- detect stack,
- create `.prooflayer`,
- create default config,
- detect tests,
- optionally configure MCP,
- optionally configure GitHub Actions.

### Diagnose

```bash
prooflayer doctor
```

Checks:
- runtime,
- git,
- test frameworks,
- browser dependencies,
- configuration,
- optional integrations.

### Project scan

```bash
prooflayer scan
```

Produces architecture and test inventory.

### Contracts

```bash
prooflayer contract create
prooflayer contract list
prooflayer contract show <id>
prooflayer contract validate
prooflayer contract diff
prooflayer contract approve <id>
```

### Verification

```bash
prooflayer verify
prooflayer verify --diff
prooflayer verify --feature subscriptions
prooflayer verify --contract subscription-management
prooflayer verify --release
```

### Planning

```bash
prooflayer plan
prooflayer plan --diff
```

### Risk

```bash
prooflayer risk
prooflayer risk --diff
```

### Memory

```bash
prooflayer memory add
prooflayer memory list
prooflayer memory search "authorization"
prooflayer memory show <id>
```

### Findings

```bash
prooflayer findings
prooflayer findings show <id>
prooflayer reproduce <id>
```

### CI

```bash
prooflayer ci init
```

### Login / cloud

```bash
prooflayer login
prooflayer logout
prooflayer sync
```

Cloud authentication must not be mandatory for local-only operation.

---

# 36. MCP Server

MCP support is mandatory because ProofLayer should integrate directly into AI coding workflows.

Suggested tool names:

```text
prooflayer_project_scan
prooflayer_get_project_context
prooflayer_create_contract
prooflayer_validate_contract
prooflayer_list_contracts
prooflayer_get_contract
prooflayer_suggest_missing_requirements
prooflayer_analyze_diff
prooflayer_assess_risk
prooflayer_create_verification_plan
prooflayer_run_verification
prooflayer_verify_feature
prooflayer_verify_diff
prooflayer_verify_release
prooflayer_explain_finding
prooflayer_list_findings
prooflayer_record_bug
prooflayer_query_memory
prooflayer_requirement_coverage
prooflayer_propose_contract_change
```

Important:

`prooflayer_propose_contract_change` may create a proposal.

It must not automatically approve a semantic change.

## 36.1 Ideal coding-agent workflow

```text
User:
Add subscription cancellation.

Coding agent:
1. Reads existing contract.
2. Implements feature.
3. Calls prooflayer_analyze_diff.
4. Calls prooflayer_verify_feature.
5. Receives blocking finding.
6. Fixes implementation.
7. Calls verification again.
8. Reports evidence to user.
```

ProofLayer should return structured machine-readable responses plus concise human explanations.

---

# 37. GitHub Integration

Initial GitHub flow:

```text
Pull Request opened
      |
      v
ProofLayer reads diff
      |
      v
Risk assessment
      |
      v
Verification plan
      |
      v
Execute relevant checks
      |
      v
Post PR check
```

Example PR summary:

```text
PROOFLAYER QA

Overall score: 91/100
Risk: HIGH

✓ Functional requirements
✓ Regression checks
✓ Authorization boundaries
✓ Accessibility
✗ Edge-case verification

BLOCKING FINDING

SUB-004 violated:
Cancellation immediately sets plan = FREE.

Expected:
PRO until period_end

Actual:
FREE immediately

Likely code:
src/services/subscription.ts:183

Reproduction:
prooflayer reproduce FINDING-92
```

Implement initially through GitHub Actions.

A dedicated GitHub App can come later.

---

# 38. Web Dashboard

The dashboard should not be a generic analytics page.

Primary screens:

## 38.1 Projects

Show:
- connected projects,
- recent runs,
- risk,
- unresolved findings.

## 38.2 Project Overview

Show:
- current quality score,
- requirement coverage,
- active contracts,
- recent regressions,
- high-risk areas,
- latest verification.

## 38.3 Contracts

View:
- contract list,
- requirement hierarchy,
- semantic version history,
- approval state,
- evidence mapping.

## 38.4 Verification Runs

View:
- run status,
- commit SHA,
- diff summary,
- plan,
- evidence,
- findings,
- artifacts.

## 38.5 QA Memory

Searchable history of:
- bugs,
- incidents,
- risky areas,
- previous regressions.

## 38.6 Requirement Coverage

Visualize:

```text
Feature -> Requirement -> Evidence
```

## 38.7 Risk Map

Show files/features with:
- historical failure density,
- critical contracts,
- sensitive dependencies.

## 38.8 Team / Policies

Later:
- role permissions,
- release policies,
- contract approvers.

---

# 39. API Design

Use REST initially unless the implementation strongly benefits from another approach.

Example endpoints:

```text
POST   /v1/projects
GET    /v1/projects/:id

POST   /v1/projects/:id/scan

GET    /v1/projects/:id/contracts
POST   /v1/projects/:id/contracts
GET    /v1/contracts/:id
POST   /v1/contracts/:id/approve

POST   /v1/projects/:id/risk-assessments

POST   /v1/projects/:id/verification-plans
POST   /v1/projects/:id/verification-runs
GET    /v1/verification-runs/:id

GET    /v1/projects/:id/findings
GET    /v1/findings/:id

POST   /v1/projects/:id/memory
GET    /v1/projects/:id/memory

GET    /v1/projects/:id/requirement-coverage
```

Use versioned APIs.

---

# 40. Database Model

Use PostgreSQL.

Suggested tables:

```text
users
organizations
organization_members
projects
repositories
features

quality_contracts
quality_contract_versions
requirements
invariants
contract_changes

intent_nodes
intent_edges

risk_assessments

verification_plans
verification_plan_steps
verification_runs
verification_step_runs

evidence
requirement_evidence

findings
finding_occurrences

qa_memory_records
qa_memory_links

test_inventory
test_cases
test_requirement_links

artifacts

integrations
api_keys
audit_logs
```

Use migrations from the beginning.

---

# 41. LLM Provider Abstraction

Never hard-code the architecture to one model provider.

Interface:

```ts
interface ReasoningProvider {
  generateStructured<T>(
    request: StructuredReasoningRequest<T>
  ): Promise<T>

  generateText(
    request: TextReasoningRequest
  ): Promise<string>
}
```

Providers can later include:
- OpenAI
- Anthropic
- local models
- enterprise gateways

Use structured schemas for outputs whenever possible.

Validate all model outputs.

Treat model responses as untrusted input.

---

# 42. Context Minimization

Do not upload an entire repository unnecessarily.

Build context bundles from:

```text
relevant contract
git diff
affected source files
related tests
API schemas
dependency graph
QA memory
```

Allow organizations to configure privacy policies.

Future:
- fully local inference mode,
- BYO provider,
- enterprise no-retention mode.

---

# 43. Security Architecture

ProofLayer will execute code and inspect repositories.

Treat this as high risk.

## 43.1 Local execution

Prefer local execution during MVP.

Never run arbitrary project commands automatically without:
- configuration,
- allowlisting,
- clear visibility.

## 43.2 Cloud execution

When introduced:
- isolate each run,
- use ephemeral containers,
- no cross-project filesystem access,
- short-lived secrets,
- redact logs,
- limit outbound network where possible,
- destroy environment after run.

## 43.3 Secrets

Never store project secrets in plaintext.

Use environment-level secret injection.

Add secret redaction to:
- logs,
- evidence,
- model context,
- artifacts.

## 43.4 Audit logs

Audit:
- contract approvals,
- policy changes,
- integration changes,
- release-gate overrides,
- semantic amendments.

---

# 44. Provenance

Every finding should know:

```text
which commit
which contract version
which risk model version
which planner version
which tool version
which model/provider
which tests
which evidence
```

This is essential for trust and debugging.

---

# 45. Standout Feature: Independent Builder/Verifier Separation

ProofLayer should explicitly track whether the verification model is the same as the builder when information is available.

Later allow policy:

```yaml
independence:
  require_separate_provider_for:
    - critical
```

Example:

```text
Builder:
Codex

Verifier:
Anthropic model

Challenger:
OpenAI model
```

This should remain optional because cost matters, but it is a strong enterprise feature.

---

# 46. Standout Feature: Specification Gap Detection

Before implementation, ProofLayer should identify missing product decisions.

Example requirement:

```text
Users can delete their account.
```

ProofLayer asks:

```text
What happens to:
- active subscriptions?
- invoices?
- uploaded files?
- active sessions?
- audit logs?
- legal retention records?
```

The output is not necessarily tests.

It is a list of unanswered decisions.

This moves ProofLayer upstream into product quality, not only post-code testing.

---

# 47. Standout Feature: Change Intent Confirmation

When a diff changes observed behavior that conflicts with the contract:

```text
Implementation behavior changed.

Was this:
A. an intentional product change
B. a bug
C. an incomplete migration
```

If intentional:
- create contract-change proposal,
- show affected requirements,
- show tests that must change,
- require approval.

This prevents accidental requirements drift.

---

# 48. Standout Feature: Historical Risk Heatmap

Build a heatmap from:

```text
files
features
requirements
bugs
incidents
failed runs
```

Example:

```text
src/auth/*               critical
src/billing/webhook.ts   critical
src/profile/avatar.ts    moderate
src/marketing/*          low
```

The Risk Engine should incorporate this.

---

# 49. Standout Feature: Trust Boundary Map

Infer or declare major trust boundaries:

```text
browser -> API
API -> database
API -> payment provider
webhook -> server
worker -> external storage
admin -> privileged API
```

For each boundary, track:
- authentication,
- authorization,
- validation,
- replay/idempotency,
- failure behavior.

This is particularly useful for AI-generated integrations.

---

# 50. Standout Feature: Temporal Workflow Testing

Many applications depend on time.

Examples:
- subscription expiration,
- delayed jobs,
- scheduled emails,
- password reset expiry,
- rate limits,
- billing periods.

Quality Contracts should support:

```yaml
time:
  use_fake_clock: true
```

Verification should test:
- before boundary,
- exactly at boundary,
- after boundary.

---

# 51. Standout Feature: Production Feedback Loop

Later integrate:
- Sentry
- Datadog
- PostHog
- OpenTelemetry
- application logs

When production detects:

```text
new error after deploy
```

ProofLayer should:
1. link the error to the release,
2. associate it with relevant contracts,
3. create QA Memory,
4. attempt reproduction,
5. generate a regression test,
6. require it in future verification.

This creates a flywheel:

```text
production failure
     |
     v
QA Memory
     |
     v
new regression evidence
     |
     v
future prevention
```

---

# 52. Standout Feature: Verification Debt

Track requirements that exist but lack strong evidence.

Example:

```text
Verification Debt

7 requirements only have unit tests
3 security invariants have no automated evidence
2 critical requirements depend on flaky tests
```

This is more valuable than generic technical debt for QA.

---

# 53. Standout Feature: Quality Budget

Allow teams to define how much verification is appropriate.

Example:

```yaml
budgets:
  pull_request:
    max_minutes: 8

  release:
    max_minutes: 30
```

Planner should optimize within budget based on risk.

---

# 54. Standout Feature: Evidence Freshness

Evidence becomes stale.

Example:

```text
SUB-004 last verified:
37 commits ago

Affected code changed:
4 times

Status:
STALE
```

Requirement coverage should consider evidence freshness.

---

# 55. Standout Feature: Contract Ownership

Allow requirements to have explicit owners.

Example:

```yaml
owners:
  product: alice
  engineering: bob
  security: security-team
```

High-impact semantic changes can require correct owner approval.

---

# 56. Local Configuration

Example:

```yaml
# .prooflayer/prooflayer.yml

version: 1

project:
  name: example-app

mode: shadow

test:
  unit:
    framework: vitest
  e2e:
    framework: playwright

risk:
  historical_memory: true

llm:
  provider: auto

security:
  redact_secrets: true

contracts:
  directory: .prooflayer/contracts

artifacts:
  directory: .prooflayer/artifacts
```

---

# 57. UX Requirements

The product should feel like a developer tool, not enterprise bureaucracy.

Principles:
- fast local startup,
- excellent terminal output,
- readable diffs,
- useful error messages,
- minimal configuration,
- transparent reasoning,
- copyable reproduction commands.

Example:

```text
$ prooflayer verify --diff

Scanning change...
Affected feature: Subscription Management
Risk: HIGH (78/100)

Why:
  + billing state transition changed
  + webhook handler touched
  + previous regression in this feature

Planning verification...
  4 existing tests
  3 generated checks
  1 historical regression
  1 security check

Running...

PASS  SUB-003 Immediate upgrade
FAIL  SUB-004 Cancellation period
PASS  SUB-005 Failed payment isolation

BLOCKED

Finding: FIND-229

Cancellation removes Pro access immediately.

Reproduce:
prooflayer reproduce FIND-229
```

---

# 58. Error Handling

Every internal component should use typed errors.

Never return generic:

```text
Something went wrong.
```

Include:
- category,
- operation,
- safe details,
- remediation.

Example:

```text
PLAYWRIGHT_NOT_INSTALLED

ProofLayer detected an E2E plan but Playwright is unavailable.

Fix:
pnpm add -D @playwright/test
```

---

# 59. Observability for ProofLayer Itself

Implement structured logging.

Track:
- command duration,
- adapter duration,
- model latency,
- model token usage,
- test execution duration,
- failure categories,
- planner decisions.

Never log secrets.

Cloud platform later:
- OpenTelemetry,
- traces,
- metrics.

---

# 60. Testing ProofLayer

ProofLayer itself needs excellent QA.

## 60.1 Unit tests

Required for:
- contract parser,
- schema validation,
- semantic diff,
- risk engine,
- planner,
- policy evaluation,
- memory matching.

## 60.2 Integration tests

Required for:
- CLI init,
- Playwright adapter,
- Vitest adapter,
- Git diff analysis,
- MCP tools.

## 60.3 End-to-end fixtures

Create intentionally broken sample apps.

Examples:

```text
bug: missing authorization
bug: duplicate webhook side effect
bug: wrong subscription cancellation
bug: hidden client-side trust
bug: quota off-by-one
```

ProofLayer's test suite should verify that ProofLayer catches them.

This is extremely important.

---

# 61. Benchmark Suite

Create an internal benchmark:

```text
prooflayer-bench/
```

Each benchmark contains:
- requirement,
- valid implementation,
- intentionally buggy variants,
- expected findings.

Measure:

```text
critical bug detection rate
false positive rate
requirement traceability
execution time
verification cost
```

This should eventually become one of the company's most important internal assets.

---

# 62. False Positive Control

A QA product that constantly cries wolf will be removed.

Every finding should have:

```text
severity
contract violated
reproduction
actual behavior
expected behavior
evidence
```

For uncertain findings:

```text
status: needs-review
```

not:

```text
critical bug
```

without evidence.

---

# 63. Finding Lifecycle

```text
open
confirmed
fixed
false-positive
accepted-risk
deferred
```

If marked false-positive, use the feedback carefully.

Do not automatically weaken the contract.

---

# 64. Collaboration

Later support comments and assignment.

Example:

```text
FIND-229
Assigned: @developer
Contract owner: @product
Status: confirmed
```

Keep MVP simple.

---

# 65. Billing Architecture

Do not make billing part of the MVP core.

Prepare plan tiers:

```text
FREE / OPEN SOURCE
- local CLI
- contracts
- basic verification
- MCP
- local evidence

PRO
- cloud history
- PR reporting
- QA memory sync
- advanced planning
- managed model execution

TEAM
- shared policies
- team memory
- approval workflows
- dashboards
- parallel execution
- integrations

ENTERPRISE
- SSO
- audit controls
- private execution
- BYO model
- policy enforcement
- enterprise integrations
```

Do not implement artificial feature gates before the product proves value.

---

# 66. Phase 0 — Repository Foundation

> **Repository scope:** In this repository, Phase 0 applies to the CLI and local verification packages. The web dashboard and hosted API are maintained in the sibling `maru-web` repository. npm workspaces replace pnpm/Turborepo for this repository per ADR-001.

Goal:
Create a clean, maintainable monorepo.

## Tasks

1. Initialize pnpm workspace.
2. Configure Turborepo.
3. Configure TypeScript.
4. Configure linting.
5. Configure formatting.
6. Configure Vitest for packages.
7. Create package boundaries.
8. Add GitHub Actions for:
   - install,
   - lint,
   - typecheck,
   - test.
9. Create `apps/web`.
10. Create `apps/api`.
11. Create packages:
    - shared
    - core
    - contracts
    - git
    - cli
    - mcp-server
12. Add README.
13. Add architecture docs.
14. Add contribution instructions.

## Acceptance criteria

```text
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

all succeed.

---

# 67. Phase 1 — Local CLI + Repository Scanner

Goal:

A developer can enter an existing Next.js/React project and run:

```bash
npx prooflayer init
```

## Implement

### Stack detector

Detect:
- package manager,
- framework,
- language,
- Playwright,
- Vitest,
- Jest,
- GitHub Actions,
- common database libraries,
- source directories,
- test directories.

### Init command

Create:

```text
.prooflayer/
|-- prooflayer.yml
|-- contracts/
|-- artifacts/
`-- memory/
```

### Scan command

Generate:
- project inventory,
- routes where detectable,
- tests,
- package dependencies,
- CI configuration,
- source summary.

Store:

```text
.prooflayer/generated/project-scan.json
```

### Doctor command

Verify dependencies.

## Acceptance criteria

On the sample Next.js app:

```bash
prooflayer init
prooflayer scan
prooflayer doctor
```

must work.

No cloud account required.

---

# 68. Phase 2 — Quality Contracts

Goal:

Users can create, validate, version, and inspect Quality Contracts.

## Implement

1. YAML schema.
2. Zod or equivalent validation.
3. Contract parser.
4. Contract list.
5. Contract show.
6. Contract validate.
7. Contract semantic diff.
8. Contract version hash.
9. Contract approval metadata.
10. Example contracts.

Commands:

```bash
prooflayer contract create
prooflayer contract validate
prooflayer contract list
prooflayer contract show
prooflayer contract diff
```

## AI-assisted draft

Allow:

```bash
prooflayer contract create --from requirements.md
```

to generate a draft.

The draft must be reviewed before becoming approved.

## Acceptance criteria

A natural-language subscription requirement can be converted into a valid draft contract containing:
- requirements,
- invariants,
- edge cases,
- security checks,
- data-integrity checks.

---

# 69. Phase 3 — MCP Integration

Goal:

Codex, Claude Code, Cursor, or another MCP-compatible agent can interact with ProofLayer.

Implement:

```text
prooflayer_get_project_context
prooflayer_list_contracts
prooflayer_get_contract
prooflayer_create_contract
prooflayer_validate_contract
prooflayer_analyze_diff
```

The MCP server should run locally.

Example:

```bash
prooflayer mcp
```

Add documentation for configuration.

Acceptance:
A coding agent can query a contract before modifying code.

---

# 70. Phase 4 — Git Diff + Risk Engine

Goal:

ProofLayer understands the change.

Implement:
- changed file detector,
- diff parser,
- path classification,
- basic function/export detection,
- related-contract matching,
- rule-based risk engine first.

Do not start with fully LLM-dependent risk scoring.

Use deterministic factors plus optional AI explanation.

Command:

```bash
prooflayer risk --diff
```

Acceptance:

A change to a billing webhook should score substantially higher than a CSS change and explain why.

---

# 71. Phase 5 — Verification Planner

Goal:

Generate an inspectable verification plan.

Implement:
- requirement selection,
- affected test lookup,
- risk-based adapter selection,
- plan serialization,
- reasons for every step.

Command:

```bash
prooflayer plan --diff
```

Acceptance:
The subscription sample produces a logical plan connecting requirements to tests.

---

# 72. Phase 6 — Test Execution Adapters

Goal:

Execute real verification.

Implement:
1. Vitest adapter.
2. Playwright adapter.
3. Existing-test discovery.
4. Generated temporary tests.
5. requirement tagging.
6. artifact capture.

Command:

```bash
prooflayer verify --diff
```

Acceptance:
An intentionally broken subscription cancellation implementation is detected.

---

# 73. Phase 7 — Evidence + Findings

Goal:

ProofLayer produces trustworthy results.

Implement:
- Evidence objects,
- RequirementEvidence mapping,
- Finding model,
- severity,
- reproduction instructions,
- artifacts,
- terminal summary,
- JSON report.

Acceptance:
Every blocking finding includes:
- contract,
- requirement,
- expected,
- actual,
- reproduction,
- evidence.

---

# 74. Phase 8 — Semantic Drift Guard

Goal:

Prevent tests from changing product meaning silently.

Implement:
- semantic vs mechanical contract diff,
- protected expectation rules,
- proposed contract amendment,
- approval requirement.

Acceptance:
If implementation changes free quota 5 -> 10, ProofLayer reports semantic conflict and does not rewrite the contract.

---

# 75. Phase 9 — QA Memory

Goal:

Historical bugs affect future verification.

Implement:
- memory record format,
- CLI add/list/search,
- links to files/contracts,
- historical risk matching,
- automatic regression inclusion.

Acceptance:
Record an invoice IDOR bug, touch invoice authorization later, and verify the historical regression is automatically included.

---

# 76. Phase 10 — GitHub Actions / PR Verification

Goal:

ProofLayer works on pull requests.

Implement workflow:

```text
checkout
install
prooflayer verify --diff
upload evidence
publish GitHub summary
set check status
```

Do not require a GitHub App initially.

Acceptance:
A PR with a blocking contract violation fails the ProofLayer check and receives a readable summary.

---

# 77. Phase 11 — Web Dashboard

Goal:

Create a polished SaaS interface.

Implement:
- authentication,
- organization,
- projects,
- contracts,
- runs,
- findings,
- requirement coverage,
- QA memory.

Keep source execution local/CI initially.

Cloud stores metadata and evidence only where configured.

---

# 78. Phase 12 — Security / Accessibility Adapters

Implement:
- axe,
- Semgrep,
- Gitleaks.

Wire them into risk-driven planning.

Example:
If auth or billing files change, security verification becomes more likely.

---

# 79. Phase 13 — Mutation Verification

Implement isolated mutations.

Start with TypeScript transformations:
- invert boolean,
- remove guard,
- change comparison,
- remove ownership condition.

Use temporary git worktree.

Never modify developer working tree.

---

# 80. Phase 14 — Challenger Agent

Implement separate adversarial reasoning.

Only activate for:
- high/critical risk,
- explicit user request,
- release verification.

Track cost.

---

# 81. Phase 15 — Production Feedback

Integrate one provider first, preferably through a generic webhook/OpenTelemetry-style input if practical.

Flow:
- ingest error,
- associate commit,
- associate contract,
- create memory,
- propose reproduction,
- generate regression.

---

# 82. Phase 16 — Advanced Platform Capabilities

Add incrementally:

```text
visual testing
performance testing
API schema verification
database migration verification
mobile adapters
BrowserStack adapter
Jira / Linear
Sentry / Datadog / PostHog
enterprise policies
SSO
private runners
multi-repository contracts
service-to-service verification
```

---

# 83. Suggested MVP Definition

The MVP is complete when this exact flow works:

```text
1. Developer has Next.js project.
2. Developer runs prooflayer init.
3. ProofLayer detects stack/tests.
4. Developer provides feature requirement.
5. ProofLayer produces Quality Contract draft.
6. Developer approves contract.
7. Developer or coding agent changes code.
8. ProofLayer analyzes git diff.
9. ProofLayer calculates risk.
10. ProofLayer generates verification plan.
11. ProofLayer runs existing/generated Vitest + Playwright checks.
12. Broken business behavior is detected.
13. Result links failure to contract requirement.
14. Reproduction command is provided.
15. GitHub Action can run same verification on PR.
16. MCP coding agent can request verification.
```

If this does not work beautifully, do not prioritize enterprise features.

---

# 84. Demo Scenario

Build an intentionally broken demo project around subscriptions.

Requirement:

```text
Free:
10 generations/month

Pro:
unlimited

Upgrade:
immediate

Cancel:
Pro remains active until period_end

Failed payment:
must not activate Pro
```

Inject bugs:

```text
BUG A:
cancel immediately sets FREE

BUG B:
duplicate webhook increments billing state twice

BUG C:
client can submit plan=pro

BUG D:
usage boundary allows 11th free generation
```

ProofLayer must catch these.

This demo should become the primary product demonstration.

---

# 85. Second Demo Scenario — Authorization

Application:
invoice system.

Contract:

```text
User may read only invoices belonging to their organization.
```

Bug:

```text
GET /api/invoices/:id

checks authentication
but not invoice ownership.
```

ProofLayer should generate a cross-account test and detect it.

Record as QA Memory.

Later modify invoice code and show that the regression test is automatically run.

This demo demonstrates the memory moat.

---

# 86. Third Demo Scenario — AI Semantic Drift

Contract:

```text
Free users may upload 5 files.
```

Change implementation:

```text
limit = 10
```

Show:

```text
SEMANTIC CONTRACT VIOLATION
```

and demonstrate that ProofLayer refuses to auto-update the expectation.

This demonstrates trust.

---

# 87. Developer Documentation

Documentation must include:

```text
Getting Started
CLI
MCP
Quality Contracts
Policies
Verification
QA Memory
Adapters
GitHub Actions
Security
Architecture
Contributing
```

Include copy-paste examples.

---

# 88. README Positioning

The README should communicate:

```text
ProofLayer is the independent QA agent for AI-generated software.

Your coding agent writes the implementation.
ProofLayer verifies that the implementation still satisfies the product.

It converts product intent into Quality Contracts,
analyzes code changes,
plans risk-based verification,
runs existing testing tools,
remembers previous regressions,
and produces evidence before release.
```

Then show:

```bash
npx prooflayer init
npx prooflayer contract create
npx prooflayer verify --diff
```

---

# 89. Competitive Differentiation

Do not position around:

```text
"AI-generated Playwright tests"
```

That is too easy to copy.

Position around:

```text
1. Independent verification
2. Quality Contracts
3. Persistent QA Memory
4. Requirement-level evidence
5. Risk-based verification
6. Semantic drift protection
7. Mutation-verified test quality
8. Product-spec gap detection
9. Historical risk intelligence
10. Coding-agent-native MCP integration
```

The moat is:

```text
Product Intent Graph
        +
Historical Bug Graph
        +
Code Dependency Graph
        +
Requirement Evidence Graph
        +
Production Failure Data
        |
        v
Project-specific Quality Intelligence
```

---

# 90. Things Not to Build First

Avoid spending early engineering time on:

```text
custom browser engine
device farm
custom CI runner infrastructure
mobile device cloud
generic issue tracker
full project management suite
complex enterprise RBAC
visual design perfection
20 framework integrations
custom static analysis engine
custom load-testing engine
full penetration-testing engine
```

Use adapters.

Own the intelligence.

---

# 91. Important AI Guardrails

All AI-generated structured output must be schema validated.

Never allow model output to directly:
- execute arbitrary shell commands,
- approve contracts,
- alter release policies,
- modify secrets,
- weaken semantic requirements,
- mark findings false-positive.

Actions must pass through deterministic policy checks.

---

# 92. Shell Execution Safety

Create an execution policy.

Allowed commands should come from:
- known package scripts,
- configured adapter commands,
- explicit user configuration.

Do not let free-form LLM output become shell input.

---

# 93. Cost Management

Track cost per verification run.

Store:
- model calls,
- tokens,
- test execution time,
- browser time.

Planner should prefer:
1. deterministic analysis,
2. existing tests,
3. targeted AI reasoning,
4. expensive adversarial reasoning only when justified.

---

# 94. Offline / No-AI Graceful Degradation

Core features should still provide value without model access:

```text
contract validation
git diff
deterministic risk rules
existing test execution
policy enforcement
evidence
memory lookup
```

AI should enhance the system, not make the entire CLI unusable when unavailable.

---

# 95. Internal Interfaces to Design Early

Create stable interfaces for:

```text
ReasoningProvider
VerificationAdapter
SourceControlProvider
CICheckProvider
ArtifactStore
MemoryStore
ContractStore
RiskRule
PolicyEvaluator
```

This prevents architectural lock-in.

---

# 96. Event Model

Emit domain events internally:

```text
project.scanned
contract.created
contract.approved
contract.changed
risk.assessed
plan.created
verification.started
verification.completed
finding.created
finding.resolved
memory.created
release.blocked
```

This will simplify future integrations.

---

# 97. Example Risk Rule

```ts
export const paymentRule: RiskRule = {
  id: "payment-sensitive-change",

  evaluate(context) {
    const touchesPayment =
      context.changedFiles.some(file =>
        /billing|stripe|payment|subscription|checkout/i.test(file)
      )

    if (!touchesPayment) return null

    return {
      scoreDelta: 25,
      reason: "Change touches payment-sensitive code",
      categories: ["payments"]
    }
  }
}
```

Start deterministic.

Add AI interpretation later.

---

# 98. Example Finding Shape

```ts
type Finding = {
  id: string
  projectId: string
  runId: string

  title: string
  severity: "info" | "low" | "medium" | "high" | "critical"

  contractId?: string
  requirementIds: string[]

  expected?: string
  actual?: string

  explanation: string

  reproduction?: {
    command?: string
    steps?: string[]
  }

  sourceLocations?: {
    file: string
    line?: number
  }[]

  evidenceIds: string[]

  status:
    | "open"
    | "confirmed"
    | "fixed"
    | "false-positive"
    | "accepted-risk"
    | "deferred"
}
```

---

# 99. Example Evidence Shape

```ts
type Evidence = {
  id: string
  runId: string

  type:
    | "unit-test"
    | "api-test"
    | "e2e-test"
    | "security-scan"
    | "accessibility"
    | "performance"
    | "mutation"
    | "manual"
    | "production"

  requirementIds: string[]

  status: "passed" | "failed" | "inconclusive"

  tool: string
  toolVersion?: string

  artifactRefs: string[]

  createdAt: Date
}
```

---

# 100. Definition of “Done” for Any Feature

A feature is not done until:

```text
[ ] implementation exists
[ ] types are correct
[ ] lint passes
[ ] unit tests exist
[ ] integration tests exist where relevant
[ ] error states are handled
[ ] CLI/API UX is documented
[ ] telemetry is appropriate
[ ] security implications considered
[ ] contracts/models updated
[ ] acceptance criteria demonstrated
```

---

# 101. Coding Standards

Prefer:
- strict TypeScript,
- small domain-focused modules,
- explicit schemas,
- pure functions for risk/policy logic,
- dependency injection for external services,
- typed Result/error patterns where useful,
- no hidden global mutable state,
- no giant service classes,
- no untyped JSON blobs in core domain logic.

Avoid:
- `any`,
- silent catch blocks,
- hard-coded provider names,
- tightly coupled CLI/domain logic,
- LLM prompts embedded randomly throughout application code.

Centralize prompts and schemas.

---

# 102. Database Standards

- use UUIDs,
- timestamps everywhere relevant,
- soft-delete only where domain requires it,
- indexes for project/run/contract lookups,
- immutable historical contract versions,
- audit semantic modifications.

Do not overwrite historical contract state.

---

# 103. Testing Strategy for AI Components

Do not test AI prompts using brittle exact strings.

Use:
- schema validity,
- semantic expectations,
- fixtures,
- benchmark cases.

Example:

```text
Given:
"Users can only read their own invoice"

Expected generated contract contains:
- authentication-related requirement
- ownership invariant
- cross-account edge case
```

---

# 104. Prompt Architecture

Keep prompts in:

```text
packages/llm/prompts/
```

Suggested prompts:

```text
contract-draft
ambiguity-detection
edge-case-expansion
diff-impact-analysis
risk-explanation
test-plan-expansion
finding-explanation
challenger-analysis
```

Version prompts.

Store prompt version in provenance.

---

# 105. Structured Output

Every AI planning task should return validated JSON.

For example:

```ts
const RiskExplanationSchema = z.object({
  affectedFeatures: z.array(z.string()),
  riskFactors: z.array(
    z.object({
      category: z.string(),
      explanation: z.string()
    })
  ),
  suggestedChecks: z.array(z.string())
})
```

Never depend on parsing free-form Markdown for internal execution.

---

# 106. Open-Source Strategy

A strong launch path is:

Open source:
- CLI,
- contracts,
- local MCP,
- basic adapters.

Cloud paid:
- shared QA Memory,
- hosted evidence,
- dashboards,
- team policies,
- managed reasoning,
- hosted PR history,
- production feedback,
- advanced risk intelligence.

Do not prematurely split the codebase if it slows development.

---

# 107. Product Metrics

Track later:

```text
time to first verification
projects initialized
contracts created
verification runs/week
critical bugs detected
false positive rate
mean verification duration
requirements covered
historical regressions prevented
PRs blocked correctly
contract amendment rate
developer override rate
```

Most important long-term metric:

> **Confirmed meaningful defects found before release.**

---

# 108. North-Star Technical Metric

Internally maintain benchmark:

```text
Critical Defect Detection Rate
```

against intentionally buggy implementations.

Do not optimize primarily for number of generated tests.

---

# 109. Final Product Flow

The finished product should eventually support:

```text
Developer / Product Owner
        |
        v
Describe Feature
        |
        v
ProofLayer identifies ambiguity
        |
        v
Quality Contract
        |
        v
Human approval
        |
        +--------------------------+
        |                          |
        v                          v
Coding Agent writes code      QA Memory
        |                          |
        v                          |
Git Diff -------------------------+
        |
        v
Impact Analysis
        |
        v
Risk Engine
        |
        v
Verification Planner
        |
   +----+----+---------+-----------+
   |         |         |           |
   v         v         v           v
 Unit       API       E2E       Security
   |         |         |           |
   +---------+----+----+-----------+
                  |
                  v
               Evidence
                  |
                  v
        Requirement Coverage
                  |
                  v
          Challenger / Mutation
          when risk justifies
                  |
                  v
            Findings / Pass
                  |
          +-------+-------+
          |               |
          v               v
      Allow PR        Block PR
                          |
                          v
                    Developer Fix
                          |
                          v
                       Re-run
                          |
                          v
                  QA Memory Updated
```

---

# 110. Final Instruction to Codex

Build ProofLayer as if it will eventually become critical infrastructure used to determine whether AI-generated production software is safe to release.

Prioritize:
- trust,
- auditability,
- reproducibility,
- excellent developer experience,
- product-intent traceability,
- architectural extensibility.

The first goal is **not** to look impressive.

The first goal is to reliably catch a real bug that a coding agent missed and explain exactly which intended product behavior was violated.

Start with:

```text
Phase 0
Phase 1
```

Then proceed sequentially.

Before moving to a new phase, prove the previous phase using the intentionally broken example application.

Do not weaken verification to obtain green results.

Do not silently change product intent.

**The coding agent builds. ProofLayer proves.**
## Project Naming Update

The project previously referred to as **ProofLayer** is now officially named **MaruCheck**.

From this point forward, all references to `ProofLayer`, `prooflayer`, and related naming throughout this specification should be interpreted and implemented as **MaruCheck**.

Use the following naming conventions:

```text
Product / Platform: MaruCheck
CLI command: maru
Configuration directory: .maru/
Primary configuration: .maru/maru.yml
Environment variable prefix: MARU_
Package / internal namespace: @maru/*
```

For example:

```bash
# Old
npx prooflayer init
prooflayer verify --diff
prooflayer risk --diff

# New
npx maru init
maru verify --diff
maru risk --diff
```

The core product positioning is:

> **MaruCheck — Test what your AI didn't.**

MaruCheck is the **independent QA and verification layer for AI-generated software**. Coding agents build the implementation; MaruCheck independently verifies that the resulting software still satisfies its intended product behavior.

The name is inspired by the concept of the **Kobayashi Maru**: testing a system under difficult and unexpected conditions rather than merely checking the happy path.

All future code, documentation, CLI commands, UI copy, package names, APIs, configuration examples, and architectural references should use **MaruCheck / Maru** terminology instead of ProofLayer.

One small naming choice I particularly recommend: keep MaruCheck for the company/product, but use simply maru everywhere developers interact with it.

So the experience becomes:

maru init
maru scan
maru contract create
maru risk --diff
maru plan --diff
maru verify --diff
maru verify --release
