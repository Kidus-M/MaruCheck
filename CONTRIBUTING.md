# Contributing to MaruCheck CLI

Thanks for helping MaruCheck test AI-authored changes under pressure. Bug reports, focused fixes,
documentation improvements, adapters, and verification ideas are welcome.

Before starting substantial work, open an issue so the proposed behavior and scope can be agreed
without wasting implementation effort.

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

By submitting a contribution, you agree that it may be distributed under the repository's
[MIT License](LICENSE).
