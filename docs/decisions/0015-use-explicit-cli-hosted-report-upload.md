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

Add `maru upload --report <report.json> [--url <host>]` as a separate, explicit action. The command:

- requires the project-scoped token through `MARUCHECK_TOKEN`;
- accepts the host through `--url` or `MARUCHECK_URL`;
- reads branch, commit SHA, and commit title using argument-based Git execution;
- uploads the existing schema-versioned report plus those run fields;
- rejects report paths outside the repository, symlinks, oversized files, and insecure remote URLs;
- sends no source files or artifact contents; and
- treats retries of the same run as safe because the hosted endpoint upserts by project and run ID.

Verification never calls upload implicitly. A blocked report can still be uploaded so the dashboard
preserves the evidence explaining why a release was refused.

## Alternatives considered

### Upload automatically after `maru verify`

This is convenient but hides an outbound network action inside a command whose established behavior
is local. It also makes offline use and consent harder to reason about.

### Keep the documented JSON and curl flow

This avoids CLI code, but every tester must reproduce Git metadata, schema wrapping, authentication,
error handling, and retry behavior manually.

### Store the project token in `.maru/`

This reduces environment setup but creates a durable plaintext secret inside the repository. The
dashboard already reveals the token once and CI systems provide encrypted secret storage.

## Consequences

- Tester onboarding becomes one explicit command after verification.
- The CLI owns a small, versioned compatibility boundary with the hosted API.
- Upload requires network access and a hosted account, while all existing verification stays usable
  without either.
- A new public CLI version must be published before the website advertises the command to testers.
