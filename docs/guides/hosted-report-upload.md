# Hosted report upload

Use hosted upload when a team wants to inspect completed MaruCheck proof in the shared dashboard.
Verification and source execution remain in the developer repository or its CI runner.

## Connect once

1. Sign in to the MaruCheck web application.
2. Connect a project using the exact name reported by `maru scan`.
3. Copy the one-time project token and store it as `MARUCHECK_TOKEN` in the shell or CI secret store.
4. Do not commit the token or place it directly in a command.

## Verify and upload

```bash
npx --no-install maru verify --diff
npx --no-install maru upload \
  --report .maru/artifacts/runs/<run-id>/report.json \
  --url https://your-marucheck-host
```

Set `MARUCHECK_URL` to the application origin if you prefer to omit `--url`. The command reads the
current branch, commit SHA, and latest commit title from Git, wraps the selected version 1 report,
and submits it to `/api/v1/ingest/runs`.

The upload is independent from the report gate. Uploading a blocked report is useful because it
lets reviewers inspect the evidence that prevented release.

## Boundary and failures

The upload includes the generated report, Git identity fields, and artifact path references. It
does not read or upload source files, artifact file contents, or repository secrets.

- `HOSTED_AUTH_REQUIRED`: set or recopy `MARUCHECK_TOKEN`.
- `HOSTED_URL_INVALID`: use an HTTPS application origin; HTTP is allowed only for localhost.
- `HOSTED_REPORT_UNREADABLE`: pass a regular, non-symlink report inside the repository.
- `HOSTED_REPORT_INVALID`: generate a new schema version 1 report with `maru verify --diff`.
- `HOSTED_GIT_METADATA_FAILED`: run from a committed, readable Git repository.
- `HOSTED_REQUEST_FAILED`: inspect the HTTP status, project-name match, and token lifecycle, then
  retry the same report.

The host upserts by token-bound project and run ID, so retrying after a timeout does not create an
unrelated duplicate run.
