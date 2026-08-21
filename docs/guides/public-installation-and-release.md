# Public CLI installation and release

MaruCheck is distributed as the public, unscoped npm package `marucheck`. The installed
executable is `maru`, preserving the product's command contract without depending on the unrelated
npm package that already owns the name `maru`.

## Install and run

Run once without changing the project dependency list:

```bash
npx marucheck init
npx marucheck doctor
npx marucheck risk --diff
npx marucheck verify --diff
```

For frequent interactive use:

```bash
npm install --global marucheck
maru --version
maru init
```

For reproducible CI, pin MaruCheck in the target repository and use the installed binary:

```bash
npm install --save-dev --save-exact marucheck
npx --no-install maru ci init
npx --no-install maru ci verify
```

The CLI requires Node.js 24 and npm 11 or newer. Core contracts, risk, planning, evidence, memory,
and MCP operations remain local; the hosted account is optional unless the user chooses to upload
verification reports.

## Release architecture

The repository keeps its domain packages private and bundles them into `dist/maru.cjs` for
publication. TypeScript remains an external runtime dependency under its own license instead of
being embedded in the proprietary bundle. `npm pack` contains the executable bundle, license,
package metadata, and repository README. Consumers never need access to the internal `@maru/*`
workspace packages.

The npm package is publicly downloadable but is not open-source software. Installation and use are
governed by the repository's proprietary `LICENSE`; registry visibility does not grant rights to
redistribute, resell, modify, or host the product for third parties.

Every release tag must exactly match the root package version:

```text
package.json X.Y.Z <-> Git tag vX.Y.Z
```

The `Publish CLI` GitHub workflow runs all checks, creates the tarball, installs it into an empty
consumer directory, checks `--version`, and only then publishes.

## Publication status

Versions `0.1.0` and `0.2.0` were published manually on 2026-08-21 and established npm package
ownership plus explicit hosted report upload. Version `0.2.1` is staged to ignore reproducible
`.maru/generated/` state by default. The tag-triggered
workflow is committed, but npm trusted publishing has not been configured yet. Until that one-time
configuration is complete, future releases remain explicit manual owner actions.

## Manual release while automation is disabled

1. Update the root package and CLI source versions together; never reuse a published version.
2. From a clean, reviewed checkout, run `npm run release:check` and inspect the tarball manifest.
3. Run `npm publish` interactively and complete npm authentication and two-factor verification.
4. Verify the exact release with `npx --yes marucheck@<version> --version`.
5. Do not push its matching `v<version>` tag while trusted publishing is disabled; that tag would
   trigger a workflow that cannot authenticate.

## Enable automatic releases later

On the `marucheck` package's npm settings, add a GitHub Actions trusted publisher:

- owner: `Kidus-M`;
- repository: `MaruCheck`;
- workflow: `publish.yml`;
- environment: `production`;
- allowed action: `npm publish`.

Then add required reviewers to the GitHub `production` environment and protect version tags. After
one successful automated release, restrict traditional token-based publishing in npm.

After that setup, update the version, merge it, and push the matching `vX.Y.Z` tag. GitHub uses
short-lived OIDC credentials; no long-lived `NPM_TOKEN` is stored in the repository.

## Rollback and correction

npm releases are immutable. Do not overwrite a published version. For a broken release, deprecate
the affected version with a precise message, publish a corrected patch version, and move the
`latest` dist-tag only after its consumer-install check passes.
