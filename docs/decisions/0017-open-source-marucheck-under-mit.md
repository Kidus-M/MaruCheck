# ADR-017: Open source MaruCheck under MIT

## Status

Accepted

This decision supersedes the proprietary licensing and release-channel details in
[ADR-014](0014-publish-one-bundled-marucheck-cli-package.md).

## Date

2026-08-23

## Context

MaruCheck is intended to verify developer tooling in the open. Testers need to inspect the code
that interprets Quality Contracts, calculates risk, selects checks, and blocks releases. A familiar
open-source license also makes it practical to try, contribute to, and integrate the verifier.

The npm versions published before this decision contain the earlier proprietary license in their
immutable tarballs. Reusing one of those version numbers would misrepresent what was distributed.
The unscoped `marucheck` package on npm is already the public installation identity. Publishing the
same tool through GitHub's npm registry would require a second scoped package name and create two
different installation paths.

## Decision

- License the CLI repository and its publishable package under the MIT License, copyright 2026
  Kidus Mesfin Teferi.
- Make `0.3.0` the first npm release that carries the MIT License. Earlier npm releases retain the
  terms included in their original artifacts.
- Keep `marucheck` on npm as the one canonical package and installation identity.
- Create a GitHub Release for each `v*` tag. Attach the exact tested npm tarball and a SHA-256
  checksum, and generate release notes from repository history.
- Keep the internal `@maru/*` workspaces non-publishable until a separately supported library API
  exists. Their repository source is still covered by MIT.
- Accept external contributions under the same MIT License.

## Consequences

- Developers can inspect, modify, redistribute, and contribute to the verifier under standard MIT
  terms.
- The open-source boundary is unambiguous from version `0.3.0` onward without rewriting historical
  npm artifacts.
- npm remains the shortest install path, while GitHub Releases provide human-readable release notes,
  a downloadable tarball, and a checksum.
- GitHub Packages is intentionally not a second registry for the CLI. Avoiding a scoped alias keeps
  documentation, lockfiles, MCP configuration, and update instructions on one package identity.
- The hosted MaruCheck service can be deployed from the separately licensed web repository, but an
  MIT source license does not promise hosted-service availability or pricing.

## Alternatives considered

### Apache License 2.0

Provides an explicit patent grant and is a strong option for larger foundation-style projects. MIT
was selected for this project because its short, familiar terms reduce friction for early adopters
and contributors.

### GPL or AGPL

Would require downstream derivative work, or network-hosted modifications under AGPL, to preserve
the same freedoms. That reciprocal requirement was not selected for the initial open-source release.

### Publish a second GitHub npm package

Rejected because GitHub's npm registry uses scoped package identities. A second
`@Kidus-M/…` package would fragment installation and versioning without improving the current npm
workflow.
