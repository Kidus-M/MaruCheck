# Example: a green test suite that proves the wrong product

A runnable, self-contained MaruCheck example. It takes about a minute and needs no account,
no API key, and no network access beyond one `npm install`.

An AI agent is asked to fix a plausible bug report: _"paying users are still throttled right
after upgrading."_ It changes the quota code, updates the tests it owns, and everything is
green. The change is also wrong twice over: it raises the free-plan limit from 10 to 1000 and
it starts trusting the plan tier the browser claims.

Nothing in a normal pipeline objects. The tests agree with the code, because the same actor
wrote both. MaruCheck objects, because the approved Quality Contract is the authority and the
agent cannot edit it.

## Run it

```bash
git clone https://github.com/Kidus-M/MaruCheck.git
cd MaruCheck
npm install && npm run build     # or skip this: the runner falls back to npx marucheck@0.4.0
node examples/quota-app/run.mjs
```

`node examples/quota-app/run.mjs --clean` removes the workspace afterwards.

The runner copies this fixture into `examples/quota-app/.workspace/`, commits the approved
baseline there as its own Git repository, approves the contract, applies the agent's change on
top, and then runs the same commands you would run yourself.

## What you see

```text
6. Run the test suite the agent maintains
   Test Files  1 passed (1)
        Tests  4 passed (4)
   Green. Every test the agent owns passes.

7. Score the change
   Risk: MODERATE (30/100)
   Related contracts: usage-quota
     +10 Changes production business logic.
     +15 Matches high Quality Contract usage-quota.

8. Verify the change against the approved contract
   Verification gate: BLOCKED
   Findings: 5 (5 blocking)

   [HIGH] BLOCKING finding-001-usage-quota-quota-001: QUOTA-001 verification failed
   Expected: Free plan users may perform at most 10 generations per calendar month.
   Actual:   Received: "pro"

9. Compare observed behavior with protected contract meaning
   Semantic drift: BLOCKED
   [usage-quota#QUOTA-001] BLOCKING
   Contract: Free plan users may perform at most 10 generations per calendar month.
   Observed: Free plan users may perform at most 1000 generations per calendar month.
```

Full evidence lands in `.workspace/.maru/` as files you can open: the verification plan that
explains which tests were selected and why, the raw adapter output, and `report.json`.

## What is in the fixture

| Path                                 | Role                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `src/quota.ts`                       | The metered endpoint's business logic, as approved                      |
| `src/quota.test.ts`                  | The unit suite the agent authors and maintains                          |
| `tests/usage-quota.contract.test.ts` | The contract regression suite, owned by whoever owns the contract       |
| `contracts/usage-quota.yml`          | The Quality Contract: requirements, invariants, and its evidence policy |
| `agent-change/src/`                  | Exactly what the agent changed — the diff applied in step 5             |
| `observations.json`                  | Behavior observed after the change, in the contract's own vocabulary    |
| `run.mjs`                            | The runner that wires the above into one command                        |

## The two mechanisms this demonstrates

**Contract-selected verification.** `maru verify --diff` scores the diff, matches it to the
`usage-quota` contract, and selects both suites — including the contract regression suite that
`npm test` does not run. That suite still asserts the approved behavior, so it fails, and
because `QUOTA-001` and `QUOTA-INV-001` are blocking requirements of an _approved_ contract, the
release gate is blocked rather than merely noisy. A draft contract would have produced advisory
findings instead.

Every selected requirement of the failing step is reported, so all five appear in the findings
even though two assertions failed. The requirement statements and the raw adapter output next to
them are what tell you which is which.

**Semantic drift.** `maru drift check --from observations.json` compares observed behavior with
protected contract meaning, one requirement reference at a time, with no model in the loop.
"At most 1000 generations" is not "at most 10", so it blocks — and the only way through is a
human approving an amendment (`maru drift propose`, then `maru drift approve`), which leaves an
audit record. The agent can ask for a verdict; it cannot grant one.

## The same example on Jest

[`examples/quota-app-jest`](../quota-app-jest/README.md) is this fixture in CommonJS JavaScript
with Jest instead of Vitest. Same contract, same agent change, same verdict — useful for checking
that the gate behaves identically on the runner your project actually uses.

## Try changing it

- Revert the limit in `agent-change/src/quota.ts` to `10` but keep the claimed-plan change: the
  drift check narrows to one conflict and verification still blocks on `QUOTA-INV-001`.
- Set `status: draft` in `contracts/usage-quota.yml`: the same findings appear as advisory and
  the gate passes. Approval is what makes a contract binding.
- Delete `tests/usage-quota.contract.test.ts`: verification blocks with a verification _gap_
  instead of a failure, because a blocking requirement lost its evidence.
