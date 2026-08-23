# Public CLI installation and release

MaruCheck is distributed as the public, unscoped npm package `marucheck`. The installed
executable is `maru`, preserving the product's command contract without depending on the unrelated
npm package that already owns the name `maru`.

## Install and run

Run the current release once without changing the project dependency list:

```bash
npx --yes marucheck@0.3.0 init
npx --yes marucheck@0.3.0 doctor
npx --yes marucheck@0.3.0 risk --diff
npx --yes marucheck@0.3.0 verify --diff
```

For regular project, team, or CI use, pin the exact release:

```bash
npm install --save-dev --save-exact marucheck@0.3.0
npx --no-install maru --version
npx --no-install maru init
npx --no-install maru ci init
npx --no-install maru ci verify
```

The CLI requires Node.js 24 and npm 11 or newer. Core contracts, risk, planning, evidence, memory,
and MCP operations remain local; the hosted account is optional unless the user chooses to upload
verification reports.

## Release architecture

The repository keeps its domain packages private and bundles them into `dist/maru.cjs` for
publication. Here, `private` means the internal workspace packages cannot be published separately;
their source is part of the MIT-licensed repository. TypeScript remains an external runtime
dependency under its own license. `npm pack` contains the executable bundle, license,
package metadata, and repository README. Consumers never need access to the internal `@maru/*`
workspace packages.

MaruCheck is open source under the MIT License beginning with version `0.3.0`. The source repository,
the npm artifact, its documentation, and its examples carry the same license. Versions published
before `0.3.0` retain the license embedded in their immutable npm tarballs.

The canonical package remains the unscoped npmjs package `marucheck`. GitHub Packages is not used
for npm distribution because GitHub's npm registry requires a scoped package name, which would
create a second install identity. GitHub Releases mirror each version with the tested tarball and a
SHA-256 checksum.

Every release tag must exactly match the root package version:

```text
package.json X.Y.Z <-> Git tag vX.Y.Z
```

The `Release CLI` GitHub workflow runs all checks, creates the tarball, installs it into an empty
consumer directory, checks `--version`, publishes to npm only when the version is not already
present, and creates the matching GitHub Release with the tarball and checksum.

## Publication status

Versions `0.1.0`, `0.2.0`, and `0.2.2` were published manually on 2026-08-21 under the license
embedded in those immutable tarballs. Version `0.3.0` is the first MIT-licensed release. The
tag-triggered workflow can backfill a GitHub Release when the npm version already exists, but npm
trusted publishing still requires the one-time configuration below before it can publish a new
version automatically.

## Manual release while automation is disabled

1. Update the root package, lockfile, CLI, MCP, tests, and public docs to the same new version; never
   reuse a published version.
2. From a clean, reviewed checkout, run `npm run release:check` and inspect the tarball manifest.
3. Run `npm publish --access public` interactively and complete npm authentication and two-factor
   verification.
4. Verify the exact release with `npx --yes marucheck@<version> --version`.
5. Create and push the matching annotated tag. Because the npm version now exists, the workflow
   skips republishing and creates the GitHub Release:

```bash
git tag -a v<version> -m "MaruCheck CLI v<version>"
git push origin v<version>
```

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
short-lived OIDC credentials; no long-lived `NPM_TOKEN` is stored in the repository. The workflow
publishes npm first and creates the GitHub Release only after the package and consumer-install
checks succeed.

## Rollback and correction

npm releases are immutable. Do not overwrite a published version. For a broken release, deprecate
the affected version with a precise message, publish a corrected patch version, and move the
`latest` dist-tag only after its consumer-install check passes.
