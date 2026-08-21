# ADR-015: Use explicit CLI hosted report upload

## Status

Accepted

## Context

MaruCheck verification is local-first, while the separate hosted application gives teams a shared
view of completed proof. The hosted ingestion API already accepts a bounded, versioned report
envelope, but the first release required users to construct that envelope and call the API with
`curl`. That is too fragile for external tester onboarding and encourages duplicated request logic
in individual CI workflows.

Automatic upload during `verify` would make the network boundary easy to miss and would weaken the
promise that installing or running MaruCheck does not silently transmit repository information.
Putting bearer tokens on command lines would also expose them to shell history and process lists.

## Decision

Add `maru upload [--report <report.json>] [--url <host>]` as a separate, explicit action. By
default, the command:

- selects the valid report with the newest generated timestamp under `.maru/artifacts/runs/`;
- reads only `MARUCHECK_TOKEN` and `MARUCHECK_URL` from `.maru/connection.env`, `.env.local`, or
  `.env`, and only when Git confirms the source file is ignored;
- gives shell/CI environment variables precedence over local files;
- reads branch, commit SHA, and commit title using argument-based Git execution;
- uploads the existing schema-versioned report plus those run fields;
- rejects report paths outside the repository, symlinks, oversized files, and insecure remote URLs;
- sends no source files or artifact contents; and
- treats retries of the same run as safe because the hosted endpoint upserts by project and run ID.

`--report` and `--url` remain explicit overrides for CI and targeted retries. `maru init`
idempotently adds `connection.env` to `.maru/.gitignore` without replacing custom ignore rules.

Verification never calls upload implicitly. A blocked report can still be uploaded so the dashboard
preserves the evidence explaining why a release was refused.

## Alternatives considered

### Upload automatically after `maru verify`

This is convenient but hides an outbound network action inside a command whose established behavior
is local. It also makes offline use and consent harder to reason about.

### Keep the documented JSON and curl flow

This avoids CLI code, but every tester must reproduce Git metadata, schema wrapping, authentication,
error handling, and retry behavior manually.

### Store the project token in committed `maru.yml`

This removes a file but mixes a secret into the project configuration that teams are expected to
commit. Connection credentials must remain in a separate ignored file.

### Require an operating-system credential manager

This provides stronger at-rest storage, but Windows, macOS, Linux desktops, containers, and CI use
different credential APIs. The beta keeps the token project-scoped, rotatable, ignored, and
overrideable through the CI secret store while leaving native keychain support as a later hardening
option.

## Consequences

- Tester onboarding becomes `maru verify --diff` followed by `maru upload`.
- The CLI owns a small, versioned compatibility boundary with the hosted API.
- Local connection files contain a plaintext scoped token and therefore must remain ignored; the CLI
  refuses to load them when Git does not confirm that boundary.
- Upload requires network access and a hosted account, while all existing verification stays usable
  without either.
- A new public CLI version must be published before the website advertises the command to testers.
