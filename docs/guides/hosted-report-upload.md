# Hosted report upload

Use hosted upload when a team wants to inspect completed MaruCheck proof in the shared dashboard.
Verification and source execution remain in the developer repository or its CI runner.

## Connect once

1. Sign in to the MaruCheck web application.
2. Connect a project using the exact name reported by `maru scan`.
3. Copy the two-line connection setup into `.maru/connection.env`.
4. Run `maru init` when upgrading an older project so `.maru/.gitignore` contains
   `connection.env`.

```dotenv
MARUCHECK_URL=https://your-marucheck-host
MARUCHECK_TOKEN=maru_your_project_token
```

MaruCheck refuses to load credentials from a file Git does not report as ignored. CI can provide
the same names through its encrypted secret store instead.

## Verify and upload

```bash
npx --no-install maru verify --diff
npx --no-install maru upload
```

The command selects the valid version 1 report with the newest generated timestamp, reads the
current branch, commit SHA, and latest commit title from Git, and submits the envelope to
`/api/v1/ingest/runs`. Use `--report` or `--url` only for an explicit override.

The upload is independent from the report gate. Uploading a blocked report is useful because it
lets reviewers inspect the evidence that prevented release.

## Boundary and failures

The upload includes the generated report, Git identity fields, and artifact path references. It
does not read or upload source files, artifact file contents, or repository secrets.

- `HOSTED_AUTH_REQUIRED`: set or recopy `MARUCHECK_TOKEN`.
- `HOSTED_URL_INVALID`: use an HTTPS application origin; HTTP is allowed only for localhost.
- `HOSTED_REPORT_NOT_FOUND`: run `maru verify --diff` first.
- `HOSTED_REPORT_UNREADABLE`: pass a regular, non-symlink report inside the repository.
- `HOSTED_REPORT_INVALID`: generate a new schema version 1 report with `maru verify --diff`.
- `HOSTED_GIT_METADATA_FAILED`: run from a committed, readable Git repository.
- `HOSTED_REQUEST_FAILED`: inspect the HTTP status, project-name match, and token lifecycle, then
  retry the same report.

The host upserts by token-bound project and run ID, so retrying after a timeout does not create an
unrelated duplicate run.
