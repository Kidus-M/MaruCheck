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

| Command       | Description                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `maru init`   | Detect the stack and create an idempotent `.maru/` configuration                               |
| `maru scan`   | Write route, test, dependency, CI, and source inventory to `.maru/generated/project-scan.json` |
| `maru doctor` | Validate Node.js, Git, package-manager, configuration, test, and CI prerequisites              |

### Quality Contract commands

| Command                                               | Description                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `maru contract create --from requirements.md`         | Create a deterministic draft from natural-language intent    |
| `maru contract list`                                  | List current contracts, states, criticality, and version IDs |
| `maru contract show <id>`                             | Print one validated contract                                 |
| `maru contract validate [path]`                       | Validate all current contracts or one YAML file              |
| `maru contract diff <id-or-path> <id-or-path>`        | Classify mechanical and semantic contract changes            |
| `maru contract approve <id> --by <accountable-owner>` | Approve and snapshot one reviewed version                    |

## Repository structure

```text
packages/
|-- cli/          # maru command-line interface
|-- contracts/    # Quality Contract schemas and versioning
|-- core/         # verification domain and orchestration
|-- git/          # repository and diff analysis
|-- mcp-server/   # coding-agent integration
`-- shared/       # stable cross-package primitives
```

See [repository architecture](docs/architecture/repository-boundaries.md) and [ADR-001](docs/decisions/0001-split-cli-and-hosted-application.md) for the rationale.

## Current scope

Phases 0, 1, and 2 are implemented. The local CLI supports Next.js/React repository discovery plus local Quality Contract creation, validation, inspection, semantic diffing, version hashing, and explicit approval.

Known Phase 1 limitations:

- route discovery follows common Next.js filesystem conventions and does not interpret custom runtime routing;
- doctor validates declared tooling and executables but does not install browser binaries;
- MCP and GitHub Actions configuration generation remain in their later planned phases;
- no cloud account or AI provider is used or required.

Quality Contract YAML intentionally supports the documented MaruCheck schema rather than every YAML feature. Anchors, aliases, tags, merge keys, unsafe identifiers, duplicate keys, and paths outside the project root are rejected.

See the [Phase 2 Quality Contracts guide](docs/guides/phase-2-quality-contracts.md) and the [subscription example](examples/contracts/subscription-management.yml).

### MCP server

`maru mcp` runs a local stdio MCP server for coding agents. It exposes project context, Quality Contract reads and draft creation, validation, and a bounded Git working-tree inventory. It never approves contracts or sends repository content to a cloud service.

See the [Phase 3 MCP configuration guide](docs/guides/phase-3-mcp-integration.md) for Codex, Claude Code, and Cursor setup.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
