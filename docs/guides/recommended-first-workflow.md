# Recommended first workflow

Use MaruCheck first on one real, reviewable feature change. Learn the local contract-to-evidence
loop before adding hosted reporting, MCP, or a required CI gate.

## Prerequisites

- Node.js 24 or newer;
- npm 11 or newer;
- Git;
- an existing Next.js, React, or TypeScript repository with its normal tests installed.

Run every command from that repository's root.

## 1. Pin the current release

```bash
npm install --save-dev --save-exact marucheck@0.4.0
npx --no-install maru --version
npx --no-install maru init
```

Use an exact project dependency instead of a global install for team and CI work. This records the
same CLI version in `package.json` and `package-lock.json`, and `--no-install` prevents an implicit
download.

Commit `.maru/maru.yml`, reviewed contracts, and confirmed QA memory. Leave
`.maru/generated/`, `.maru/artifacts/`, and `.maru/connection.env` ignored. Rerunning `maru init`
upgrades MaruCheck's managed ignore entries without replacing repository-specific entries.

## 2. Check the repository boundary

```bash
npx --no-install maru doctor
npx --no-install maru scan
```

Read every warning before continuing. MaruCheck detects existing project tools but does not install
missing test, browser, accessibility, or security dependencies during verification.

## 3. Contract one feature

Write a small requirements file for the behavior being changed:

```text
Invoice access

- A signed-in user can read invoices owned by their organization.
- A user cannot read an invoice owned by another organization.
- Client-supplied organization identifiers never grant access.
```

Create and inspect a draft:

```bash
npx --no-install maru contract create --from requirements.md
npx --no-install maru contract list
npx --no-install maru contract validate
```

Review the generated YAML under `.maru/contracts/`. Add precise edge cases and evidence policy,
then approve it only when an accountable owner accepts the intent:

```bash
npx --no-install maru contract approve <contract-id> --by <owner>
```

Draft and review contracts are useful for planning but their proposed evidence policies remain
advisory. Approval activates their blocking requirements. High or critical risk and security rules
can still independently require blocking checks.

## 4. Verify one real diff

```bash
npx --no-install maru risk --diff
npx --no-install maru plan --diff
npx --no-install maru verify --diff
```

Review the risk reasons and generated plan before verification. A missing adapter is unavailable or
inconclusive, never passed. The complete result is written to
`.maru/artifacts/runs/<run-id>/report.json`, and a blocked gate returns a non-zero exit code.

Do not weaken a contract or its tests just to make the gate pass. Fix the implementation, add the
missing evidence, or propose and separately approve a genuine product-intent change.

## 5. Add shared proof when useful

For a team dashboard:

1. Connect the repository in the MaruCheck web application.
2. Copy the generated two-line setup into `.maru/connection.env`.
3. Run a fresh verification.
4. Upload the newest report:

```bash
npx --no-install maru upload
```

The project token selects the dashboard destination. The dashboard display name does not need to
match the local project name. Upload is explicit and includes normalized report metadata, Git
identity, and artifact path references—not source code or artifact contents.

## 6. Add AI and CI after the local loop works

- Configure `maru mcp` for Codex, Claude Code, Cursor, or another MCP client. Let the agent inspect
  context, contracts, memory, risk, and the plan before allowing verification.
- Use a genuinely fresh thread or subagent for Challenger review of high-risk or release changes.
  MaruCheck does not require another model provider or API key.
- Run `maru ci init`, review the generated workflow, and commit it only after local gate behavior is
  understood. The workflow pins repository dependencies and runs `maru ci verify` on pull requests.
- Require the GitHub check through branch rules only after the workflow has completed successfully
  on the repository.

## Good initial defaults

- Start with one high-value or failure-prone feature, not a contract for the entire codebase.
- Keep contracts narrow, observable, and owned.
- Pin the CLI exactly in every shared repository.
- Keep verification local-first; upload reports only when the team needs shared proof.
- Record a bug in QA memory only after its root cause and regression test are confirmed.
- Use mutation and Challenger checks selectively for high-risk changes.
- Treat inconclusive evidence as work to investigate, not proof that behavior is broken or correct.
