# Phase 3: MCP integration

MaruCheck runs as a local Model Context Protocol server over newline-delimited stdio. Configure the
coding agent to start the published package with the target project's directory as its working
directory:

```bash
npx --yes marucheck@0.2.0 mcp
```

For reproducible team use, install the exact package in the target project and prevent implicit
downloads:

```bash
npm install --save-dev --save-exact marucheck@0.2.0
npx --no-install maru mcp
```

Contributors changing MaruCheck itself may still run the source build with
`node /path/to/maru-cli/packages/cli/dist/index.js mcp`.

The process writes only valid JSON-RPC messages to stdout. Close its stdin to stop it.

## Tools

| Tool                              | Behavior                                                                            | Access                         |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| `maru_get_project_context`        | Return project architecture, test inventory, routes, and contract summaries         | Read-only                      |
| `maru_list_contracts`             | List contract lifecycle, criticality, path, and version hash                        | Read-only                      |
| `maru_get_contract`               | Return one validated contract and its stable version hash                           | Read-only                      |
| `maru_create_contract`            | Create a review-required draft from requirements; never approve it                  | Local write                    |
| `maru_validate_contract`          | Validate every current contract or one project-root-bounded path                    | Read-only                      |
| `maru_analyze_diff`               | Return bounded staged, unstaged, and untracked change metadata and classifications  | Read-only                      |
| `maru_assess_risk`                | Return deterministic risk, reasons, related contracts, and test categories          | Read-only                      |
| `maru_create_verification_plan`   | Write a requirement-linked, risk-based verification plan                            | Local write                    |
| `maru_run_verification`           | Execute tests and persist raw artifacts, evidence, findings, and JSON report        | Local write and code execution |
| `maru_run_mutation_verification`  | Test selected tests against bounded mutations in an isolated Git worktree           | Local write and code execution |
| `maru_prepare_challenge`          | Write a bounded brief for an isolated client QA thread or subagent                  | Local write                    |
| `maru_submit_challenge`           | Validate and persist an attested, scope-checked Challenger response                 | Local write                    |
| `maru_check_semantic_drift`       | Compare observations with protected contract expectations                           | Read-only                      |
| `maru_propose_contract_amendment` | Write an immutable pending amendment; never approve or rewrite the current contract | Local write                    |
| `maru_record_bug`                 | Record a confirmed bug, root cause, links, tags, and regression tests               | Local write                    |
| `maru_query_memory`               | Search historical QA memory with explainable matches                                | Read-only                      |

Every tool publishes a closed JSON input schema, a structured JSON result, and a JSON text fallback. Tool execution errors include a stable code, safe message, remediation, and validation issues when available.

Project context returns totals plus at most 100 source, route, test, dependency, and contract items per category. The complete scan remains available locally at `.maru/generated/project-scan.json`, preventing large repositories from consuming an agent's context window unnecessarily.

## Codex

Codex can store MCP settings in the user configuration or a trusted project's `.codex/config.toml`.
The sibling `maru-web` repository includes this portable project-scoped configuration:

```toml
[mcp_servers.maru]
command = "npx"
args = ["--yes", "marucheck@0.2.0", "mcp"]
required = false
default_tools_approval_mode = "writes"
```

`required = false` means Codex still opens normally if the package cannot start. For an exact
project dependency, replace the arguments with `["--no-install", "maru", "mcp"]`.

Alternatively, add the published server while inside the target project:

```powershell
codex mcp add maru -- npx --yes marucheck@0.2.0 mcp
codex mcp list
```

Trust the project when Codex prompts, restart the Codex host after changing configuration, then use `/mcp` to inspect the connection.

This file is only a Codex convenience. The `maru mcp` process uses standard MCP stdio and does not depend on Codex, so other clients can use the same server command.

## Claude Code

From the target project, add a project-scoped stdio server:

```powershell
claude mcp add maru --scope project -- npx --yes marucheck@0.2.0 mcp
claude mcp list
```

Claude Code writes shared project configuration to `.mcp.json` and asks for approval before using project-scoped servers.

## Cursor

Add `.cursor/mcp.json` to the target project:

```json
{
  "mcpServers": {
    "maru": {
      "command": "npx",
      "args": ["--yes", "marucheck@0.2.0", "mcp"]
    }
  }
}
```

Restart Cursor and enable `maru` in MCP settings.

If a client cannot spawn `npx` on Windows, configure `npx.cmd` as the command. The MCP process must
run with the repository being verified as its working directory.

## Recommended agent workflow

1. Call `maru_get_project_context` before changing behavior.
2. Call `maru_get_contract` for the affected feature.
3. Call `maru_query_memory` for the affected domain and review earlier root causes and regression tests.
4. Call `maru_check_semantic_drift` before changing a protected expectation.
5. Implement the change without weakening or auto-approving the contract. If product intent should change, create a pending proposal with `maru_propose_contract_amendment` for an owner to review separately.
6. Call `maru_analyze_diff` to inspect change metadata and classifications.
7. Call `maru_assess_risk` to inspect score contributions, historical matches, and related requirements.
8. Call `maru_create_verification_plan` and review automatically included historical regressions plus unavailable or uncovered work.
9. Call `maru_run_verification`; review any temporary test source before allowing execution.
10. For high-risk or release work, call `maru_prepare_challenge`. Give only its brief to a fresh thread/subagent without the builder conversation, then call `maru_submit_challenge` with the structured response and truthful isolation provenance.
11. Review Challenger hypotheses and convert relevant objectives into reviewed verification; they are not findings by themselves.
12. For important contracts, call `maru_run_mutation_verification` and treat surviving or inconclusive mutations as unresolved verification.
13. Treat a blocked report gate or any blocking finding as unresolved verification.
14. Record confirmed bugs with `maru_record_bug`, including a reviewed regression-test path, then validate contracts with `maru_validate_contract`.

## Protocol and safety

- Stable protocol target: MCP `2025-11-25`, with negotiation for `2025-06-18` and `2024-11-05` clients.
- Transport: local stdio only; no listening network socket or authentication surface.
- Paths remain inside the configured project root.
- Contract creation always produces `draft` status. Planning, verification, and amendment proposals also write bounded local artifacts.
- MCP can propose a semantic amendment but cannot approve one; approval requires a separate current-owner CLI action.
- MCP records immutable QA memory but cannot rewrite an existing record.
- Git analysis invokes `git` directly without a shell and returns metadata rather than changed source lines.
- Every tool has `openWorldHint: false`; the MCP server makes no outbound model or network call.
- Challenger isolation is client-attested. MaruCheck validates brief integrity, response schema, known files/requirements, and provenance, but cannot inspect the host client’s conversation boundary.
- Challenger briefs contain bounded metadata and protected intent rather than changed source lines, and submitted hypotheses are never executed automatically.
- stdout is reserved for MCP messages; clients should apply normal tool approval controls.

References: [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [Codex MCP configuration](https://developers.openai.com/codex/mcp), [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp), and [Cursor MCP](https://docs.cursor.com/context/model-context-protocol).
