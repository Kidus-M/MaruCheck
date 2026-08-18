# ADR-010: Use workflow-native pull-request verification

## Status

Accepted

## Date

2026-08-18

## Context

MaruCheck must run ProofLayer verification for GitHub pull requests, preserve evidence, show a readable result in the pull-request checks UI, and fail when an approved blocking requirement is violated. The first implementation must stay local-first and must not require a hosted account, GitHub App, repository webhook, installation token, or write access to pull requests.

Pull-request code is untrusted. The workflow therefore needs a narrow event and permission model. It must also publish its summary before returning a non-zero status; otherwise a blocked verification step would prevent later summary steps from running.

Generated evidence lives under the hidden `.maru/` directory. Current versions of the official artifact action exclude hidden paths unless explicitly enabled.

## Decision

Create a dedicated `@maru/ci` package and expose two CLI commands:

- `maru ci init` installs `.github/workflows/marucheck.yml` idempotently and refuses to overwrite different existing content.
- `maru ci verify` runs the existing evidence pipeline, writes `.maru/generated/github-summary.md`, appends the same escaped Markdown to `GITHUB_STEP_SUMMARY` when GitHub provides it, and then maps the release gate to exit code 0 or 1.

The installed workflow:

- runs only on `pull_request`, never `pull_request_target`;
- grants only `contents: read` to `GITHUB_TOKEN`;
- disables persisted checkout credentials;
- uses Node.js 24 and npm with the repository lockfile;
- calls the already-installed `maru` binary without downloading a package at verification time;
- uploads raw evidence, the verification plan, and the generated summary with `if: always()`;
- explicitly permits hidden `.maru/` artifact paths and retains them for 14 days;
- uses concurrency cancellation so superseded commits do not waste verification capacity.

GitHub derives the ProofLayer check status from the command exit code. The summary is written before that exit code is returned, and artifact upload runs even after failure. Finding text is whitespace-normalized, size-bounded, and HTML/Markdown escaped before publication.

## Alternatives considered

### Create a GitHub App and Checks API integration immediately

A GitHub App could create richer annotations and centralized policy, but it adds installation, token, webhook, hosting, and permission complexity. Workflow-native status and summaries satisfy the Phase 10 acceptance criteria without an account. A later hosted phase may add a GitHub App without replacing this local path.

### Use `pull_request_target`

That event can access base-repository privileges while handling forked code, which creates an unnecessary trust boundary for a workflow that installs and executes project dependencies. The standard `pull_request` event provides the required check with safer fork behavior.

### Publish only the terminal log

Logs are harder to scan and expire with the run. A job summary exposes gate reasons and contract findings directly, while the uploaded JSON and raw artifacts preserve complete traceability.

### Put summary generation in a later workflow step

A non-zero verification step normally stops subsequent ordinary steps. Generating and appending the summary inside `maru ci verify` guarantees the blocked result is explained before the check fails. Artifact upload remains a separate `always()` step.

### Download the CLI with an unpinned `npx` invocation

Runtime downloads can execute a different release from the one reviewed in the project lockfile. `npx --no-install` requires the repository to declare the CLI dependency and keeps installation reproducible through `npm ci`.

## Consequences

- A blocking contract finding produces a failed ProofLayer check and readable summary without any GitHub App.
- The workflow is safe for fork pull requests within the limits of executing untrusted code on an isolated GitHub-hosted runner with a read-only token and no repository secrets.
- Repositories must use npm with a committed lockfile and declare the package that provides the `maru` binary.
- Custom workflow content is never overwritten automatically; teams merge changes explicitly.
- Evidence upload may consume Actions artifact storage, bounded by a 14-day retention setting.
- Rich inline annotations, organization policy, and hosted synchronization remain future capabilities.
