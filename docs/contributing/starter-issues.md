# Starter issues

Scoped, self-contained work with acceptance criteria and the files each task touches. Open the
matching GitHub issue (or comment on it) before starting so two people do not pick up the same one.
Every issue and pull request gets a reply within 24 hours.

Contents:

- [`good first issue`](#good-first-issue)
  - [Add `--json` output to `maru risk` and `maru verify`](#add---json-output-to-maru-risk-and-maru-verify)
  - [Make `maru doctor` print the exact fix for what it found](#make-maru-doctor-print-the-exact-fix-for-what-it-found)
  - [Detect pnpm, yarn, and bun in `maru init`](#detect-pnpm-yarn-and-bun-in-maru-init)
  - [Report one finding per failed assertion](#report-one-finding-per-failed-assertion)
- [`help wanted`](#help-wanted)
  - [A Quality Contract cookbook](#a-quality-contract-cookbook)
  - [GitLab CI and CircleCI workflow templates](#gitlab-ci-and-circleci-workflow-templates)
  - [Widen the supported Node.js range](#widen-the-supported-nodejs-range)

## `good first issue`

### Add `--json` output to `maru risk` and `maru verify`

**Why.** Teams want to gate their own pipelines on MaruCheck's decision without parsing terminal
text. `verify` already writes `report.json`; the missing piece is printing the same object to
stdout on request, and giving `risk` an equivalent.

**Where.** `packages/cli/src/cli.ts` (argument parsing and the `risk` / `verify` branches),
`packages/evidence/src/index.ts` (the report object already exists), `packages/risk/src/index.ts`
(the assessment object already exists).

**Acceptance criteria.**

- `maru risk --diff --json` prints the risk assessment as a single JSON document and nothing else.
- `maru verify --diff --json` prints the same object that lands in `report.json`.
- Exit codes are unchanged: a blocked gate still exits 1.
- Human output is unchanged when the flag is absent.
- Invalid flag combinations produce the existing usage error rather than partial JSON.
- Tests in `packages/cli/src/cli.test.ts` cover both commands, including the blocked exit code.

### Make `maru doctor` print the exact fix for what it found

**Why.** `doctor` is the first command most people run after `init`, so every unactionable line
there is a first-run bounce.

**Where.** `packages/core/src/project/doctor.ts`, plus the detected package manager in
`packages/core/src/project/stack-detector.ts`.

**Acceptance criteria.**

- Every failed or missing check prints a copy-pasteable remediation command.
- The command matches the detected package manager (`npm install -D vitest` versus
  `pnpm add -D vitest`, and so on).
- Tools that are not installed through a package manager (Semgrep, Gitleaks, Playwright browsers)
  print their documented install command instead.
- MaruCheck still installs nothing itself.
- `packages/core/src/project` tests cover at least one remediation per package manager.

### Detect pnpm, yarn, and bun in `maru init`

**Why.** Detection is npm-shaped today, which quietly narrows who can adopt the tool.

**Where.** `packages/core/src/project/stack-detector.ts`, `packages/core/src/project/initialize.ts`.

**Acceptance criteria.**

- A lockfile for pnpm, yarn, or bun sets the detected package manager.
- `packageManager` in `package.json` wins over lockfile inference when both are present.
- The detected manager appears in `maru init` output and in `.maru/generated/project-scan.json`.
- Tests cover each lockfile and the ambiguous case of two lockfiles.

### Report one finding per failed assertion

**Why.** A failing adapter run currently maps to every requirement the step selected, so a single
broken assertion can produce five blocking findings that all quote the same output. See
[`examples/quota-app`](../../examples/quota-app/README.md) for a reproduction: two failures, five
findings.

**Where.** `packages/execution/src/index.ts` (parse per-test results, not just the exit code),
`packages/evidence/src/index.ts` (link evidence to the requirement whose test actually failed).

**Acceptance criteria.**

- Vitest results are parsed per test file and per test name.
- A requirement is only marked failed when a test linked to it failed.
- Requirements whose selected tests passed are reported as passed.
- The example produces two blocking findings instead of five, and `npm run example` still exits 0
  because the gate is still blocked.
- Existing evidence tests are updated rather than deleted.

## `help wanted`

### A Quality Contract cookbook

**Why.** Contract authoring is the steepest part of the learning curve, and one worked example
(`examples/contracts/subscription-management.yml`) is not enough to generalize from.

**Where.** New files under `examples/contracts/`, linked from
`docs/guides/phase-2-quality-contracts.md`.

**Acceptance criteria.**

- Six to eight contracts covering authentication, authorization, payments, data retention, rate
  limiting, file upload, and multi-tenant isolation.
- Every contract validates: `maru contract validate examples/contracts/<file>.yml`.
- Each one includes at least one invariant and a non-empty `evidence_policy.blocking_requirements`.
- Each file opens with a short comment explaining what makes it a hard case.

### GitLab CI and CircleCI workflow templates

**Why.** `maru ci init` covers GitHub Actions only. Someone who uses GitLab daily will write a
better template than the maintainer would.

**Where.** `packages/ci/src`, mirroring the GitHub workflow installer, plus a guide under
`docs/guides/`.

**Acceptance criteria.**

- `maru ci init --provider gitlab` and `--provider circleci` write an idempotent, least-privilege
  configuration.
- The pipeline uploads `.maru` evidence even when the gate blocks.
- The gate maps to the job's exit status the way the GitHub workflow does.
- Re-running the command does not duplicate or clobber existing configuration.
- Tests cover the generated file contents and idempotency.

### Widen the supported Node.js range

**Why.** `engines.node` claims `>=24`, which excludes teams on 20 and 22. Nothing in the source is
known to require Node 24; the constraint is that nothing else is tested.

**Where.** `.github/workflows/ci.yml` (the informational `node-compatibility` job), `package.json`
(`engines`), the `--target` in `build:bundle`, and [Why Node 24](../../README.md#why-node-24).

**Acceptance criteria.**

- The Node 22 job passes `npm run check` and the example, and stops being `continue-on-error`.
- A Node 20 job is added and either passes or the failure is documented.
- `engines.node` is lowered to the oldest version that is actually green in CI.
- The build target and the README rationale are updated to match.
