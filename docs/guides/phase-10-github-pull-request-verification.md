# Phase 10: GitHub pull-request verification

Phase 10 turns the local release gate into a GitHub pull-request check without requiring a GitHub App or MaruCheck account.

## Prerequisites

The target repository must have:

- Node.js project metadata and a committed `package-lock.json`;
- the package that provides the `maru` binary declared in `dependencies` or `devDependencies`;
- MaruCheck initialized with `maru init`;
- reviewed Quality Contracts and the local test tools used by its verification plan.

Install the published package at an exact version before generating the workflow:

```bash
npm install --save-dev --save-exact marucheck@0.2.1
```

The generated workflow intentionally uses `npx --no-install`: GitHub installs exactly what the
repository lockfile declares and never downloads an unreviewed CLI release during verification.

## Install the workflow

From the target repository root:

```bash
npx --no-install maru ci init
```

This creates `.github/workflows/marucheck.yml`. Running the command again is safe when the generated content is unchanged. If that path contains custom content, MaruCheck refuses to overwrite it and asks you to merge the steps manually.

Review and commit the workflow with the project. `maru ci init` only changes the local repository; it does not push, create a pull request, or change GitHub settings.

## What the workflow does

For each `pull_request`, the `ProofLayer` job:

1. checks out the pull-request revision without persisting credentials;
2. selects Node.js 24 and restores npm's package cache;
3. runs `npm ci` from the committed lockfile;
4. runs `npx --no-install maru ci verify`;
5. uploads `.maru/artifacts/`, the verification plan, and the GitHub summary even when verification fails.

The workflow uses only `contents: read`. It does not receive repository secrets for forked pull requests and does not use `pull_request_target`.

## Check status and summary

`maru ci verify` executes the same planner, adapters, evidence normalization, and release gate as `maru verify --diff`. It additionally writes:

```text
.maru/generated/github-summary.md
```

On GitHub Actions, the command also appends that Markdown to `GITHUB_STEP_SUMMARY` before it exits. The summary includes:

- passed or blocked gate state;
- project, risk, run, evidence, requirement, and finding counts;
- gate reasons;
- up to 20 findings with severity, contract requirement, expected and actual behavior, reproduction command, and evidence paths;
- the full JSON report path.

When the report gate is blocked, the command exits 1. GitHub uses that non-zero exit to mark the `ProofLayer` check as failed. When the gate passes, it exits 0. No status API call or GitHub App is involved.

Run the CI behavior locally at any time:

```bash
maru ci verify
```

A local run writes the artifact summary but reports `Published to GitHub: no (local run)` because `GITHUB_STEP_SUMMARY` is only supplied by the runner.

## Evidence artifacts

The upload step uses `if: always()` so evidence survives both successful and blocked checks. Hidden-file inclusion is explicit because `.maru/` is hidden and current `actions/upload-artifact` releases exclude hidden paths by default. Artifacts are retained for 14 days.

Before enabling additional artifact paths, verify they cannot contain secrets, environment files, tokens, or production payloads.

## Branch protection

After the workflow has run at least once, a repository administrator may make the `ProofLayer` check required in the branch protection or ruleset settings. That is an external repository policy change and is intentionally not performed by the CLI.

## Acceptance fixture

Run:

```bash
npm run test:acceptance:pull-request-check
```

The fixture installs the workflow, supplies a critical invoice-ownership contract violation, and succeeds only when `maru ci verify` returns exit code 1 and both the artifact and GitHub summaries contain readable expected, actual, contract, and reproduction details.

See [ADR-010](../decisions/0010-use-workflow-native-pull-request-verification.md) for the security and architecture rationale.
