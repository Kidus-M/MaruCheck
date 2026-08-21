# Public CLI installation and release

MaruCheck is distributed as the public, unscoped npm package `marucheck`. The installed executable
is `maru`, preserving the product's command contract without depending on the unrelated npm package
that already owns the name `maru`.

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

The repository keeps its domain packages private and bundles them into `dist/maru.js` for
publication. `npm pack` therefore contains exactly the executable bundle, `package.json`, and this
repository's README. Consumers never need access to the internal `@maru/*` workspace packages.

Every release tag must exactly match the root package version:

```text
package.json 0.1.0 <-> Git tag v0.1.0
```

The `Publish CLI` GitHub workflow runs all checks, creates the tarball, installs it into an empty
consumer directory, checks `--version`, and only then publishes.

## First publication

The first `marucheck` publication must establish package ownership on npm:

1. Create or sign into the npm account that will own MaruCheck and enable two-factor
   authentication.
2. Decide and add the repository license before a broad public/open-source release. Package
   publication itself is technically possible without that decision, but usage rights should not
   be ambiguous.
3. From a clean, reviewed CLI checkout, run `npm run release:check` and inspect the three-file
   tarball manifest.
4. Run `npm publish` interactively and complete npm's authentication/2FA prompt.
5. On the new `marucheck` package's npm settings, add a GitHub Actions trusted publisher:
   - owner: `Kidus-M`;
   - repository: `MaruCheck`;
   - workflow: `publish.yml`;
   - environment: `production`;
   - allowed action: `npm publish`.
6. Add required reviewers to the GitHub `production` environment and protect version tags.

After that bootstrap, update the version, merge it, and push the matching `vX.Y.Z` tag. GitHub uses
short-lived OIDC credentials; no long-lived `NPM_TOKEN` is stored in the repository.

## Rollback and correction

npm releases are immutable. Do not overwrite a published version. For a broken release, deprecate
the affected version with a precise message, publish a corrected patch version, and move the
`latest` dist-tag only after its consumer-install check passes.

