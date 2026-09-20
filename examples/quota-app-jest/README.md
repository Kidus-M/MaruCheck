# Example: the same failure, on Jest

This is [`examples/quota-app`](../quota-app/README.md) with the runner swapped. Same bug report,
same agent change, same approved Quality Contract, same verdict — but the project is plain
CommonJS JavaScript tested with Jest, which is what most repositories that need this actually look
like.

An AI agent is asked to fix a plausible bug report: _"paying users are still throttled right after
upgrading."_ It changes the quota code, updates the tests it owns, and everything is green. The
change is also wrong twice over: it raises the free-plan limit from 10 to 1000 and it starts
trusting the plan tier the browser claims.

## Run it

```bash
git clone https://github.com/Kidus-M/MaruCheck.git
cd MaruCheck
npm install && npm run build     # or skip this: the runner falls back to npx marucheck@0.5.0
node examples/quota-app-jest/run.mjs
```

`node examples/quota-app-jest/run.mjs --clean` removes the workspace afterwards.

There is no Jest config file and no TypeScript transform in this fixture: `jest` runs it as-is, so
the only install is Jest itself.

## What you see

```text
6. Run the test suite the agent maintains
   Tests:       4 passed, 4 total
   Green. Every test the agent owns passes.

8. Verify the change against the approved contract
   Verification gate: BLOCKED
   Findings: 5 (5 blocking)

   [HIGH] BLOCKING finding-001-usage-quota-quota-001: QUOTA-001 verification failed
   Expected: Free plan users may perform at most 10 generations per calendar month.
   Evidence: evidence-001-jest

9. Compare observed behavior with protected contract meaning
   Semantic drift: BLOCKED
```

MaruCheck ran `jest --ci --runTestsByPath src/quota.test.js tests/usage-quota.contract.test.js`,
which is the selection from the verification plan rather than the whole suite. Jest's own
`--json` report is kept in the run directory, so the per-assertion truth is inspectable:

```bash
node -e "const r=require('./.workspace/.maru/artifacts/runs/<run>/jest/report.json');
console.log(r.numTotalTests, r.numFailedTests)"
# 7 2
```

Seven tests ran: the agent's four, which pass, and the contract regression suite's three, of which
two fail. `npm test` never runs that second file.

## What is in the fixture

| Path                                 | Role                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `src/quota.js`                       | The metered endpoint's business logic, as approved                      |
| `src/quota.test.js`                  | The unit suite the agent authors and maintains                          |
| `tests/usage-quota.contract.test.js` | The contract regression suite, owned by whoever owns the contract       |
| `contracts/usage-quota.yml`          | The Quality Contract: requirements, invariants, and its evidence policy |
| `agent-change/src/`                  | Exactly what the agent changed — the diff applied in step 5             |
| `observations.json`                  | Behavior observed after the change, in the contract's own vocabulary    |
| `run.mjs`                            | The runner that wires the above into one command                        |

## Which runner MaruCheck picks

`maru init` and `maru plan --diff` read the declared test frameworks from the project manifest. A
project with Vitest gets the Vitest adapter; a project with Jest gets the Jest adapter; a project
with both gets Vitest, so one run covers the change. Nothing else about verification changes — the
plan, the evidence, the findings, and the release gate are the same objects either way.

For the full explanation of what the example demonstrates, read the
[Vitest example's README](../quota-app/README.md); everything there applies here.
