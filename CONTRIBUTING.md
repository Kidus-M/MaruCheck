# Contributing to MaruCheck CLI

## Development setup

1. Use Node.js 24 LTS and npm 11 or newer.
2. Run `npm install`.
3. Run `npm run check` before opening a pull request.

## Working agreements

- Keep the CLI usable without a cloud account.
- Preserve the separation between implementation and independent verification.
- Add tests for observable behavior, especially contract and verification semantics.
- Do not silently change the meaning of a Quality Contract.
- Record expensive-to-reverse decisions in `docs/decisions/`.

## Pull requests

Keep changes focused and explain what was verified. CI must pass formatting, linting, type checking, tests, and builds.
