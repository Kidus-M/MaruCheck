# ADR-011: Run risk-selected local security and accessibility adapters

## Status

Accepted

## Date

2026-08-20

## Context

The verification planner already recommends security checks for security-sensitive changes and accessibility checks for UI changes, but it previously represented security as manual review and accessibility as ordinary Playwright execution. Phase 12 must make axe, Semgrep, and Gitleaks first-class evidence producers without moving source execution into the hosted application or downloading unreviewed tools and rules during verification.

Security tools have different failure contracts from test frameworks. A finding-sensitive exit code indicates product evidence; a scanner startup/configuration error indicates missing verification. Secret-scanner output can itself expose sensitive material unless redaction is mandatory.

## Decision

Extend the existing plan, raw-run, and evidence models additively with `axe`, `semgrep`, and `gitleaks` adapter values, optional changed-file targets, native JSON report references, and a `security-scan` evidence type. Keep the current schema version because existing fields retain their meaning and the new fields are optional; consumers must treat adapter names as an extensible vocabulary.

Risk-driven selection works as follows:

- authentication, authorization, billing, or another security-sensitive classification recommends security verification;
- every security recommendation expands into separate Semgrep and Gitleaks steps;
- accessibility selects axe only when the project declares Playwright and `@axe-core/playwright`;
- adversarial edge cases continue to require manual review.

All execution remains shell-free and local/CI:

- axe runs selected project Playwright accessibility suites through the project-local Playwright CLI;
- Semgrep resolves from a project virtual environment or `PATH`, requires reviewed local YAML rules, scans only existing changed source targets, and writes JSON;
- Gitleaks resolves from a project virtual environment or `PATH`, scans the current working tree, forces output redaction, and writes JSON.

MaruCheck does not invoke package managers, install browsers, download scanners, or resolve network rule registries during a verification run. Missing dependencies/configuration produce explicit unavailable evidence. Scanner exit code 1 represents findings; higher scanner exit codes represent execution errors.

## Alternatives considered

### Download tools automatically with `npx`, pip, or release archives

Runtime downloads weaken reproducibility and expand the code-execution supply-chain boundary. Projects install and pin the tools they trust; MaruCheck only detects and invokes them.

### Use Semgrep `--config auto`

Automatic community-rule resolution is convenient but can require network access and can change independently of the repository. Requiring a local reviewed configuration keeps scans reproducible and offline-capable.

### Treat every security change as one generic scanner step

Static code analysis and secret detection cover different failure classes and produce different artifacts. Separate steps keep missing coverage and findings attributable.

### Inject axe into arbitrary pages automatically

Starting an application and choosing authenticated routes requires project-specific lifecycle and state. Existing project-owned Playwright accessibility suites preserve that context and avoid inventing navigation or credentials.

## Consequences

- Auth and billing diffs automatically produce concrete security work instead of a generic manual placeholder.
- Scanner findings block through the existing evidence gate and retain redacted raw artifacts.
- Teams must install scanners and commit reviewed Semgrep rules before those steps can pass.
- Accessibility depth depends on project-owned Playwright scenarios; MaruCheck does not claim coverage for routes the suite never visits.
- The web repository remains isolated from source execution and continues to ingest versioned evidence metadata only.
