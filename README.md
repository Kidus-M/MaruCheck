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

Phase 0 establishes package boundaries and quality gates. Phase 1 will implement `maru init`, `maru scan`, and `maru doctor` end to end.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
