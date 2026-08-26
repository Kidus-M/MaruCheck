# Contributing to MaruCheck

Thanks for helping MaruCheck test AI-authored changes under pressure. Bug reports, focused fixes,
documentation, adapters, and verification ideas are all welcome.

Looking for somewhere to start? [docs/contributing/starter-issues.md](docs/contributing/starter-issues.md)
lists scoped tasks with acceptance criteria and the files each one touches.

Every issue and pull request gets a reply within 24 hours, even when the reply is "this needs a few
days to look at properly". Before starting substantial work, open an issue so the behavior and
scope can be agreed without wasting implementation effort.

## Setup

Node.js 24 LTS and npm 11 or newer (see [Why Node 24](README.md#why-node-24)), then:

```bash
git clone https://github.com/Kidus-M/MaruCheck.git
cd MaruCheck
npm install
```

## Running the tests

```bash
npm test                 # Vitest, every package
npm run test:watch       # the same suites in watch mode
npm run typecheck        # tsc -b across the workspace project references
npm run lint             # ESLint
npm run format:check     # Prettier
npm run build            # workspace build plus the single-file dist/maru.cjs bundle
npm run check            # everything above, in the order CI runs it
```

`npm run check` is the gate. If it passes locally it passes in CI.

Exercising the CLI you just built:

```bash
npm run maru -- --help                 # the workspace build
node examples/quota-app/run.mjs        # the end-to-end example, blocked verdict included
npm run test:acceptance:semantic-drift # one scripted acceptance scenario
```

The acceptance scripts in `scripts/` (`test:acceptance:*`) drive real verification runs rather than
mocks. They are slower than `npm test` and are the fastest way to see whether a change altered a
verdict.

## Where things live

MaruCheck is a workspace of small packages under `packages/`, and the boundary that matters is
between the CLI and the verification libraries:

- `packages/cli` parses arguments, prints human-readable output, and maps a release gate to an exit
  code. It should contain no verification logic.
- `packages/core`, `git`, `risk`, `planner`, `execution`, `evidence`, `mutation`, `drift`,
  `memory`, `contracts` own the actual behavior, take explicit inputs, and return data. They must
  stay usable without a CLI, a network call, or a model.
- `packages/mcp-server` exposes a subset of those libraries to coding agents. It reads and
  proposes; it never approves.
- `packages/shared` holds cross-package primitives only. Anything that knows about a verification
  concept belongs in the package that owns that concept.

A change that adds output goes in `cli`; a change that adds a judgment goes in a library and gets
a test there. `docs/architecture/repository-boundaries.md` has the longer version.

## Adding a verification check

1. Add or extend an adapter in `packages/execution/src`. Adapters run local tools, capture raw
   output under `.maru/artifacts/runs/`, and must distinguish a real finding from a missing tool —
   MaruCheck never installs anything during a run.
2. Teach the planner when to select it (`packages/planner/src`), driven by risk classification
   rather than by a hard-coded file list.
3. Map its results to requirement evidence in `packages/evidence/src` so a failure becomes a
   finding with an expected value, an actual value, and a reproduction command.
4. Cover the new behavior with tests in the owning package, and add a guide under `docs/guides/`.

## Working agreements

- Keep the CLI usable without a cloud account, an API key, or an outbound request.
- Preserve the separation between implementation and independent verification.
- Do not silently change the meaning of a Quality Contract. Meaning changes go through
  `maru drift propose` and a human approval.
- Prefer deterministic output. Anything that varies between runs on the same input is a bug.
- Add tests for observable behavior, especially contract and verification semantics.
- Record expensive-to-reverse decisions as an ADR in `docs/decisions/`.

## What is likely to be accepted

- Bug fixes with a test that fails before the fix.
- New adapters, CI templates, and documentation, including worked Quality Contract examples.
- Ergonomics: clearer errors, better remediation text, machine-readable output.
- Support for more package managers, frameworks, and runtimes.

## What is likely to be declined

- Anything that makes an approval automatic, implicit, or agent-grantable.
- Sending source code, diffs, or evidence anywhere by default.
- Non-deterministic scoring, or a model call inside the verification path.
- Broad refactors that mix unrelated changes into one pull request.

## Pull requests

Keep changes focused and say what you verified. CI must pass formatting, linting, type checking,
tests, and the build. By submitting a contribution you agree that it may be distributed under the
repository's [MIT License](LICENSE).
