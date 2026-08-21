# ADR-014: Publish one bundled `marucheck` CLI package

## Status

Accepted

## Date

2026-08-21

## Context

The CLI is implemented as fourteen tightly coupled npm workspaces. They intentionally share one
release train, but every package is private. Publishing only `@maru/cli` would create a package
whose dependencies cannot be downloaded. Publishing every internal package would expose an API
surface and release coordination burden that users do not need.

The npm name `maru` is already owned by an unrelated package. The available product name is
`marucheck`, while existing commands, documentation, generated CI, and MCP integrations use the
executable name `maru`.

## Decision

- Publish the repository root as the public unscoped npm package `marucheck`.
- Keep the installed binary named `maru`; `npx marucheck` resolves the package's single executable.
- Bundle the CLI entry point and all internal workspaces into one Node.js 24 ESM file with esbuild.
- Publish only `dist/maru.js`, `package.json`, and `README.md`.
- Keep internal `@maru/*` packages private until a real external library API requires independent
  versioning.
- Gate a release on the full repository check, tarball inspection, clean-directory installation,
  and installed `--version` execution.
- Bootstrap the package interactively, then use npm trusted publishing from the tag-triggered
  `publish.yml` workflow with the GitHub `production` environment.
- Never overwrite a released version; correct failures with deprecation and a patch release.

## Consequences

- Users get one cross-platform installation with no private registry or workspace knowledge.
- CLI and web remain independent repositories and release lifecycles.
- The unminified executable is larger because it includes the TypeScript compiler used by mutation
  verification, but its compressed npm tarball remains much smaller.
- Internal packages are not supported as public libraries in this release.
- The first publish and the repository's license choice remain explicit owner actions.

## Alternatives considered

### Publish every `@maru/*` workspace

Rejected because it exposes internal contracts, requires coordinated publishing order, and depends
on ownership of an npm scope that has not been established.

### Publish as `maru`

Rejected because npm already has an unrelated package with that name.

### Require users to clone GitHub

Rejected because it preserves the source-only onboarding gap and makes version pinning and CI
installation unnecessarily difficult.

### Ship native platform archives first

Deferred. The current implementation already requires Node.js for project tooling, and npm gives
Windows, macOS, and Linux users one signed package channel with reproducible version selection.
