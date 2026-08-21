# ADR-016: Ignore reproducible generated state

## Status

Accepted

## Date

2026-08-21

## Context

MaruCheck writes the current project scan, verification plan, and CI summary under
`.maru/generated/`. ADR-005 originally treated those files as versionable artifacts so developers
could inspect them before execution. In real repositories, each scan or plan refresh leaves the Git
worktree dirty even though the files are deterministic snapshots of current source, contracts, and
tooling.

Contracts, approval history, configuration, and QA memory encode durable intent or confirmed
history and remain appropriate for version control. Generated snapshots and run artifacts are
reproducible operational state.

## Decision

- Add `generated/` to the managed `.maru/.gitignore` entries alongside `artifacts/` and
  `connection.env`.
- Make `maru init` merge missing managed entries into both new and existing `.maru/.gitignore`
  files without replacing custom user entries or duplicating existing rules.
- Keep writing generated files to their stable paths so local tools, MCP clients, and CI can inspect
  or upload them during the current run.
- Keep `.maru/maru.yml`, `.maru/contracts/`, and `.maru/memory/` trackable.
- Do not mutate a repository's Git index from `maru init`. Repositories that previously committed
  generated files perform one explicit `git rm --cached -r -- .maru/generated` migration while the
  working files remain on disk.

This supersedes only ADR-005's generated-artifact tracking policy. Its typed, deterministic, and
inspectable verification-plan design remains accepted.

## Consequences

- Routine `maru scan`, `maru plan --diff`, and `maru verify --diff` commands no longer create
  persistent Git noise after initialization.
- Existing repositories receive the ignore rule by rerunning `maru init` after upgrading.
- CI can still upload ignored generated files because they remain present in the workspace.
- Historical generated plans are no longer retained through ordinary source commits; durable run
  evidence belongs in CI artifacts or the hosted MaruCheck dashboard.
- The one-time untracking step remains explicit because silently changing a user's Git index during
  initialization would be surprising and could interfere with in-progress work.

## Alternatives considered

### Keep generated plans versioned

Rejected because the current plan changes with normal development and creates a permanently noisy
worktree without adding durable product intent.

### Ignore only `verification-plan.json`

Rejected because project scans and generated CI summaries have the same reproducible lifecycle and
would continue producing similar noise.

### Automatically remove generated files from the Git index

Rejected because `maru init` is expected to preserve repository state. Updating an ignore file is
safe and idempotent; staging deletions on the user's behalf is not.
