# MaruCheck CLI

MaruCheck is the independent QA and verification layer for AI-generated software. This repository owns the local-first `maru` CLI, verification libraries, Git analysis, Quality Contract support, and MCP server.

The hosted Next.js application is maintained separately in the sibling `maru-web` repository so the CLI and cloud product can release independently.

## Quick start

Requirements: Node.js 24 LTS and npm 11 or newer.

```bash
npm install
npm run check
npm run maru -- --help
```

During local development, build the CLI and invoke it from the project you want to inspect:

```bash
# In maru-cli
npm run build

# In a Next.js/React project
node ../maru-cli/packages/cli/dist/index.js init
node ../maru-cli/packages/cli/dist/index.js scan
node ../maru-cli/packages/cli/dist/index.js doctor
node ../maru-cli/packages/cli/dist/index.js contract create --from requirements.md
node ../maru-cli/packages/cli/dist/index.js risk --diff
node ../maru-cli/packages/cli/dist/index.js plan --diff
node ../maru-cli/packages/cli/dist/index.js verify --diff
node ../maru-cli/packages/cli/dist/index.js drift check --from observations.json
node ../maru-cli/packages/cli/dist/index.js mcp
```

The published developer experience will use `npx maru <command>`.

## Commands

| Command                  | Description                  |
| ------------------------ | ---------------------------- |
| `npm run build`          | Build all workspace packages |
| `npm run lint`           | Run ESLint                   |
| `npm run format:check`   | Check formatting             |
| `npm run typecheck`      | Type-check all packages      |
| `npm test`               | Run Vitest tests             |
| `npm run check`          | Run every local quality gate |
| `npm run maru -- --help` | Exercise the local CLI build |

### Project commands

| Command                                     | Description                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `maru init`                                 | Detect the stack and create an idempotent `.maru/` configuration                               |
| `maru scan`                                 | Write route, test, dependency, CI, and source inventory to `.maru/generated/project-scan.json` |
| `maru doctor`                               | Validate Node.js, Git, package-manager, configuration, test, and CI prerequisites              |
| `maru risk --diff`                          | Score current changes with deterministic explanations                                          |
| `maru plan --diff`                          | Write an inspectable, requirement-linked verification plan                                     |
| `maru verify --diff`                        | Execute selected tests and write evidence, findings, terminal output, and JSON report          |
| `maru drift check --from observations.json` | Block approved semantic conflicts without rewriting the contract                               |

### Quality Contract commands

| Command                                               | Description                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `maru contract create --from requirements.md`         | Create a deterministic draft from natural-language intent    |
| `maru contract list`                                  | List current contracts, states, criticality, and version IDs |
| `maru contract show <id>`                             | Print one validated contract                                 |
| `maru contract validate [path]`                       | Validate all current contracts or one YAML file              |
| `maru contract diff <id-or-path> <id-or-path>`        | Classify mechanical and semantic contract changes            |
| `maru contract approve <id> --by <accountable-owner>` | Approve and snapshot one reviewed version                    |

### Semantic drift commands

| Command                                                                           | Description                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `maru drift check --from observations.json`                                       | Compare observed behavior with protected requirements/invariants   |
| `maru drift propose <id> --from observations.json --reason "Why" --by <proposer>` | Write an immutable pending amendment without changing the contract |
| `maru drift approve <proposal-path> --by <contract-owner>`                        | Apply a reviewed amendment with an owner approval and audit record |

## Repository structure

```text
packages/
|-- cli/          # maru command-line interface
|-- contracts/    # Quality Contract schemas and versioning
|-- core/         # verification domain and orchestration
|-- drift/        # protected expectations and contract amendment workflow
|-- evidence/     # requirement evidence, findings, gates, and reports
|-- execution/    # Vitest/Playwright execution and raw run artifacts
|-- git/          # repository and diff analysis
|-- mcp-server/   # coding-agent integration
|-- planner/      # requirement-linked verification planning
|-- risk/         # deterministic risk scoring and contract matching
`-- shared/       # stable cross-package primitives
```

See [repository architecture](docs/architecture/repository-boundaries.md) and [ADR-001](docs/decisions/0001-split-cli-and-hosted-application.md) for the rationale.

## Current scope

Phases 0 through 8 are implemented. The local CLI supports repository discovery, Quality Contract lifecycle management, MCP coding-agent integration, Git diff metadata, deterministic risk scoring, requirement-linked verification planning, local Vitest/Playwright execution, evidence/findings reports, and semantic drift protection.

Known Phase 1 limitations:

- route discovery follows common Next.js filesystem conventions and does not interpret custom runtime routing;
- doctor validates declared tooling and executables but does not install browser binaries;
- GitHub Actions configuration remains in a later planned phase;
- no cloud account or AI provider is used or required.

Quality Contract YAML intentionally supports the documented MaruCheck schema rather than every YAML feature. Anchors, aliases, tags, merge keys, unsafe identifiers, duplicate keys, and paths outside the project root are rejected.

See the [Phase 2 Quality Contracts guide](docs/guides/phase-2-quality-contracts.md) and the [subscription example](examples/contracts/subscription-management.yml).

### MCP server

`maru mcp` runs a local stdio MCP server for coding agents. It exposes project context, Quality Contract reads and draft creation, validation, bounded Git/risk/planning tools, and local verification execution. It never approves contracts or sends repository content to a cloud service.

See the [Phase 3 MCP configuration guide](docs/guides/phase-3-mcp-integration.md) for Codex, Claude Code, and Cursor setup.

### Git risk

`maru risk --diff` classifies current changes and returns a reproducible 0-100 score with explicit point contributions, related Quality Contract requirements/invariants, and recommended test categories. It works offline and does not use an LLM for scoring.

See the [Phase 4 Git risk guide](docs/guides/phase-4-git-risk.md) and [ADR-004](docs/decisions/0004-use-deterministic-metadata-risk-scoring.md).

### Verification planning

`maru plan --diff` writes a versioned `.maru/generated/verification-plan.json` connecting the current change to contract requirements, affected tests, risk-based adapter choices, uncovered requirements, and reasons for every step.

See the [Phase 5 verification planner guide](docs/guides/phase-5-verification-planner.md) and [ADR-005](docs/decisions/0005-use-versioned-traceable-verification-plans.md).

### Verification execution

`maru verify --diff` executes the plan's selected local Vitest and Playwright files, distinguishes failures from adapter errors or unavailable work, and writes bounded raw artifacts under `.maru/artifacts/runs/`. It never downloads missing tools during verification.

See the [Phase 6 test execution guide](docs/guides/phase-6-test-execution.md) and [ADR-006](docs/decisions/0006-isolate-local-test-execution-and-preserve-raw-artifacts.md).

### Evidence and findings

Every verification run now writes `report.json` with normalized evidence, requirement mappings, deterministic severity, complete blocking findings, reproduction instructions, artifact references, and an explicit release gate. The CLI terminal view and MCP result use the same report object.

See the [Phase 7 evidence and findings guide](docs/guides/phase-7-evidence-and-findings.md) and [ADR-007](docs/decisions/0007-normalize-raw-runs-into-conservative-evidence-and-findings.md).

### Semantic drift protection

`maru drift check` compares explicit observed behavior with requirement-linked contract expectations. Approved meaning changes block without rewriting the contract. MCP clients may create an immutable pending proposal, but only a current contract owner can approve it through the separate CLI action.

See the [Phase 8 semantic drift guide](docs/guides/phase-8-semantic-drift.md) and [ADR-008](docs/decisions/0008-separate-semantic-drift-detection-proposal-and-approval.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
