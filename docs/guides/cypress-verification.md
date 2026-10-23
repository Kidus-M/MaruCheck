# Cypress verification

MaruCheck can discover and execute existing Cypress end-to-end tests as part of a
requirement-linked verification plan. It uses the project's installed Cypress,
configuration, and browser dependencies. Verification never installs Cypress or
downloads browsers, and Cypress Cloud recording is disabled.

## Detection and selection

Cypress is detected from a declared `cypress` dependency or a root-level
`cypress.config.ts`, `cypress.config.js`, `cypress.config.mjs`, or
`cypress.config.cjs`. Configuration is detected without evaluating it during the
project scan. Cypress loads and validates its configuration when tests execute.

The scanner recognizes `cypress/e2e/` and `.cy.ts`, `.cy.js`, `.cy.tsx`, and
`.cy.jsx` files. Cypress-specific paths take precedence over Vitest and Playwright
classification in mixed-runner projects. Support files and fixtures outside these
test patterns are not selected as tests.

When risk analysis recommends end-to-end verification, the planner selects
affected Cypress specs using the same change terms and requirement links as other
test adapters. When Cypress and Playwright are both detected, each receives its
own step with its own affected test files. An empty selection remains incomplete;
MaruCheck does not fall back to executing the entire suite.

## Running verification

Install and configure Cypress yourself before verification. Start any application
server required by the project's tests, then run from the project root:

```sh
maru init
maru scan
maru plan --diff
maru verify --diff
```

The adapter invokes the local Cypress Module API in the existing command runner,
using `testingType: "e2e"`, `record: false`, and only the selected specs. Existing
project settings such as `baseUrl`, retries, support files, and node events remain
under the project's control. Screenshot, video, and download destinations are
redirected into the current run's artifact directory. Video is captured only if
the project enables it. Application-server management and component testing are
outside this adapter's scope.

Spec paths must be project-relative literal paths without commas or glob
characters (`*`, `?`, `[`, `]`, `{`, `}`, `!`, `(`, `)`). Such paths are rejected rather than
expanded into tests the plan did not select.

## Results and artifacts

Under `.maru/artifacts/runs/<run>/cypress/`, MaruCheck retains:

- `stdout.txt` and `stderr.txt` from the command runner.
- `report.json`, the structured Cypress Module API result, including test
  attempts, spec errors, duration, and screenshot/video paths where available.
- `test-output/`, containing screenshots, videos, and downloads where produced.

`run.json` and the evidence report include normalized individual test names,
files, final outcomes, durations, and assertion errors. Retried tests use their
final Cypress outcome; pending tests normalize to skipped. Requirement evidence
and findings use the existing adapter-level linking model.

| Condition                                                             | Result                                       |
| --------------------------------------------------------------------- | -------------------------------------------- |
| Selected tests pass                                                   | Passed verification                          |
| A selected test fails                                                 | Failed verification and requirement findings |
| Selected tests are pending/skipped, with no failures                  | Incomplete verification                      |
| No tests are selected or executed                                     | Incomplete verification                      |
| Cypress package or cached binary is missing                           | Unavailable tooling                          |
| Configuration cannot load or validate                                 | Execution error (`CYPRESS_CONFIG_INVALID`)   |
| Browser/spec compilation fails, or execution times out                | Execution error                              |
| Report is absent, malformed, or disagrees with selected specs/results | Execution error (`CYPRESS_REPORT_INVALID`)   |

Missing tooling, setup errors, and incomplete verification remain distinct from
test failures and cannot satisfy a blocking requirement. Inspect the linked raw
report and captured output for remediation. MaruCheck adds no cloud request;
project tests and Cypress plugins can still access the services they configure.
