# Phase 1: local CLI and repository scanner

Phase 1 provides a deterministic, local-only inventory of a Next.js or React repository. MaruCheck reads project metadata and source paths but does not execute package scripts or upload source code.

## Initialize a project

Run from the target project root:

```bash
maru init
```

This creates:

```text
.maru/
|-- .gitignore
|-- maru.yml
|-- artifacts/
|-- contracts/
|-- generated/
`-- memory/
```

Initialization is idempotent. An existing `.maru/maru.yml` is never overwritten. `.maru/artifacts/` is ignored by default because future evidence can contain logs and large local files; configuration, contracts, memory, and generated inventory remain versionable.

## Scan a project

```bash
maru scan
```

The command writes `.maru/generated/project-scan.json` with:

- detected package manager, frameworks, and languages;
- supported test frameworks and test files;
- common database libraries;
- GitHub Actions workflow files;
- Next.js App Router and Pages Router routes;
- production and development dependencies;
- source directories, files, and extension counts.

The scan stores portable relative paths and skips dependency, build, coverage, and Git metadata directories.

## Diagnose prerequisites

```bash
maru doctor
```

Each check reports `PASS`, `WARN`, or `FAIL` with remediation. Warnings do not fail the command; missing required runtime, Git, package-manager, or `.maru/maru.yml` configuration does.

## Error behavior

Expected failures use stable codes and include the failed operation and remediation. For example, running `maru scan` before initialization returns `MARU_NOT_INITIALIZED` and directs the developer to run `maru init`.
