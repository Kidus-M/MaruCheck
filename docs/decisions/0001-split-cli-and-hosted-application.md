# ADR-001: Split the CLI and hosted application repositories

## Status

Accepted

## Date

2026-08-15

## Context

The original plan proposed one pnpm/Turborepo monorepo containing the CLI, core libraries, dashboard, API, and worker. The CLI must remain local-first and independently releasable, while the hosted product has a different deployment lifecycle, security boundary, and dependency profile. All repositories must remain accessible under one local workspace without nesting one Git repository inside another.

## Decision

- Use the outer `MaruCheck` directory as a non-Git workspace container.
- Keep the existing Git history and `Kidus-M/MaruCheck` remote in `maru-cli`.
- Maintain the hosted dashboard and API in a separate sibling `maru-web` repository using Next.js full stack.
- Use TypeScript and npm workspaces inside `maru-cli` for tightly coupled internal packages.
- Do not use Turborepo initially; npm scripts and TypeScript project references meet current requirements with less tooling.
- Create a worker repository only when independent deployment or scaling is demonstrated.

## Consequences

### Positive

- CLI releases are independent of hosted deployments.
- Cloud dependencies cannot accidentally become mandatory for local verification.
- npm works with the installed tooling and provides one reproducible lockfile.
- The workspace exposes all projects without nested repositories.

### Negative

- Cross-repository changes may require coordinated pull requests.
- Shared wire types must be published or generated instead of imported from source.
- CI and dependency updates exist in more than one repository.

### Neutral

- Internal CLI libraries remain workspace packages because they require atomic changes.
- Next.js server routes keep the initial web frontend and backend in one deployment.

## Alternatives considered

- **Single pnpm/Turborepo monorepo:** rejected because it couples unrelated release lifecycles and conflicts with requested repository ownership.
- **Repository per internal package:** rejected because it adds coordination overhead without deployment independence.
- **Separate frontend and backend immediately:** rejected because Next.js supports the initial full-stack product without another service.

## References

- `MaruCheck_master_build_plan.md`
- `docs/architecture/repository-boundaries.md`
