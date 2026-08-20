# Phase 12: Security and accessibility adapters

`maru plan --diff` now turns relevant risk categories into explicit local verification work:

| Change signal                                                              | Planned verification                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Authentication, authorization, billing, or another security-sensitive path | Semgrep and Gitleaks                                                         |
| UI-only path                                                               | axe-backed Playwright accessibility suite                                    |
| Critical risk                                                              | Existing adversarial manual review remains in addition to automated scanners |

`maru verify --diff` runs the resulting adapters locally or in the existing GitHub pull-request workflow. The hosted application still stores evidence only; it does not execute repository code.

## axe

The target project must declare both `@axe-core/playwright` and Playwright and provide an affected Playwright accessibility test. MaruCheck invokes the project's Playwright CLI under the distinct `axe` adapter so its evidence remains typed as accessibility evidence.

For an npm project:

```bash
npm install --save-dev @axe-core/playwright @playwright/test
npx playwright install
```

The browser installation is an explicit project-owner setup step. MaruCheck never installs browsers during verification. If dependencies or a selected accessibility test are missing, the result is `unavailable` or `skipped`, never passed.

## Semgrep

MaruCheck resolves `semgrep` from a project `.venv`/`venv` or from `PATH`. It requires one reviewed local configuration:

```text
.semgrep.yml
.semgrep.yaml
semgrep.yml
semgrep.yaml
```

The adapter runs `semgrep scan` only against existing non-binary changed files, enables finding-sensitive exit codes, and writes JSON under the run artifact directory. Registry rule identifiers are intentionally not selected automatically, so verification remains reproducible and can run offline.

## Gitleaks

MaruCheck resolves `gitleaks` from a project `.venv`/`venv` or from `PATH`. It scans the current working tree with the tool's built-in default configuration, suppresses color/banner output, redacts detected secrets, and writes a JSON report under the run artifact directory. A project-level `.gitleaks.toml`, `.gitleaksignore`, or baseline remains owned by the target repository.

## Result semantics

- Exit code `0` is passing evidence.
- Scanner exit code `1` is failed security evidence because findings were detected.
- A higher scanner exit code is an adapter execution error, not a confirmed product finding.
- Missing tools, missing Semgrep rules, and empty selected work remain incomplete verification.
- Stdout and stderr stay bounded and every available native JSON report is linked into evidence.

See [ADR-011](../decisions/0011-run-risk-selected-local-security-and-accessibility-adapters.md) for the execution-boundary decision.
